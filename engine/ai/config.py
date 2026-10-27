"""AI assistant settings (`ai.json`), kept apart from `settings.json`.

Why a separate file: `GET /wp/api/settings` returns `settings.json` whole, and
the API key must never be returned by any route. Keeping the key in its own
file (written with owner-only permissions where the OS allows) means no
code path that serves the general settings can leak it.

Location, highest priority first:

1. ``WP_AI_CONFIG_PATH`` env var (tests point it at tmp_path).
2. ``<ComfyUI user dir>/wildcard-pipeline/ai.json``, beside `settings.json`.
3. ``<plugin>/wp-ai.json`` when the user dir can't be detected.

The key can also come from the environment so it never touches disk:
``WP_AI_API_KEY`` for any provider, else ``ANTHROPIC_API_KEY`` /
``OPENAI_API_KEY`` for those two presets. An env key wins over a saved one.

A key is only ever sent to the address it was given for. A saved key
remembers the origin (scheme, host, port) it was saved with; change the
address and the key stays saved but isn't sent until it's pasted again for
the new one (or the address changes back). Env keys go to their provider's
own host, and ``WP_AI_API_KEY`` to the preset's host or to
``WP_AI_API_KEY_HOST``. Otherwise anything that can change the address (a
page using the local API) could have the key sent to its own server.

Each provider keeps its own address, model and key under ``providers``, so
switching from Claude to Ollama and back doesn't lose the Claude key. Files
written before that (flat ``base_url`` / ``model`` / ``api_key``) are read
as the settings of the provider they were saved with.

The settings that depend on the model (``MODEL_FIELDS``: Thinking, model
size, context, tool format, samplers and the small-model step options) live
in the provider's slot too, and each model the provider ran keeps its own
copy under ``models``: switching from Claude at Medium thinking to a Qwen
that only takes on/off brings back what was last used with that Qwen. A
model with nothing saved keeps the provider's values but starts Thinking and
model size at automatic, since another model's level or size may not fit
it. The unload time is the provider's (it is about the server). Everything
else (permissions, web search, the assistant switch) is shared by all.

The feature is OFF by default. Nothing in this package makes a request; this
is only the shape of what the user configured.
"""
from __future__ import annotations

import copy
import ipaddress
import json
import os
import tempfile
import threading
import urllib.parse
from pathlib import Path
from typing import Any

from engine.ai import budget
from engine.ai.lang import LANGUAGES

CONFIG_FILENAME = "ai.json"
FALLBACK_FILENAME = "wp-ai.json"

UNLOAD_AFTER_MIN = 0
UNLOAD_AFTER_MAX = 3600
CONTEXT_MIN = 4096
CONTEXT_MAX = 131072
#: "auto" reads the size from the model's name (engine/ai/budget.py).
MODEL_SIZES = ("auto", "small", "medium", "large")

#: Wire format per preset. `ollama` uses Ollama's native API (it is the only
#: one that takes `keep_alive`, and its `format` accepts a JSON schema);
#: everything else OpenAI-compatible goes through `openai`.
#:
#: Embeddings per preset (`/pr-drafts/ai-embeddings-providers.md`): `embeds`
#: says whether the chat server itself can embed, `embed_model` is a model to
#: suggest, `embed_note` what Settings says about running both models.
PRESETS: dict[str, dict[str, Any]] = {
    "anthropic": {
        "label": "Claude", "api": "anthropic", "local": False, "needs_key": True,
        "base_url": "https://api.anthropic.com", "key_env": "ANTHROPIC_API_KEY",
        "embeds": False, "embed_model": "",
        "embed_note": "Claude has no embeddings. For meaning search, put another server "
                      "above: a local Ollama (http://127.0.0.1:11434, nomic-embed-text) or "
                      "an OpenAI-style one such as Voyage AI (https://api.voyageai.com/v1) "
                      "with its own key.",
    },
    "openai": {
        "label": "OpenAI", "api": "openai", "local": False, "needs_key": True,
        "base_url": "https://api.openai.com/v1", "key_env": "OPENAI_API_KEY",
        "embeds": True, "embed_model": "text-embedding-3-small", "embed_note": "",
    },
    "openrouter": {
        "label": "OpenRouter", "api": "openai", "local": False, "needs_key": True,
        "base_url": "https://openrouter.ai/api/v1", "key_env": "OPENROUTER_API_KEY",
        "embeds": True, "embed_model": "openai/text-embedding-3-small",
        "embed_note": "OpenRouter embeds with the same key; embedding models are billed "
                      "like others (text-embedding-3-small is about $0.02 per million "
                      "tokens), and free chat models have daily request limits.",
    },
    "ollama": {
        "label": "Ollama", "api": "ollama", "local": True, "needs_key": False,
        "base_url": "http://127.0.0.1:11434", "key_env": None,
        "embeds": True, "embed_model": "nomic-embed-text",
        "embed_note": "Ollama keeps the chat and embedding models loaded together while "
                      "both fit in memory (up to 3 models, OLLAMA_MAX_LOADED_MODELS); when "
                      "they don't, it swaps them on every search.",
    },
    "lmstudio": {
        "label": "LM Studio", "api": "openai", "local": True, "needs_key": False,
        "base_url": "http://127.0.0.1:1234/v1", "key_env": None,
        "embeds": True, "embed_model": "text-embedding-nomic-embed-text-v1.5",
        "embed_note": "LM Studio keeps only one model it loaded on demand, so each search "
                      "swaps your chat model out. Load both yourself (lms load <model>, or "
                      "the Developer tab), or turn off Auto-Evict in Developer › Server "
                      "Settings.",
    },
    "llamacpp": {
        "label": "llama.cpp", "api": "openai", "local": True, "needs_key": False,
        "base_url": "http://127.0.0.1:8080/v1", "key_env": None,
        "embeds": False, "embed_model": "",
        "embed_note": "A llama.cpp server runs one model, and serves embeddings only when "
                      "started with --embeddings. Start a second one for the embedding "
                      "model on another port and put its address above.",
    },
    "custom": {
        "label": "Other (OpenAI-compatible)", "api": "openai", "local": True,
        "needs_key": False, "base_url": "", "key_env": None,
        "embeds": True, "embed_model": "", "embed_note": "",
    },
}
#: How the embedding server is spoken to: like the chat server ("auto"
#: guesses for another address), Ollama's /api/embed or OpenAI's /embeddings.
EMBED_APIS = ("auto", "ollama", "openai")

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "provider": "ollama",
    "base_url": "",
    "model": "",
    "unload_after_s": 60,
    "context_max": 16384,
    # How the chat calls tools: "auto" (native tool calls where the server
    # says the model takes them, else the JSON step format), "native" or
    # "json".
    "tool_format": "auto",
    # Thinking models (Qwen3, DeepSeek R1, …): "auto" leaves it to the model,
    # "off" asks the server to skip the reasoning (faster, and it can't use
    # up the output limit before the answer), "on" turns it on, a level asks
    # for that much reasoning. Fitted to what the model takes before it is
    # sent (`wp_api/_ai_thinking.py`).
    "thinking": "auto",
    # Permissions (Settings › AI assistant › Permissions). No tool can read
    # or change these.
    "allow_delete": False,
    "auto_apply": False,
    # Web tools (Settings › AI assistant › Web search). The Danbooru lookup
    # is off until the user turns it on; `web_always_allow` skips the Allow
    # card for web searches, page reads and Danbooru lookups (the user's
    # call, with a warning in Settings).
    "danbooru_lookup": False,
    "web_always_allow": False,
    # The language the user writes to the assistant in (Settings › AI
    # assistant › Chat): "auto" guesses per message, "english" never asks
    # for a request frame, "other" always does (`engine/ai/lang.py`).
    "request_language": "auto",
    # Small and medium models in JSON steps on a local server: name the tool
    # first, then write only its arguments (Settings › AI assistant ›
    # Advanced; an experiment, off by default).
    "choose_first": False,
    # Small models in JSON steps: the instructions list each tool in one
    # line, and a tool's arguments and example come with the step that
    # first offers it (Settings › AI assistant › Advanced; off by default).
    "lean_prompt": False,
}
#: Optional samplers sent with every request to a local or
#: OpenAI-compatible server (Settings › AI assistant › Advanced): name →
#: (lowest, highest, whole number). Left out, the server's own setting for
#: the model applies. Temperature is not here: the assistant picks it per
#: task (`budget.PROFILES`), low for tool steps.
SAMPLING: dict[str, tuple[float, float, bool]] = {
    "top_p": (0.0, 1.0, False),
    "top_k": (0.0, 1000.0, True),
    "min_p": (0.0, 1.0, False),
    "repeat_penalty": (0.5, 2.0, False),
    "presence_penalty": (-2.0, 2.0, False),
}
TOOL_FORMATS = ("auto", "native", "json")
#: Settings that follow the provider and model (see the module docstring).
#: `RESET_ON_NEW_MODEL` start at "auto" for a model with nothing saved.
MODEL_FIELDS = ("thinking", "model_size", "context_max", "tool_format", "sampling",
                "choose_first", "lean_prompt")
RESET_ON_NEW_MODEL = ("thinking", "model_size")
#: How many models per provider keep their own settings (the oldest go).
MODELS_KEPT = 40
#: "auto" leaves thinking to the server or model; "off" asks it to skip;
#: "on" turns it on; a level asks a thinking model for that much reasoning.
#: Each model takes only some of these (Extra high and Max are Claude's,
#: OpenAI's and OpenRouter's top levels): `wp_api/_ai_thinking.py` fits the
#: setting to the model.
THINKING_LEVELS = ("low", "medium", "high", "xhigh", "max")
THINKING = ("auto", "off", "on", *THINKING_LEVELS)

#: Web search engines the user can bring (Settings › AI assistant › Web
#: search). Off by default. SearXNG runs at the user's own address; the
#: others are fixed hosts that take a key, bound to that host like model keys.
SEARCH_ENGINES: dict[str, dict[str, Any]] = {
    "searxng": {"label": "SearXNG", "base_url": "", "needs_key": False},
    "brave": {"label": "Brave Search", "base_url": "https://api.search.brave.com",
              "needs_key": True},
    "tavily": {"label": "Tavily", "base_url": "https://api.tavily.com", "needs_key": True},
    "kagi": {"label": "Kagi", "base_url": "https://kagi.com", "needs_key": True},
}

#: How "read this result" fetches a page from an approved search. Built in
#: is a plain HTTP fetch kept to its text (no browser, public addresses
#: only); Crawl4AI and Firecrawl render pages in a browser on a server the
#: user runs (Firecrawl also has a hosted API). Their key, when one is
#: needed, is bound to their host like the search keys.
READERS: dict[str, dict[str, Any]] = {
    "builtin": {"label": "Built in (page text)", "base_url": "", "needs_key": False,
                "needs_url": False},
    "crawl4ai": {"label": "Crawl4AI (your server)", "base_url": "", "needs_key": False,
                 "needs_url": True},
    "firecrawl": {"label": "Firecrawl", "base_url": "https://api.firecrawl.dev",
                  "needs_key": True, "needs_url": False},
}

_lock = threading.Lock()


class ConfigError(ValueError):
    """A value the user tried to save was refused. Message is user-facing."""


def config_path() -> Path:
    override = os.environ.get("WP_AI_CONFIG_PATH")
    if override:
        return Path(override)
    from engine.db.connection import wp_data_dir

    data_dir = wp_data_dir()
    if data_dir is not None:
        return data_dir / CONFIG_FILENAME
    from engine.db.config import plugin_root

    return plugin_root() / FALLBACK_FILENAME


def check_base_url(url: str) -> str:
    """Return the cleaned URL or raise ConfigError.

    Only http(s), a host, and no credentials in the URL: a key belongs in the
    key field, where it is never echoed back, not in an address that is.
    """
    url = url.strip().rstrip("/")
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme.lower() not in ("http", "https"):
        raise ConfigError("the server address must start with http:// or https://")
    if not parts.hostname:
        raise ConfigError("the server address has no host")
    if parts.username or parts.password:
        raise ConfigError("put the key in the API key field, not in the address")
    if parts.query or parts.fragment:
        raise ConfigError("the server address can't have a ?query or #fragment")
    return url


def origin(url: str) -> str:
    """`scheme://host:port` of an address, lowercased, default ports filled
    in; "" for no address. Keys are bound to this."""
    parts = urllib.parse.urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        return ""
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError:
        return ""
    return f"{scheme}://{parts.hostname.lower()}:{port}"


def _host(org: str) -> str:
    """What Settings shows for an origin: the host, with a port that isn't
    the default."""
    parts = urllib.parse.urlsplit(org)
    default = 443 if parts.scheme == "https" else 80
    host = parts.hostname or ""
    return host if parts.port in (None, default) else f"{host}:{parts.port}"


def _clamp_int(value: Any, lo: int, hi: int, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(lo, min(hi, int(value)))


def _normalize_model_fields(src: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    """The `MODEL_FIELDS` of a slot or a saved model, each from `src`, else
    `fallback`, else the default."""
    def pick(key: str, allowed: tuple[str, ...]) -> str:
        for got in (src.get(key), fallback.get(key)):
            if got in allowed:
                return got
        return DEFAULTS.get(key, "auto")

    def flag(key: str) -> bool:
        got = src.get(key, fallback.get(key))
        return got is True

    raw_context = src.get("context_max", fallback.get("context_max"))
    raw_sampling = src.get("sampling")
    if not isinstance(raw_sampling, dict):
        got = fallback.get("sampling")
        raw_sampling = got if isinstance(got, dict) else {}
    sampling = {}
    for name, value in raw_sampling.items():
        try:
            got = _sampler(name, value)
        except ConfigError:
            continue
        if got is not None:
            sampling[name] = got
    return {
        "thinking": pick("thinking", THINKING),
        "model_size": pick("model_size", MODEL_SIZES),
        "context_max": _clamp_int(raw_context, CONTEXT_MIN, CONTEXT_MAX, DEFAULTS["context_max"]),
        "tool_format": pick("tool_format", TOOL_FORMATS),
        "sampling": sampling,
        "choose_first": flag("choose_first"),
        "lean_prompt": flag("lean_prompt"),
    }


def _normalize_slot(raw: Any, legacy: dict[str, Any] | None = None) -> dict[str, Any]:
    """One provider's settings. `legacy`: the shared values of a file from
    before these followed the provider."""
    src = raw if isinstance(raw, dict) else {}
    base_url = _got if isinstance(_got := src.get("base_url"), str) else ""
    try:
        base_url = check_base_url(base_url)
    except ConfigError:
        base_url = ""
    model = _got if isinstance(_got := src.get("model"), str) else ""
    key = _got if isinstance(_got := src.get("api_key"), str) else ""
    embed_model = _got if isinstance(_got := src.get("embed_model"), str) else ""
    embed_url = _got if isinstance(_got := src.get("embed_base_url"), str) else ""
    embed_api_ = src.get("embed_api") if src.get("embed_api") in EMBED_APIS else "auto"
    try:
        embed_url = check_base_url(embed_url)
    except ConfigError:
        embed_url = ""
    key_origin = _got if isinstance(_got := src.get("key_origin"), str) else None
    embed_key = _got if isinstance(_got := src.get("embed_api_key"), str) else ""
    embed_origin = _got if isinstance(_got := src.get("embed_key_origin"), str) else ""
    current = _normalize_model_fields(src, legacy or {})
    raw_models = _got if isinstance(_got := src.get("models"), dict) else {}
    models = {}
    for mid, saved in list(raw_models.items())[-MODELS_KEPT:]:
        if isinstance(mid, str) and mid.strip() and isinstance(saved, dict):
            models[mid.strip()[:200]] = _normalize_model_fields(saved, {})
    return {"base_url": base_url, "model": model.strip()[:200], "api_key": key.strip(),
            # None: a key saved before keys were bound; bound on read.
            "key_origin": key_origin if key.strip() else "",
            **current, "models": models,
            "unload_after_s": _clamp_int(
                src.get("unload_after_s", (legacy or {}).get("unload_after_s")),
                UNLOAD_AFTER_MIN, UNLOAD_AFTER_MAX, DEFAULTS["unload_after_s"]),
            "embed_model": embed_model.strip()[:200],
            "embed_base_url": embed_url, "embed_api": embed_api_,
            # The embedding server's own key, bound to its address the same way.
            "embed_api_key": embed_key.strip(),
            "embed_key_origin": embed_origin if embed_key.strip() else ""}


def _sampler(name: Any, value: Any) -> float | int | None:
    """A sampler's stored value, None to leave it to the server; ConfigError
    when it isn't one or is out of range."""
    if name not in SAMPLING:
        raise ConfigError(f"unknown sampler {str(name)[:40]!r}")
    if value is None or value == "":
        return None
    low, high, whole = SAMPLING[name]
    if isinstance(value, bool) or not isinstance(value, (int, float)) \
            or not (low <= value <= high) or value != value:
        raise ConfigError(f"{name} must be a number from {low:g} to {high:g}")
    if whole:
        if not float(value).is_integer():
            raise ConfigError(f"{name} must be a whole number")
        return int(value)
    return float(value)


def _normalize(raw: Any) -> dict[str, Any]:
    """The stored shape: shared fields plus one slot per provider."""
    src = raw if isinstance(raw, dict) else {}
    provider = src.get("provider")
    if provider not in PRESETS:
        provider = DEFAULTS["provider"]
    raw_slots = _got if isinstance(_got := src.get("providers"), dict) else {}
    # These were shared before they followed the provider: every provider
    # starts from what was set, except Thinking, which only the provider it
    # was set for keeps (another's model may not take that level).
    legacy = {k: src[k] for k in (*MODEL_FIELDS, "unload_after_s")
              if k in src and k not in ("model_size", "sampling")}
    others = {k: v for k, v in legacy.items() if k != "thinking"}
    slots = {pid: _normalize_slot(raw_slots.get(pid), legacy if pid == provider else others)
             for pid in PRESETS}
    if "providers" not in src and any(k in src for k in ("base_url", "model", "api_key")):
        # A file from before per-provider slots: its flat fields belong to
        # the provider it was saved with.
        slots[provider] = _normalize_slot(src, legacy)
    for pid, slot in slots.items():
        if slot["key_origin"] is None:
            # Saved before keys were bound: bind it to where it is used now.
            slot["key_origin"] = origin(slot["base_url"] or PRESETS[pid]["base_url"])
    return {
        "enabled": src.get("enabled") is True,
        "provider": provider,
        "allow_delete": src.get("allow_delete") is True,
        "auto_apply": src.get("auto_apply") is True,
        "providers": slots,
        "search": _normalize_search(src.get("search")),
        "reader": _normalize_reader(src.get("reader")),
        "danbooru_lookup": src.get("danbooru_lookup") is True,
        "web_always_allow": src.get("web_always_allow") is True,
        "request_language": src.get("request_language")
        if src.get("request_language") in LANGUAGES else "auto",
    }


def _normalize_search(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    engine = src.get("engine") if src.get("engine") in SEARCH_ENGINES else "off"
    url = _got if isinstance(_got := src.get("base_url"), str) else ""
    try:
        url = check_base_url(url)
    except ConfigError:
        url = ""
    keys: dict[str, dict[str, str]] = {}
    raw_keys = _got if isinstance(_got := src.get("keys"), dict) else {}
    for eid in SEARCH_ENGINES:
        k = _got if isinstance(_got := raw_keys.get(eid), dict) else {}
        key = _got if isinstance(_got := k.get("api_key"), str) else ""
        org = _got if isinstance(_got := k.get("key_origin"), str) else ""
        if key.strip():
            keys[eid] = {"api_key": key.strip(), "key_origin": org}
    return {"engine": engine, "base_url": url, "keys": keys}


def _normalize_reader(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    engine = src.get("engine") if src.get("engine") in (*READERS, "off") else "builtin"
    url = _got if isinstance(_got := src.get("base_url"), str) else ""
    try:
        url = check_base_url(url)
    except ConfigError:
        url = ""
    keys: dict[str, dict[str, str]] = {}
    raw_keys = _got if isinstance(_got := src.get("keys"), dict) else {}
    for eid in READERS:
        k = _got if isinstance(_got := raw_keys.get(eid), dict) else {}
        key = _got if isinstance(_got := k.get("api_key"), str) else ""
        org = _got if isinstance(_got := k.get("key_origin"), str) else ""
        if key.strip():
            keys[eid] = {"api_key": key.strip(), "key_origin": org}
    return {"engine": engine, "base_url": url, "keys": keys}


def _reader_url(reader: dict[str, Any], engine: str) -> str:
    if engine not in READERS:
        return ""
    return reader["base_url"] or READERS[engine]["base_url"]


def _search_url(search: dict[str, Any], engine: str) -> str:
    return search["base_url"] if engine == "searxng" else SEARCH_ENGINES[engine]["base_url"]


def _active(cfg: dict[str, Any]) -> dict[str, Any]:
    """Shared fields plus the active provider's slot, flattened."""
    slot = cfg["providers"][cfg["provider"]]
    return {
        "enabled": cfg["enabled"],
        "provider": cfg["provider"],
        "base_url": slot["base_url"],
        "model": slot["model"],
        "unload_after_s": slot["unload_after_s"],
        "context_max": slot["context_max"],
        "model_size": slot["model_size"],
        "tool_format": slot["tool_format"],
        "thinking": slot["thinking"],
        "allow_delete": cfg["allow_delete"],
        "auto_apply": cfg["auto_apply"],
        "danbooru_lookup": cfg["danbooru_lookup"],
        "web_always_allow": cfg["web_always_allow"],
        "request_language": cfg["request_language"],
        "choose_first": slot["choose_first"],
        "lean_prompt": slot["lean_prompt"],
        "embed_model": slot["embed_model"],
        "embed_base_url": slot["embed_base_url"],
        "embed_api": slot["embed_api"],
        "api_key": slot["api_key"],
        "key_origin": slot["key_origin"],
        "embed_api_key": slot["embed_api_key"],
        "embed_key_origin": slot["embed_key_origin"],
        "sampling": dict(slot["sampling"]),
    }


def _read() -> dict[str, Any]:
    try:
        raw = json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    return _normalize(raw)


def _write(cfg: dict[str, Any]) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_str = tempfile.mkstemp(prefix=".wp-ai-", dir=str(path.parent))
    tmp = Path(tmp_str)
    try:
        # mkstemp already creates the file 0600 on POSIX; the chmod is for
        # clarity and for filesystems where the umask got in the way.
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def _env_key(provider: str) -> tuple[str, str]:
    """(key, the origin it may go to) from the environment, or ("", "")."""
    key = os.environ.get("WP_AI_API_KEY", "").strip()
    if key:
        host = os.environ.get("WP_AI_API_KEY_HOST", "").strip()
        return key, origin(host or PRESETS[provider]["base_url"])
    env = PRESETS[provider].get("key_env")
    key = os.environ.get(env, "").strip() if env else ""
    return (key, origin(PRESETS[provider]["base_url"])) if key else ("", "")


def _key_for(cfg: dict[str, Any], url: str) -> str:
    """The key to send to `url`: only one given for that origin."""
    org = origin(url)
    if not org:
        return ""
    env_key, env_origin = _env_key(cfg["provider"])
    if env_key:
        return env_key if env_origin == org else ""
    return cfg["api_key"] if cfg["api_key"] and cfg["key_origin"] == org else ""


def _embed_key_for(cfg: dict[str, Any], url: str) -> str:
    """The key to send to the embedding server: the chat key when it is the
    same address, else the embedding key saved for that address."""
    key = _key_for(cfg, url)
    if key:
        return key
    org = origin(url)
    return cfg["embed_api_key"] if org and cfg["embed_api_key"] \
        and cfg["embed_key_origin"] == org else ""


_LOCAL_SUFFIXES = (".local", ".lan", ".home", ".internal", ".localhost", ".home.arpa")


def is_local_address(url: str) -> bool:
    """Whether an address is on this machine or the home network (loopback,
    private and link-local IPs, `.local`-style names, one-word hostnames).
    Anything else is a cloud service."""
    host = (urllib.parse.urlsplit(url.strip()).hostname or "").lower().rstrip(".")
    if not host:
        return False
    if host == "localhost" or host.endswith(_LOCAL_SUFFIXES) or "." not in host and ":" not in host:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


def runs_local(provider: str, base_url: str) -> bool:
    """A local preset runs locally unless its address points at the internet
    (an "Other" server set to OpenRouter is a cloud service)."""
    if not PRESETS[provider]["local"]:
        return False
    return not base_url or is_local_address(base_url)


def embed_api(api: str, chat_url: str, embed_url: str, chosen: str = "auto") -> str:
    """The API the embedding server speaks: the one the user picked, else
    the chat server's for the same address; another address is OpenAI-style
    when it has a path (…/v1, like llama.cpp's --embeddings server or
    Voyage), Ollama when it is a bare host:port."""
    if chosen in ("ollama", "openai"):
        return chosen
    if embed_url and origin(embed_url) != origin(chat_url):
        path = urllib.parse.urlsplit(embed_url).path.strip("/")
        return "openai" if path else "ollama"
    return api


def load_effective() -> dict[str, Any]:
    """The config the client uses, key included. Never send this to a browser.

    `base_url` falls back to the preset's when the user left it empty.
    """
    with _lock:
        cfg = _active(_read())
    preset = PRESETS[cfg["provider"]]
    out = copy.deepcopy(cfg)
    out["base_url"] = cfg["base_url"] or preset["base_url"]
    out["api_key"] = _key_for(cfg, out["base_url"])
    out["api"] = preset["api"]
    out["local"] = runs_local(cfg["provider"], cfg["base_url"])
    out["embed_base_url"] = cfg["embed_base_url"] or out["base_url"]
    out["embed_api_key"] = _embed_key_for(cfg, out["embed_base_url"])
    out["embed_api"] = embed_api(preset["api"], out["base_url"], out["embed_base_url"],
                                 cfg["embed_api"])
    if out["embed_api"] == "anthropic":
        # Claude can't embed; meaning search needs another server.
        out["embed_model"] = ""
    out.pop("key_origin", None)
    out.pop("embed_key_origin", None)
    with _lock:
        search = _read()["search"]
    engine = search["engine"]
    out["search"] = {"engine": "off", "base_url": "", "api_key": ""}
    if engine != "off":
        url = _search_url(search, engine)
        key = search["keys"].get(engine) or {}
        out["search"] = {
            "engine": engine, "base_url": url,
            # Only to the host it was saved for.
            "api_key": key.get("api_key", "") if url and key.get("key_origin") == origin(url)
            else "",
        }
    with _lock:
        reader = _read()["reader"]
    rengine = reader["engine"]
    rurl = _reader_url(reader, rengine)
    rkey = reader["keys"].get(rengine) or {}
    out["reader"] = {
        "engine": rengine, "base_url": rurl,
        "api_key": rkey.get("api_key", "") if rurl and rkey.get("key_origin") == origin(rurl)
        else "",
    }
    return out


def cloud_ready() -> list[str]:
    """Labels of the cloud providers with a key saved (or in the
    environment), never the keys: the chat may suggest switching to one
    after a local model struggled."""
    with _lock:
        stored = _read()
    return [PRESETS[pid]["label"] for pid, slot in stored["providers"].items()
            if pid in PRESETS and not PRESETS[pid]["local"]
            and (slot["api_key"] or _env_key(pid)[0])]


def public_view() -> dict[str, Any]:
    """What the Settings page sees: everything except the key itself."""
    with _lock:
        stored = _read()
    cfg = _active(stored)
    env_key = bool(_env_key(cfg["provider"])[0])
    base = cfg["base_url"] or PRESETS[cfg["provider"]]["base_url"]
    view = {k: v for k, v in cfg.items()
            if k not in ("api_key", "key_origin", "embed_api_key", "embed_key_origin")}
    view["key_set"] = bool(_key_for(cfg, base))
    view["local"] = runs_local(cfg["provider"], cfg["base_url"])
    embed_base = cfg["embed_base_url"] or base
    # Whether a key goes to the embedding server: the chat key (same
    # address) or one saved for it. `embed_key_own`: one saved for it.
    view["embed_key_set"] = bool(_embed_key_for(cfg, embed_base))
    view["embed_key_own"] = bool(cfg["embed_api_key"]) \
        and cfg["embed_key_origin"] == origin(embed_base)
    # A key that is saved (or in the environment) but for another address:
    # Settings says where, and that it isn't sent here.
    elsewhere = cfg["key_origin"] if cfg["api_key"] else ""
    if env_key:
        elsewhere = _env_key(cfg["provider"])[1]
    view["key_for_host"] = _host(elsewhere) if elsewhere and not view["key_set"] else None
    # What "auto" means for the chosen model, so Settings can say it.
    view["model_size_auto"] = budget.model_size({
        "model": cfg["model"], "local": view["local"],
    })
    view["key_from_env"] = env_key
    # Which providers already have a key, so Settings can say so before
    # the user switches to one. Never the keys themselves.
    view["keys_saved"] = sorted(
        pid for pid, slot in stored["providers"].items()
        if slot["api_key"] or _env_key(pid)[0]
    )
    search = stored["search"]
    view["search_engine"] = search["engine"]
    view["search_url"] = search["base_url"]
    view["search_keys_saved"] = sorted(
        eid for eid, k in search["keys"].items()
        if k.get("key_origin") and k["key_origin"] == origin(_search_url(search, eid)))
    view["search_engines"] = {eid: {"label": e["label"], "needs_key": e["needs_key"]}
                              for eid, e in SEARCH_ENGINES.items()}
    reader = stored["reader"]
    view["reader_engine"] = reader["engine"]
    view["reader_url"] = reader["base_url"]
    view["reader_keys_saved"] = sorted(
        eid for eid, k in reader["keys"].items()
        if k.get("key_origin") and k["key_origin"] == origin(_reader_url(reader, eid)))
    view["reader_engines"] = {eid: {"label": e["label"], "needs_key": e["needs_key"],
                                    "needs_url": e["needs_url"], "base_url": e["base_url"]}
                              for eid, e in READERS.items()}
    view["presets"] = {
        pid: {k: p[k] for k in ("label", "api", "local", "needs_key", "base_url", "embeds",
                                "embed_model", "embed_note")}
        for pid, p in PRESETS.items()
    }
    return view


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial update and return the public view.

    `base_url`, `model` and `api_key` apply to the provider that is active
    after `provider` (if given) is applied, and so do the model's own
    settings (`MODEL_FIELDS`, after `model` is applied). Switching provider
    or model keeps every provider's and model's own settings. `api_key`: a
    non-empty string replaces the saved key, `""` or `None` removes it,
    absent leaves it alone. It is write-only: no response carries it back.
    """
    if not isinstance(patch, dict):
        raise ConfigError("body must be an object")
    with _lock:
        cfg = _read()
        for flag in ("enabled", "allow_delete", "auto_apply", "danbooru_lookup",
                     "web_always_allow", "choose_first", "lean_prompt"):
            if flag in patch and not isinstance(patch[flag], bool):
                raise ConfigError(f"{flag} must be true or false")
        for flag in ("enabled", "allow_delete", "auto_apply", "danbooru_lookup",
                     "web_always_allow"):
            if flag in patch:
                cfg[flag] = patch[flag]
        if "request_language" in patch:
            if patch["request_language"] not in LANGUAGES:
                raise ConfigError(f"request_language must be one of {', '.join(LANGUAGES)}")
            cfg["request_language"] = patch["request_language"]
        if "provider" in patch:
            if patch["provider"] not in PRESETS:
                raise ConfigError(f"unknown provider {patch['provider']!r}")
            # Each provider has its own slot, so a key for one company is
            # never sent to another and nothing is lost by switching.
            cfg["provider"] = patch["provider"]
        slot = cfg["providers"][cfg["provider"]]
        if "base_url" in patch:
            if not isinstance(patch["base_url"], str):
                raise ConfigError("base_url must be a string")
            slot["base_url"] = check_base_url(patch["base_url"])
        if "model" in patch:
            if not isinstance(patch["model"], str):
                raise ConfigError("model must be a string")
            _switch_model(slot, patch["model"].strip()[:200])
        for flag in ("choose_first", "lean_prompt"):
            if flag in patch:
                slot[flag] = patch[flag]
        if "embed_model" in patch:
            if not isinstance(patch["embed_model"], str):
                raise ConfigError("embed_model must be a string")
            if patch["embed_model"].strip() and PRESETS[cfg["provider"]]["api"] == "anthropic" \
                    and not str(patch.get("embed_base_url", slot["embed_base_url"])).strip():
                raise ConfigError("Claude has no embeddings API; put another server's address "
                                  "in Embedding server first")
            slot["embed_model"] = patch["embed_model"].strip()[:200]
        if "embed_base_url" in patch:
            if not isinstance(patch["embed_base_url"], str):
                raise ConfigError("embed_base_url must be a string")
            slot["embed_base_url"] = check_base_url(patch["embed_base_url"])
        if "embed_api" in patch:
            if patch["embed_api"] not in EMBED_APIS:
                raise ConfigError(f"embed_api must be one of {', '.join(EMBED_APIS)}")
            slot["embed_api"] = patch["embed_api"]
        if "embed_api_key" in patch:
            key = patch["embed_api_key"] if patch["embed_api_key"] is not None else ""
            if not isinstance(key, str):
                raise ConfigError("embed_api_key must be a string")
            key = key.strip()
            if len(key) > 512:
                raise ConfigError("that key is too long")
            slot["embed_api_key"] = key
            where = (slot["embed_base_url"] or slot["base_url"]
                     or PRESETS[cfg["provider"]]["base_url"])
            slot["embed_key_origin"] = origin(where) if key else ""
        if "unload_after_s" in patch:
            slot["unload_after_s"] = _clamp_int(
                patch["unload_after_s"], UNLOAD_AFTER_MIN, UNLOAD_AFTER_MAX,
                slot["unload_after_s"],
            )
        if "sampling" in patch:
            # A partial update: a sampler set to null or "" goes back to
            # the server's setting; ones left out stay as they are.
            if not isinstance(patch["sampling"], dict):
                raise ConfigError("sampling must be an object")
            merged = dict(slot["sampling"])
            for name, value in patch["sampling"].items():
                got = _sampler(name, value)
                if got is None:
                    merged.pop(name, None)
                else:
                    merged[name] = got
            slot["sampling"] = merged
        if "model_size" in patch:
            if patch["model_size"] not in MODEL_SIZES:
                raise ConfigError("model_size must be auto, small, medium or large")
            slot["model_size"] = patch["model_size"]
        if "context_max" in patch:
            slot["context_max"] = _clamp_int(
                patch["context_max"], CONTEXT_MIN, CONTEXT_MAX, slot["context_max"],
            )
        if "tool_format" in patch:
            if patch["tool_format"] not in TOOL_FORMATS:
                raise ConfigError("tool_format must be auto, native or json")
            slot["tool_format"] = patch["tool_format"]
        if "thinking" in patch:
            if patch["thinking"] not in THINKING:
                raise ConfigError("thinking must be auto, off, on, low, medium, high, xhigh or max")
            slot["thinking"] = patch["thinking"]
        if any(k in patch for k in MODEL_FIELDS):
            _remember_model(slot)
        if "api_key" in patch:
            key = patch["api_key"]
            if key is None:
                key = ""
            if not isinstance(key, str):
                raise ConfigError("api_key must be a string")
            key = key.strip()
            if len(key) > 512:
                raise ConfigError("that key is too long")
            slot["api_key"] = key
            # Bound to the address it was given for (applied above when
            # the same request changes both).
            where = slot["base_url"] or PRESETS[cfg["provider"]]["base_url"]
            slot["key_origin"] = origin(where) if key else ""
        _update_search(cfg["search"], patch)
        _update_reader(cfg["reader"], patch)
        _write(_normalize(cfg))
    return public_view()


def _model_values(slot: dict[str, Any]) -> dict[str, Any]:
    return {k: copy.deepcopy(slot[k]) for k in MODEL_FIELDS}


def _remember_model(slot: dict[str, Any]) -> None:
    """Keep the slot's model settings as its current model's own (newest
    last, so the oldest go first when there are too many)."""
    model = slot["model"]
    if not model:
        return
    models = slot["models"]
    models.pop(model, None)
    models[model] = _model_values(slot)
    while len(models) > MODELS_KEPT:
        models.pop(next(iter(models)))


def _switch_model(slot: dict[str, Any], model: str) -> None:
    """Change the provider's model and bring back that model's settings: the
    ones saved with it, else the provider's with Thinking and model size
    back to automatic (another model's level or size may not fit it)."""
    if model == slot["model"]:
        return
    _remember_model(slot)
    slot["model"] = model
    saved = slot["models"].get(model)
    if saved is not None:
        slot.update(copy.deepcopy(saved))
    else:
        for key in RESET_ON_NEW_MODEL:
            slot[key] = DEFAULTS.get(key, "auto")


def _update_search(search: dict[str, Any], patch: dict[str, Any]) -> None:
    if "search_engine" in patch:
        engine = patch["search_engine"]
        if engine != "off" and engine not in SEARCH_ENGINES:
            raise ConfigError(f"unknown search engine {engine!r}")
        search["engine"] = engine
    if "search_url" in patch:
        if not isinstance(patch["search_url"], str):
            raise ConfigError("search_url must be a string")
        search["base_url"] = check_base_url(patch["search_url"])
    if "search_key" in patch:
        engine = search["engine"]
        if engine == "off" or not SEARCH_ENGINES[engine]["needs_key"]:
            raise ConfigError("pick a search engine that takes a key first")
        key = patch["search_key"]
        if key is None:
            key = ""
        if not isinstance(key, str) or len(key.strip()) > 512:
            raise ConfigError("search_key must be a string")
        if key.strip():
            search["keys"][engine] = {"api_key": key.strip(),
                                      "key_origin": origin(_search_url(search, engine))}
        else:
            search["keys"].pop(engine, None)


def _update_reader(reader: dict[str, Any], patch: dict[str, Any]) -> None:
    if "reader_engine" in patch:
        engine = patch["reader_engine"]
        if engine != "off" and engine not in READERS:
            raise ConfigError(f"unknown page reader {engine!r}")
        if engine != reader["engine"]:
            # Each reader has its own address; a Crawl4AI address is no
            # Firecrawl server.
            reader["base_url"] = ""
        reader["engine"] = engine
    if "reader_url" in patch:
        if not isinstance(patch["reader_url"], str):
            raise ConfigError("reader_url must be a string")
        reader["base_url"] = check_base_url(patch["reader_url"])
    if "reader_key" in patch:
        engine = reader["engine"]
        if engine not in ("crawl4ai", "firecrawl"):
            raise ConfigError("pick Crawl4AI or Firecrawl first")
        key = patch["reader_key"]
        if key is None:
            key = ""
        if not isinstance(key, str) or len(key.strip()) > 512:
            raise ConfigError("reader_key must be a string")
        if key.strip():
            reader["keys"][engine] = {"api_key": key.strip(),
                                      "key_origin": origin(_reader_url(reader, engine))}
        else:
            reader["keys"].pop(engine, None)
