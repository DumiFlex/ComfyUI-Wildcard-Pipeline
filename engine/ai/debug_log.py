"""The AI debug log: every model request an AI action made, as it was sent
and as it came back, so a wrong answer can be traced (research note
`/pr-drafts/ai-debug-log-2026-10-26.md`).

Off unless the browser asks for it (Settings › AI assistant › Debug log)
or ``WP_AI_DEBUG=1`` is set. One *action* is one browser request (a Draft
press, a chat message, a pack plan); every model call it makes goes in its
record. Records stay in memory (the newest `KEEP` actions) and, when a
folder is given, one JSON file per action on disk (the newest `KEEP_FILES`).

Bodies are kept as sent, except images and embedding vectors, which become
a size note so a copy stays pasteable. API keys travel in headers, which
are never recorded. Pure: no aiohttp, no ComfyUI.
"""
from __future__ import annotations

import json
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

#: Actions kept in memory, oldest dropped first.
KEEP = 30
#: Action files kept on disk.
KEEP_FILES = 300
#: One action's calls stop being recorded past this many characters.
MAX_ACTION_CHARS = 8_000_000

_DATA_URL = re.compile(r"^data:([\w/+.-]+);base64,(.*)$", re.S)
_B64 = re.compile(r"^[A-Za-z0-9+/=]{2000,}$")
#: Keys whose value is a secret wherever it shows up.
_SECRET_KEYS = {"api_key", "apikey", "authorization", "x-api-key"}
#: A long run of numbers under one of these is an embedding.
_VECTOR_KEYS = {"embedding", "embeddings"}

_lock = threading.Lock()
_actions: OrderedDict[str, dict[str, Any]] = OrderedDict()


def _kb(chars: int) -> str:
    return f"{max(1, round(chars * 3 / 4 / 1024))} KB"


def scrub(value: Any, key: str = "") -> Any:
    """`value` with images, embedding vectors and secrets replaced by notes."""
    if isinstance(value, dict):
        return {k: ("[hidden]" if str(k).lower() in _SECRET_KEYS and isinstance(v, str) and v
                    else scrub(v, str(k).lower()))
                for k, v in value.items()}
    if isinstance(value, list):
        if key in _VECTOR_KEYS or (len(value) > 64 and all(isinstance(x, (int, float))
                                                           for x in value[:64])):
            if value and all(isinstance(x, list) for x in value):
                return [f"[vector, {len(x)} numbers]" for x in value]
            if value and all(isinstance(x, (int, float)) for x in value):
                return f"[vector, {len(value)} numbers]"
        return [scrub(v, key) for v in value]
    if isinstance(value, str):
        m = _DATA_URL.match(value)
        if m:
            return f"[image {m.group(1)}, {_kb(len(m.group(2)))}]"
        if key in ("data", "image", "image_url", "images", "url") and _B64.match(value):
            return f"[image, {_kb(len(value))}]"
    return value


def begin(aid: str, route: str, *, meta: dict[str, Any] | None = None) -> None:
    """Start the record of one action (a browser request)."""
    with _lock:
        while len(_actions) >= KEEP:
            _actions.popitem(last=False)
        _actions[aid] = {
            "id": aid, "route": route, "started": _now(), "t0": time.monotonic(),
            "seconds": None, "status": None, "error": None, "calls": [], "chars": 0,
            "dropped": 0, **(meta or {}),
        }


def add_call(aid: str, call: dict[str, Any]) -> None:
    """One model request of action `aid`: ``path``, ``provider``, ``model``,
    ``request``, ``response`` or ``error``, ``seconds``, ``streamed``."""
    with _lock:
        rec = _actions.get(aid)
        if rec is None:
            return
        entry = {**call, "request": scrub(call.get("request")),
                 "response": scrub(call.get("response"))}
        size = len(json.dumps(entry, ensure_ascii=False, default=str))
        if rec["chars"] + size > MAX_ACTION_CHARS:
            rec["dropped"] += 1
            return
        rec["chars"] += size
        rec["calls"].append({"n": len(rec["calls"]) + 1, **entry})


def finish(aid: str, *, status: int | None, error: str | None = None,
           folder: Path | None = None) -> None:
    """Close the record; with `folder`, write it there as `<time>-<id>.json`."""
    with _lock:
        rec = _actions.get(aid)
        if rec is None:
            return
        rec["seconds"] = round(time.monotonic() - rec["t0"], 1)
        rec["status"] = status
        rec["error"] = error
        if not rec["calls"] and error is None and (status or 200) < 400:
            del _actions[aid]  # it never reached the model: nothing to see
            return
        out = public(rec)
    if folder is None or not out["calls"]:
        return
    try:
        folder.mkdir(parents=True, exist_ok=True)
        stamp = out["started"].replace(":", "").replace("-", "")[:15]
        (folder / f"{stamp}-{aid}.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        files = sorted(folder.glob("*.json"))
        for old in files[:-KEEP_FILES]:
            old.unlink(missing_ok=True)
    except OSError:
        pass  # the log is a help, never a reason for a request to fail


def public(rec: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in rec.items() if k not in ("t0", "chars")}


def get(aid: str) -> dict[str, Any] | None:
    with _lock:
        rec = _actions.get(aid)
        return json.loads(json.dumps(public(rec), default=str)) if rec else None


def listing() -> list[dict[str, Any]]:
    """The kept actions, newest first, without their bodies."""
    with _lock:
        recs = list(_actions.values())
    out = []
    for r in reversed(recs):
        out.append({
            "id": r["id"], "route": r["route"], "label": r.get("label") or r["route"],
            "started": r["started"], "seconds": r["seconds"], "status": r["status"],
            "error": r["error"], "calls": len(r["calls"]),
            "failed": sum(1 for c in r["calls"] if c.get("error")),
            "tokens": _tokens(r["calls"]),
        })
    return out


def clear() -> None:
    with _lock:
        _actions.clear()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Usage, whichever provider answered ─────────────────────────────────────

def usage(response: Any) -> dict[str, int]:
    """Prompt / cached / output tokens from an OpenAI, Claude, Responses or
    Ollama answer (whatever of them the answer says)."""
    if not isinstance(response, dict):
        return {}
    raw = response.get("usage")
    u: dict[str, Any] = raw if isinstance(raw, dict) else {}
    out: dict[str, int] = {}

    def put(name: str, v: Any) -> None:
        if isinstance(v, int) and not isinstance(v, bool):
            out[name] = out.get(name, 0) + v

    if "input_tokens" in u or "output_tokens" in u:  # Claude, Responses
        put("prompt", u.get("input_tokens"))
        put("prompt", u.get("cache_read_input_tokens"))
        put("prompt", u.get("cache_creation_input_tokens"))
        put("cached", u.get("cache_read_input_tokens"))
        d = u.get("input_tokens_details")
        details: dict[str, Any] = d if isinstance(d, dict) else {}
        put("cached", details.get("cached_tokens"))
        put("output", u.get("output_tokens"))
    elif u:  # OpenAI chat completions and look-alikes
        put("prompt", u.get("prompt_tokens"))
        pd = u.get("prompt_tokens_details")
        pdetails: dict[str, Any] = pd if isinstance(pd, dict) else {}
        put("cached", pdetails.get("cached_tokens"))
        put("output", u.get("completion_tokens"))
    else:  # Ollama
        put("prompt", response.get("prompt_eval_count"))
        put("output", response.get("eval_count"))
    return out


def _tokens(calls: list[dict[str, Any]]) -> dict[str, int]:
    total: dict[str, int] = {}
    for c in calls:
        for k, v in usage(c.get("response")).items():
            total[k] = total.get(k, 0) + v
    return total


# ── The Markdown copy ──────────────────────────────────────────────────────

def _text_of(content: Any) -> str:
    """A message's content as text: plain strings, or the text of its parts
    (other parts as a one-line JSON note)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and isinstance(p.get("text"), str):
                parts.append(p["text"])
            elif isinstance(p, dict) and isinstance(p.get("thinking"), str):
                parts.append(f"[thinking]\n{p['thinking']}")
            else:
                parts.append(json.dumps(p, ensure_ascii=False, default=str))
        return "\n\n".join(parts)
    if content is None:
        return ""
    return json.dumps(content, ensure_ascii=False, default=str)


def _fence(text: str, lang: str = "") -> str:
    ticks = "```"
    while ticks in text:
        ticks += "`"
    return f"{ticks}{lang}\n{text.rstrip()}\n{ticks}"


def _messages(req: dict[str, Any]) -> list[tuple[str, str]]:
    """(role, text) for each part of the prompt, system first."""
    out: list[tuple[str, str]] = []
    system = req.get("system")
    if system:
        out.append(("system", _text_of(system)))
    if req.get("instructions"):
        out.append(("system", _text_of(req["instructions"])))
    for m in req.get("messages") or req.get("input") or []:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or m.get("type") or "?")
        body = _text_of(m.get("content"))
        if m.get("tool_calls"):
            body += ("\n\n" if body else "") + "tool calls: " + json.dumps(
                m["tool_calls"], ensure_ascii=False, default=str)
        if m.get("images"):
            body += f"\n\n{m['images']}"
        if m.get("type") in ("function_call", "function_call_output"):
            body = json.dumps(m, ensure_ascii=False, default=str)
        out.append((role, body))
    if isinstance(req.get("input"), str):
        out.append(("user", req["input"]))
    if isinstance(req.get("prompt"), str):
        out.append(("user", req["prompt"]))
    return out


def _tool_names(req: dict[str, Any]) -> list[str]:
    names = []
    for t in req.get("tools") or []:
        if isinstance(t, dict):
            fn = t.get("function") if isinstance(t.get("function"), dict) else t
            names.append(str(fn.get("name") or t.get("type") or "?"))
    return names


def _reply(resp: Any) -> dict[str, Any]:
    """The answer's text, thinking, tool calls and stop reason."""
    out: dict[str, Any] = {"text": "", "thinking": "", "calls": [], "stop": ""}
    if not isinstance(resp, dict):
        return out
    if isinstance(resp.get("choices"), list) and resp["choices"]:  # OpenAI-style
        ch = resp["choices"][0] if isinstance(resp["choices"][0], dict) else {}
        msg = ch.get("message") if isinstance(ch.get("message"), dict) else {}
        out["text"] = _text_of(msg.get("content"))
        out["thinking"] = str(msg.get("reasoning_content") or msg.get("reasoning") or "")
        out["calls"] = msg.get("tool_calls") or []
        out["stop"] = str(ch.get("finish_reason") or "")
    elif isinstance(resp.get("content"), list):  # Claude
        texts, thoughts = [], []
        for b in resp["content"]:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text":
                texts.append(str(b.get("text") or ""))
            elif b.get("type") == "thinking":
                thoughts.append(str(b.get("thinking") or ""))
            elif b.get("type") == "tool_use":
                out["calls"].append({"name": b.get("name"), "input": b.get("input")})
        out["text"], out["thinking"] = "\n".join(texts), "\n".join(thoughts)
        out["stop"] = str(resp.get("stop_reason") or "")
    elif isinstance(resp.get("output"), list):  # Responses
        for item in resp["output"]:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                out["text"] += _text_of(item.get("content"))
            elif item.get("type") == "reasoning":
                out["thinking"] += _text_of(item.get("summary"))
            elif item.get("type") == "function_call":
                out["calls"].append({"name": item.get("name"), "arguments": item.get("arguments")})
        out["stop"] = str(resp.get("status") or "")
    elif isinstance(resp.get("message"), dict):  # Ollama
        msg = resp["message"]
        out["text"] = _text_of(msg.get("content"))
        out["thinking"] = str(msg.get("thinking") or "")
        out["calls"] = msg.get("tool_calls") or []
        out["stop"] = str(resp.get("done_reason") or "")
    if resp.get("_early"):
        out["stop"] = (out["stop"] + " (cut off)").strip()
    return out


#: Request fields that hold an answer schema (OpenAI, Ollama, Responses):
#: long, so the copy names them in Settings and folds them in at the end.
_SCHEMA_KEYS = ("response_format", "format", "text")


def _settings(req: dict[str, Any]) -> dict[str, Any]:
    skip = {"messages", "system", "tools", "input", "instructions", "prompt", "stream",
            "stream_options"}
    out = {k: v for k, v in req.items() if k not in skip}
    for k in _SCHEMA_KEYS:
        if isinstance(out.get(k), dict):
            out[k] = "(answer schema, folded in below)"
    return out


def markdown(rec: dict[str, Any]) -> str:
    """The copy "Copy debug" gives: readable first, raw parts folded in."""
    tok = _tokens(rec.get("calls") or [])
    lines = [
        f"# AI debug: {rec.get('label') or rec.get('route')}",
        "",
        f"- Route: `{rec.get('route')}`",
        f"- Started: {rec.get('started')} · took {rec.get('seconds')} s · "
        f"status {rec.get('status')}",
    ]
    if rec.get("provider") or rec.get("model"):
        lines.append(f"- Provider: {rec.get('provider')} · model `{rec.get('model')}`")
    if rec.get("version"):
        lines.append(f"- Wildcard Pipeline {rec.get('version')}")
    if rec.get("asked"):
        lines.append(f"- Asked: {rec.get('asked')}")
    lines.append(f"- Model calls: {len(rec.get('calls') or [])}"
                 + (f" · tokens in {tok.get('prompt', 0)} (cached {tok.get('cached', 0)}), "
                    f"out {tok.get('output', 0)}" if tok else ""))
    if rec.get("error"):
        lines.append(f"- Error: {rec['error']}")
    if rec.get("dropped"):
        lines.append(f"- {rec['dropped']} later call(s) not recorded (the record hit its size cap)")
    for c in rec.get("calls") or []:
        req = c.get("request") if isinstance(c.get("request"), dict) else {}
        u = usage(c.get("response"))
        head = f"## Call {c.get('n')}: {c.get('path')}"
        lines += ["", head, "",
                  f"{c.get('provider') or ''} · `{c.get('model') or req.get('model') or ''}` · "
                  f"{c.get('seconds')} s{' · streamed' if c.get('streamed') else ''}"
                  + (f" · in {u.get('prompt', 0)} (cached {u.get('cached', 0)}), "
                     f"out {u.get('output', 0)}" if u else "")]
        settings = _settings(req)
        if settings:
            lines += ["", "**Settings**", "", _fence(json.dumps(settings, ensure_ascii=False,
                                                                 indent=1, default=str), "json")]
        tools = _tool_names(req)
        if tools:
            lines += ["", f"**Tools offered ({len(tools)})**: " + ", ".join(tools)]
        for role, text in _messages(req):
            lines += ["", f"**{role}**", "", _fence(text)]
        if c.get("error"):
            lines += ["", f"**Error** (status {c.get('status')}): {c['error']}"]
            if c.get("response") is not None:
                lines += ["", _fence(json.dumps(c["response"], ensure_ascii=False, indent=1,
                                                default=str), "json")]
            continue
        r = _reply(c.get("response"))
        if r["thinking"]:
            lines += ["", "**Reply: thinking**", "", _fence(r["thinking"])]
        stop = f" (stop: {r['stop']})" if r["stop"] else ""
        lines += ["", f"**Reply**{stop}", "",
                  _fence(r["text"] or "(no text)")]
        if r["calls"]:
            lines += ["", "**Reply: tool calls**", "",
                      _fence(json.dumps(r["calls"], ensure_ascii=False, indent=1, default=str),
                             "json")]
        for k in _SCHEMA_KEYS:
            if isinstance(req.get(k), dict):
                lines += ["", "<details><summary>Answer schema</summary>", "",
                          _fence(json.dumps(req[k], ensure_ascii=False, indent=1,
                                            default=str), "json"), "", "</details>"]
        if tools:
            lines += ["", "<details><summary>Tool definitions</summary>", "",
                      _fence(json.dumps(req.get("tools"), ensure_ascii=False, indent=1,
                                        default=str), "json"), "", "</details>"]
    return "\n".join(lines) + "\n"
