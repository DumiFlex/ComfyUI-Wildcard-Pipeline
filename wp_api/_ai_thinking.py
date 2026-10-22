"""What the Thinking setting can mean for the chosen model, and what to send.

Providers and models take different things (research note
`/pr-drafts/thinking-levels-per-model.md`): LM Studio's Qwen 3.x and most
local hybrids have only off and on, Claude and OpenAI models each have their
own effort levels (some can't turn thinking off), OpenRouter lists each
model's efforts, Ollama says per model whether `think` takes levels or
true/false. So the setting is fitted to the model before it is sent:

- `choices(cfg)` asks the server what the model takes (cached), else goes by
  the model's name: ``{"kind", "options", "can_off", "default", "source"}``.
  ``kind`` is "levels" (efforts in ``options``), "switch" (only off and on),
  "none" (the model doesn't think, or thinks without a setting) or
  "unknown" (sent as picked).
- `fit(setting, info)` turns the saved setting into what to send: a level on
  an on/off model is "on", Off on a model that must think is its lowest
  level, a level the model lacks is the nearest one it has.
- `refused(cfg, sent)` remembers a value the server refused (a 4xx), so
  later asks send the model's default straight away instead of failing
  first; `fitted(cfg)` applies all of it to a config.

Probes go through the client's `_request` to the one saved address, like
every other request.
"""
from __future__ import annotations

import re
import time
import urllib.parse
from typing import Any

from engine.ai.config import THINKING_LEVELS
from wp_api import _ai_client as client
from wp_api._ai_client import AIError

#: Effort levels from least to most.
LEVELS = THINKING_LEVELS
_TTL_S = 600.0
_cache: dict[tuple[str, str, str], tuple[float, dict[str, Any]]] = {}
#: (base_url, model) → values its server refused this session.
_refused: dict[tuple[str, str], set[str]] = {}
#: (base_url, model) pairs that spent a whole reply thinking: asked with
#: thinking off from then on, this session.
_thought_out: set[tuple[str, str]] = set()

UNKNOWN: dict[str, Any] = {"kind": "unknown", "options": [], "can_off": True,
                           "default": None, "source": "none"}


def _info(kind: str, options: list[str] | None = None, *, can_off: bool = True,
          default: str | None = None, source: str = "server") -> dict[str, Any]:
    return {"kind": kind, "options": [o for o in LEVELS if o in (options or [])],
            "can_off": can_off, "default": default, "source": source}


SWITCH = _info("switch", source="guess")


# ── Known by name (servers that don't list it) ──────────────────────────

#: Claude models that always think: `thinking: disabled` is a 400.
_CLAUDE_ALWAYS = re.compile(r"claude-(?:fable|mythos|opus-5-5|sonnet-5-5)", re.I)
_CLAUDE_NAMES: tuple[tuple[re.Pattern[str], tuple[str, ...]], ...] = (
    (re.compile(r"claude-(?:sonnet|haiku)-4-5|claude-3|claude-(?:sonnet|opus)-4(?:-[0-1])?(?:-|$)",
                re.I), ()),
    (re.compile(r"claude-opus-4-5", re.I), ("low", "medium", "high")),
    (re.compile(r"claude-(?:opus|sonnet)-4-6", re.I), ("low", "medium", "high", "max")),
    (re.compile(r"claude-", re.I), ("low", "medium", "high", "xhigh", "max")),
)
#: OpenAI models: (name, efforts, takes "none"). Checked in order.
_OPENAI_NAMES: tuple[tuple[re.Pattern[str], tuple[str, ...], bool], ...] = (
    (re.compile(r"^gpt-5(?:-mini|-nano)?(?:-\d{4}|$)", re.I), ("low", "medium", "high"), False),
    (re.compile(r"^gpt-5\.1", re.I), ("low", "medium", "high"), True),
    (re.compile(r"^gpt-5\.\d", re.I), ("low", "medium", "high", "xhigh"), True),
    (re.compile(r"^gpt-6", re.I), ("low", "medium", "high", "xhigh", "max"), False),
    (re.compile(r"^(?:o1|o3|o4)", re.I), ("low", "medium", "high"), False),
    (re.compile(r"^gpt-oss", re.I), ("low", "medium", "high"), False),
)
_OPENAI_PLAIN = re.compile(r"^(?:gpt-4|gpt-3|chatgpt-4o)", re.I)
#: Ollama models whose `think` takes a level instead of true/false, when
#: `/api/show` doesn't say.
_OLLAMA_LEVELS = re.compile(r"gpt-oss", re.I)


def by_name(cfg: dict[str, Any]) -> dict[str, Any]:
    """What the model's name says, for servers that don't list it."""
    model = str(cfg.get("model") or "")
    bare = model.rsplit("/", 1)[-1]
    if cfg.get("api") == "anthropic":
        for pat, levels in _CLAUDE_NAMES:
            if pat.search(model):
                if not levels:
                    return _info("none", source="name")
                return _info("levels", list(levels), can_off=not _CLAUDE_ALWAYS.search(model),
                             source="name")
        return UNKNOWN
    if cfg.get("api") == "ollama":
        return (_info("levels", list(LEVELS[:3]), source="name") if _OLLAMA_LEVELS.search(model)
                else SWITCH)
    if not cfg.get("local") or client.is_openrouter(str(cfg.get("base_url") or "")):
        for pat, levels, none in _OPENAI_NAMES:
            if pat.search(bare):
                return _info("levels", list(levels), can_off=none, source="name")
        if _OPENAI_PLAIN.search(bare):
            return _info("none", source="name")
        return UNKNOWN
    if cfg.get("provider") == "lmstudio":
        # An LM Studio that doesn't list its models' options (before 0.4):
        # sent as picked; it takes the OpenAI effort names.
        return UNKNOWN
    # llama.cpp, vLLM and others: the chat template's on/off switch.
    return SWITCH


# ── Asking the server ───────────────────────────────────────────────────

def _root(cfg: dict[str, Any]) -> dict[str, Any]:
    return {**cfg, "base_url": re.sub(r"/v1$", "", str(cfg.get("base_url") or "").rstrip("/"))}


def from_lmstudio(entry: dict[str, Any]) -> dict[str, Any] | None:
    """LM Studio's `/api/v1/models` entry: `capabilities.reasoning` is
    ``{allowed_options, default}`` (Qwen 3.x: ``["off", "on"]``, "on"); no
    `reasoning` means the model has no thinking setting."""
    caps = entry.get("capabilities")
    if not isinstance(caps, dict):
        return None
    r = caps.get("reasoning")
    if not isinstance(r, dict):
        return _info("none")
    allowed = [str(o) for o in r.get("allowed_options") or [] if isinstance(o, str)]
    default = r.get("default") if isinstance(r.get("default"), str) else None
    levels = [o for o in LEVELS if o in allowed]
    if levels:
        return _info("levels", levels, can_off="off" in allowed, default=default)
    if "on" in allowed and "off" in allowed:
        return _info("switch", default=default)
    return _info("none", default=default)


def from_openrouter(entry: dict[str, Any]) -> dict[str, Any]:
    """OpenRouter's `/models` entry: `reasoning` lists `supported_efforts`
    and whether it is `mandatory` (then effort "none" is refused); a
    reasoning object without efforts is on/off; none means it doesn't
    think, or thinks with no setting."""
    r = entry.get("reasoning")
    if not isinstance(r, dict):
        params = entry.get("supported_parameters")
        if isinstance(params, list) and ("reasoning" in params or "include_reasoning" in params):
            return _info("switch")
        return _info("none")
    efforts = r.get("supported_efforts")
    mandatory = bool(r.get("mandatory"))
    default = r.get("default_effort") if isinstance(r.get("default_effort"), str) else None
    if isinstance(efforts, list) and efforts:
        names = [str(e) for e in efforts]
        return _info("levels", [o for o in LEVELS if o in names],
                     can_off=not mandatory and ("none" in names or "minimal" in names),
                     default=default)
    return _info("switch", can_off=not mandatory, default=default)


def from_claude(data: dict[str, Any], model: str) -> dict[str, Any] | None:
    """Claude's Models API: `capabilities.effort.<level>.supported`."""
    caps = data.get("capabilities")
    if not isinstance(caps, dict):
        return None
    effort = caps.get("effort")
    if not isinstance(effort, dict) or not effort.get("supported"):
        return _info("none")
    levels = [o for o in LEVELS
              if isinstance(effort.get(o), dict) and effort[o].get("supported")]
    return _info("levels", levels, can_off=not _CLAUDE_ALWAYS.search(model))


def from_ollama(data: dict[str, Any]) -> dict[str, Any] | None:
    """Ollama's `/api/show`: "thinking" in `capabilities`, and `thinking:
    {values, default}` with true/false or level names."""
    caps = data.get("capabilities")
    if not isinstance(caps, list):
        return None
    if "thinking" not in caps:
        return _info("none")
    t = data.get("thinking")
    values = t.get("values") if isinstance(t, dict) else None
    names = [str(v) for v in values or [] if isinstance(v, str)]
    levels = [o for o in LEVELS if o in names]
    if levels:
        return _info("levels", levels, can_off=False in (values or []) or "false" in names)
    if values and False not in values:
        return _info("none")  # always thinks, no setting
    return _info("switch")


def from_template(template: str) -> dict[str, Any] | None:
    """A chat template's own switches, for servers that hand the request's
    `chat_template_kwargs` to it (llama.cpp's `/props` shows the template):
    `enable_thinking` is on/off, a `reasoning_effort` variable has levels
    (Qwen 3.8: low, medium, xhigh). None when it has neither."""
    if "reasoning_effort" in template:
        named = set(re.findall(r"['\"](low|medium|high|xhigh|max)['\"]", template))
        if named:
            return _info("levels", sorted(named, key=LEVELS.index),
                         can_off="enable_thinking" in template)
    if "enable_thinking" in template:
        return _info("switch")
    return None


async def _ask_server(cfg: dict[str, Any]) -> dict[str, Any] | None:
    model = str(cfg.get("model") or "")
    t = client._LIST_TIMEOUT
    if cfg.get("api") == "anthropic":
        data = await client._request(cfg, "GET", f"/models/{urllib.parse.quote(model, safe='')}",
                                     timeout=t)
        return from_claude(data, model) if isinstance(data, dict) else None
    if cfg.get("api") == "ollama":
        data = await client._request(cfg, "POST", "/api/show", body={"model": model}, timeout=t)
        return from_ollama(data) if isinstance(data, dict) else None
    if client.is_openrouter(str(cfg.get("base_url") or "")):
        data = await client._request(cfg, "GET", "/models", timeout=t)
        for m in (data.get("data") if isinstance(data, dict) else None) or []:
            if isinstance(m, dict) and m.get("id") == model:
                return from_openrouter(m)
        return None
    if cfg.get("provider") == "lmstudio":
        try:
            data = await client._request(_root(cfg), "GET", "/api/v1/models", timeout=t)
        except AIError:
            return None
        for m in (data.get("models") or data.get("data") if isinstance(data, dict) else None) or []:
            if isinstance(m, dict) and model in (m.get("key"), m.get("id")):
                return from_lmstudio(m)
        return None
    if cfg.get("local"):
        # llama.cpp's llama-server shows the chat template it renders with.
        try:
            data = await client._request(_root(cfg), "GET", "/props", timeout=t)
        except AIError:
            return None
        template = data.get("chat_template") if isinstance(data, dict) else None
        return from_template(template) if isinstance(template, str) else None
    return None


async def choices(cfg: dict[str, Any]) -> dict[str, Any]:
    """What the model takes, asked once per 10 minutes per server + model."""
    if not cfg.get("model"):
        return UNKNOWN
    key = (str(cfg.get("api")), str(cfg.get("base_url") or ""), str(cfg.get("model")))
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _TTL_S:
        return hit[1]
    try:
        found = await _ask_server(cfg)
    except AIError:
        found = None
    info = found or by_name(cfg)
    _cache[key] = (time.monotonic(), info)
    return info


# ── Fitting the setting ─────────────────────────────────────────────────

def _nearest(level: str, options: list[str]) -> str:
    want = LEVELS.index(level)
    return min(options, key=lambda o: (abs(LEVELS.index(o) - want), -LEVELS.index(o)))


def fit(setting: str, info: dict[str, Any]) -> str:
    """The saved setting as this model takes it: "auto", "off", "on" (an
    on/off model's on) or one of its levels."""
    if setting == "auto" or info["kind"] == "unknown":
        return setting
    if info["kind"] == "none":
        return "auto"
    if setting == "off":
        if info["can_off"]:
            return "off"
        return info["options"][0] if info["kind"] == "levels" and info["options"] else "auto"
    if info["kind"] == "switch":
        return "on"
    if setting == "on":
        return "auto"
    return setting if setting in info["options"] else _nearest(setting, info["options"]) \
        if info["options"] else "auto"


def _key(cfg: dict[str, Any]) -> tuple[str, str]:
    return (str(cfg.get("base_url") or ""), str(cfg.get("model") or ""))


def refused(cfg: dict[str, Any], sent: str) -> None:
    """Remember that this server refused `sent` for this model."""
    if sent and sent != "auto":
        _refused.setdefault(_key(cfg), set()).add(sent)


def was_refused(cfg: dict[str, Any], sent: str) -> bool:
    return sent in _refused.get(_key(cfg), set())


def refused_values(cfg: dict[str, Any]) -> list[str]:
    return sorted(_refused.get(_key(cfg), set()))


def thought_out(cfg: dict[str, Any]) -> None:
    """Remember that this model spent a whole reply thinking."""
    _thought_out.add(_key(cfg))


def forget(cfg: dict[str, Any]) -> None:
    """Drop what was remembered for this model (the user changed Thinking)."""
    _refused.pop(_key(cfg), None)
    _thought_out.discard(_key(cfg))


def unfitted(cfg: dict[str, Any], setting: str) -> dict[str, Any]:
    """`cfg` with a new Thinking setting, to be fitted again."""
    out = {k: v for k, v in cfg.items() if not k.startswith("thinking_")}
    return {**out, "thinking": setting}


async def fitted(cfg: dict[str, Any]) -> dict[str, Any]:
    """`cfg` with `thinking` set to what this model takes: the setting
    fitted to the model, or "auto" once the server refused that value. The
    saved setting stays in `thinking_setting`."""
    setting = str(cfg.get("thinking") or "auto")
    if "thinking_setting" in cfg:
        return cfg
    if _key(cfg) in _thought_out and setting != "off":
        setting = "off"
    if setting == "auto":
        return cfg
    info = await choices(cfg)
    sent = fit(setting, info)
    if was_refused(cfg, sent):
        sent = "auto"
    return {**cfg, "thinking": sent, "thinking_setting": setting,
            "thinking_kind": None if info["kind"] == "unknown" else info["kind"],
            "thinking_default": info["default"]}


async def describe(cfg: dict[str, Any]) -> dict[str, Any]:
    """For Settings and the chat header: what the model takes, what each
    choice becomes, and a line saying so."""
    info = await choices(cfg)
    shown = ["auto", "off", *LEVELS[:3]] if info["kind"] == "unknown" else (
        ["auto"] if info["kind"] == "none" else
        ["auto", "off", "on"] if info["kind"] == "switch" else
        ["auto", *(["off"] if info["can_off"] else []), *info["options"]])
    sends = {c: fit(c, info) for c in ("off", "on", *LEVELS)}
    gone = refused_values(cfg)
    for c, v in sends.items():
        if v in gone:
            sends[c] = "auto"
    spent = _key(cfg) in _thought_out
    if spent:
        sends = {c: fit("off", info) for c in sends}
    return {**info, "shown": shown, "sends": sends, "refused": gone, "thought_out": spent,
            "note": _note(info, gone, spent)}


def _note(info: dict[str, Any], gone: list[str], spent: bool = False) -> str:
    kind = info["kind"]
    if kind == "none":
        line = "This model has no thinking setting, so the model decides."
    elif kind == "switch":
        line = "This model only has thinking on or off."
    elif kind == "levels":
        line = "This model takes " + ", ".join(
            {"low": "Low", "medium": "Medium", "high": "High", "xhigh": "Extra high",
             "max": "Max"}[o] for o in info["options"]) + "."
        if not info["can_off"]:
            line += " It always thinks, so Off asks for its lowest level."
    else:
        line = ""
    if gone:
        line = (line + " " if line else "") + (
            "The server refused " + ", ".join(gone) + " for this model, so it gets its default.")
    if spent:
        line = (line + " " if line else "") + (
            "It spent a whole reply thinking, so it answers with thinking off until you "
            "change Thinking.")
    return line
