"""Talk to the model the user configured. Three wire formats cover them all.

- ``anthropic``: Claude's Messages API. Structured output is a forced tool
  call (``tool_choice`` names our one tool), which every Claude model supports.
- ``openai``: Chat Completions with ``response_format: json_schema``. OpenAI,
  LM Studio, llama.cpp's ``llama-server``, vLLM, OpenRouter and most other
  local servers speak it.
- ``ollama``: Ollama's native ``/api/chat``. Its ``format`` takes a JSON
  schema, and it is the only route that honours ``keep_alive``, which is how
  the model leaves the GPU to ComfyUI after a short idle.

THREAT MODEL
------------
ComfyUI has no authentication, so whoever can reach its port can call these
routes. What that person can and cannot do:

  Read the key — no. The key lives in `ai.json` (or the environment) and no
  route returns it. Responses carry the model's answer and short error
  messages only; an upstream error body is never echoed in full.

  Choose the URL per request — no. Requests take a task and its inputs; the
  address comes from the saved config. Changing the saved address is a
  Settings action, which on an open ComfyUI is reachable by the same people
  who can already queue arbitrary workflows on it.

  Have the key sent to their own server — no. A key is bound to the origin
  it was saved for (engine/ai/config.py) and sent nowhere else, so changing
  the address stops the key being sent; redirects are never followed. The
  `/wp/api/ai/*` routes also refuse cross-site requests, `Origin: null`,
  DNS-rebinding hosts and non-JSON bodies (wp_api/_ai_guard.py), whatever
  ComfyUI's own flags are.

  Spend the user's credits — yes, while the feature is enabled. That is the
  cost of the feature on an exposed ComfyUI, and why it is off by default and
  the Settings page says so. A semaphore caps concurrent calls at two, and
  inputs are size-capped, so it can't be turned into a firehose.

  Exhaust memory with a huge upstream reply — no. Bodies are read up to
  `_MAX_BODY` and refused beyond it.

Proxy handling: requests to loopback hosts ignore HTTP(S)_PROXY (a proxy
can't reach the user's own 127.0.0.1); requests elsewhere honour it, so
users behind a corporate proxy can still reach a cloud provider.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import time
import urllib.parse
from typing import Any

import aiohttp

from engine.ai import budget

_MAX_BODY = 4 * 1024 * 1024
_LIST_TIMEOUT = aiohttp.ClientTimeout(total=15)
#: Local models on a busy GPU can take minutes for a long list.
_COMPLETE_TIMEOUT = aiohttp.ClientTimeout(total=300, sock_connect=10)
_ANTHROPIC_VERSION = "2023-06-01"
_TOOL_NAME = "submit"

_semaphore = asyncio.Semaphore(2)


class AIError(Exception):
    """Anything that stopped a model call. `message` is shown to the user."""

    def __init__(self, message: str, *, status: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _is_loopback(url: str) -> bool:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _session(base_url: str, timeout: aiohttp.ClientTimeout) -> aiohttp.ClientSession:
    return aiohttp.ClientSession(timeout=timeout, trust_env=not _is_loopback(base_url))


def _headers(cfg: dict[str, Any]) -> dict[str, str]:
    key = cfg.get("api_key") or ""
    if cfg["api"] == "anthropic":
        h = {"anthropic-version": _ANTHROPIC_VERSION, "content-type": "application/json"}
        if key:
            h["x-api-key"] = key
        return h
    h = {"content-type": "application/json"}
    if key:
        h["authorization"] = f"Bearer {key}"
    return h


def _url(cfg: dict[str, Any], path: str) -> str:
    base = cfg["base_url"].rstrip("/")
    if cfg["api"] == "anthropic" and not base.endswith("/v1"):
        base += "/v1"
    return base + path


async def _read_json(resp: aiohttp.ClientResponse) -> Any:
    chunks: list[bytes] = []
    total = 0
    async for chunk in resp.content.iter_chunked(64 * 1024):
        total += len(chunk)
        if total > _MAX_BODY:
            raise AIError("the model's reply was too large")
        chunks.append(chunk)
    raw = b"".join(chunks)
    try:
        return json.loads(raw.decode("utf-8", errors="replace"))
    except ValueError as e:
        raise AIError("the server didn't answer with JSON. Is the address right?") from e


def _upstream_error(status: int, body: Any) -> AIError:
    """A short, user-facing message for a non-2xx reply."""
    detail = ""
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            detail = str(err.get("message") or "")
        elif isinstance(err, str):
            detail = err
        elif isinstance(body.get("message"), str):
            detail = body["message"]
    detail = detail.strip().replace("\n", " ")[:240]
    if status in (401, 403):
        msg = "the server refused the API key"
    elif status == 404:
        msg = "not found. Check the address and the model name"
    elif status == 429:
        msg = "the provider is rate-limiting or out of credit"
    else:
        msg = f"the server answered {status}"
    return AIError(f"{msg}{': ' + detail if detail else ''}")


async def _request(
    cfg: dict[str, Any], method: str, path: str, *,
    body: dict[str, Any] | None = None, timeout: aiohttp.ClientTimeout,
) -> Any:
    url = _url(cfg, path)
    try:
        async with _session(url, timeout) as s:
            # Never follow a redirect: aiohttp drops `Authorization` on one
            # but keeps Claude's `x-api-key`, and the key belongs to this
            # address only.
            async with s.request(method, url, json=body, headers=_headers(cfg),
                                 allow_redirects=False) as resp:
                if 300 <= resp.status < 400:
                    where = resp.headers.get("Location", "")[:200]
                    raise AIError(f"the server redirected to {where or 'another address'}. "
                                  "Use that address in Settings instead.")
                data = await _read_json(resp)
                if resp.status >= 400:
                    raise _upstream_error(resp.status, data)
                return data
    except AIError:
        raise
    except asyncio.TimeoutError as e:
        raise AIError("the model took too long to answer", status=504) from e
    except aiohttp.ClientConnectorError as e:
        raise AIError(
            f"couldn't connect to {urllib.parse.urlsplit(url).netloc}. "
            "Is the server running?",
        ) from e
    except aiohttp.ClientError as e:
        raise AIError(f"connection failed: {type(e).__name__}") from e


def _require_model(cfg: dict[str, Any]) -> None:
    if not cfg.get("base_url"):
        raise AIError("set a server address in Settings › AI assistant", status=400)
    if not cfg.get("model"):
        raise AIError("pick a model in Settings › AI assistant", status=400)


async def list_models(cfg: dict[str, Any]) -> list[str]:
    if not cfg.get("base_url"):
        raise AIError("set a server address first", status=400)
    if cfg["api"] == "ollama":
        data = await _request(cfg, "GET", "/api/tags", timeout=_LIST_TIMEOUT)
        items = data.get("models") if isinstance(data, dict) else None
        names = [m.get("name") for m in items or [] if isinstance(m, dict)]
    else:
        data = await _request(cfg, "GET", "/models", timeout=_LIST_TIMEOUT)
        items = data.get("data") if isinstance(data, dict) else None
        names = [m.get("id") for m in items or [] if isinstance(m, dict)]
    return sorted({n for n in names if isinstance(n, str) and n})


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


def _parse_text_json(text: Any) -> Any:
    """Models that ignore the schema sometimes wrap JSON in a code fence."""
    if not isinstance(text, str) or not text.strip():
        raise AIError("the model returned an empty answer")
    m = _FENCE.match(text)
    if m:
        text = m.group(1)
    try:
        return json.loads(text)
    except ValueError:
        # Last resort: the outermost {...} in a chatty answer.
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except ValueError:
                pass
    raise AIError("the model's answer wasn't valid JSON. A larger model may do better.")


def _anthropic_messages(history: list[tuple[str, Any]], user: str) -> list[dict[str, Any]]:
    """Earlier answers go back as the tool calls they were, each followed by
    its tool result, which is how the Messages API expects a forced tool
    conversation to continue."""
    messages: list[dict[str, Any]] = []
    pending: str | None = None
    for i, (asked, answer) in enumerate(history):
        content: list[dict[str, Any]] = []
        if pending:
            content.append({"type": "tool_result", "tool_use_id": pending, "content": "Shown."})
        content.append({"type": "text", "text": asked})
        messages.append({"role": "user", "content": content})
        pending = f"toolu_wp{i}"
        messages.append({"role": "assistant", "content": [{
            "type": "tool_use", "id": pending, "name": _TOOL_NAME, "input": answer,
        }]})
    if pending is None:
        messages.append({"role": "user", "content": user})
    else:
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": pending, "content": "Shown."},
            {"type": "text", "text": user},
        ]})
    return messages


def _chat_messages(system: str, history: list[tuple[str, Any]], user: str) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for asked, answer in history:
        messages.append({"role": "user", "content": asked})
        messages.append({"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)})
    messages.append({"role": "user", "content": user})
    return messages


async def complete_json(
    cfg: dict[str, Any], *, system: str, user: str, schema: dict[str, Any],
    schema_name: str, temperature: float = 0.8, max_tokens: int = 8192,
    history: list[tuple[str, Any]] | None = None,
) -> Any:
    """One request, one JSON object back, shaped by `schema` where supported.

    `history` holds earlier turns of the same conversation, oldest first, as
    (what was asked, the JSON the model answered). `user` is then the
    follow-up, and the model sees its own earlier answers.
    """
    _require_model(cfg)
    history = history or []
    if _semaphore.locked():
        raise AIError("the assistant is already busy with two requests", status=429)
    async with _semaphore:
        if cfg["api"] == "anthropic":
            data = await _request(cfg, "POST", "/messages", timeout=_COMPLETE_TIMEOUT, body={
                "model": cfg["model"],
                "max_tokens": max_tokens,
                "temperature": temperature,
                "system": system,
                "messages": _anthropic_messages(history, user),
                "tools": [{
                    "name": _TOOL_NAME,
                    "description": f"Submit the {schema_name}.",
                    "input_schema": schema,
                }],
                "tool_choice": {"type": "tool", "name": _TOOL_NAME},
            })
            blocks = data.get("content") if isinstance(data, dict) else None
            for block in blocks or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    return block.get("input")
            if isinstance(data, dict) and data.get("stop_reason") == "refusal":
                raise AIError("the model declined this request", status=422)
            raise AIError("the model didn't return the expected answer")

        if cfg["api"] == "ollama":
            data = await _request(cfg, "POST", "/api/chat", timeout=_COMPLETE_TIMEOUT, body={
                "model": cfg["model"],
                "stream": False,
                "format": schema,
                "keep_alive": f"{int(cfg.get('unload_after_s', 60))}s",
                "options": {
                    "temperature": temperature,
                    # Ollama's default window is 2-4k tokens and it cuts a
                    # longer prompt without saying so, so size it per request.
                    "num_ctx": budget.num_ctx(
                        budget.prompt_chars(system, history, user, schema),
                        int(cfg.get("context_max") or budget.CONTEXT_DEFAULT),
                    ),
                },
                "messages": _chat_messages(system, history, user),
            })
            msg = data.get("message") if isinstance(data, dict) else None
            return _parse_text_json(msg.get("content") if isinstance(msg, dict) else None)

        body: dict[str, Any] = {
            "model": cfg["model"],
            "messages": _chat_messages(system, history, user),
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": True},
            },
        }
        if cfg.get("local"):
            # OpenAI's reasoning models refuse any temperature but the
            # default, so it is only sent to local servers, which all take it.
            body["temperature"] = temperature
            # LM Studio unloads a JIT-loaded model after `ttl` idle seconds.
            # Other servers ignore unknown fields.
            ttl = int(cfg.get("unload_after_s", 60))
            if ttl > 0:
                body["ttl"] = ttl
        data = await _request(
            cfg, "POST", "/chat/completions", timeout=_COMPLETE_TIMEOUT, body=body,
        )
        choices = data.get("choices") if isinstance(data, dict) else None
        if not choices or not isinstance(choices[0], dict):
            raise AIError("the model didn't return an answer")
        message = choices[0].get("message") or {}
        if message.get("refusal"):
            raise AIError("the model declined this request", status=422)
        return _parse_text_json(message.get("content"))


_PROBE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["ok"], "properties": {"ok": {"type": "boolean"}},
}


#: Below this the chat's instructions, a few turns and its answer don't fit.
CONTEXT_WARN = 16384


async def server_context(cfg: dict[str, Any]) -> int | None:
    """The context window a local OpenAI-compatible server loaded the model
    with, when it says: LM Studio (`/api/v0/models/<id>`) or llama.cpp's
    llama-server (`/props`). These fix the window at load time, so a model
    loaded with 4k quietly loses most of the chat's prompt. Ollama takes
    `num_ctx` per request instead, and cloud providers need no check."""
    if cfg["api"] != "openai" or not cfg.get("local"):
        return None
    root = re.sub(r"/v1$", "", cfg["base_url"].rstrip("/"))
    rooted = {**cfg, "base_url": root}
    model = urllib.parse.quote(str(cfg.get("model") or ""), safe="")
    for path, read in (
        (f"/api/v0/models/{model}", lambda d: d.get("loaded_context_length")),
        ("/props", lambda d: (d.get("default_generation_settings") or {}).get("n_ctx")
            or d.get("n_ctx")),
    ):
        try:
            data = await _request(rooted, "GET", path, timeout=_LIST_TIMEOUT)
        except AIError:
            continue
        value = read(data) if isinstance(data, dict) else None
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return None


async def probe(cfg: dict[str, Any]) -> dict[str, Any]:
    """Test connection: list models, then (if one is chosen) a tiny JSON call."""
    result: dict[str, Any] = {"ok": False, "models": [], "model_found": None,
                              "json_ok": None, "latency_ms": None, "error": None,
                              "context": None, "context_low": False}
    try:
        result["models"] = await list_models(cfg)
    except AIError as e:
        result["error"] = e.message
        return result
    if not cfg.get("model"):
        result["ok"] = True
        return result
    # Some servers (llama.cpp) serve whatever is loaded and list it under a
    # file name, so a miss here is a hint, not a failure.
    result["model_found"] = cfg["model"] in result["models"]
    started = time.monotonic()
    try:
        answer = await complete_json(
            cfg, system="Answer with JSON only.", user='Reply with {"ok": true}.',
            schema=_PROBE_SCHEMA, schema_name="probe", temperature=0, max_tokens=64,
        )
        result["json_ok"] = isinstance(answer, dict) and answer.get("ok") is True
        result["ok"] = True
    except AIError as e:
        result["error"] = e.message
    result["latency_ms"] = int((time.monotonic() - started) * 1000)
    if result["ok"]:
        result["context"] = await server_context(cfg)
        result["context_low"] = (
            result["context"] is not None and result["context"] < CONTEXT_WARN
        )
    return result
