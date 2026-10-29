"""The manager with a fake AI model, for trying the bench pack without ComfyUI or a real model.

    python bench/dev/serve.py [--port 8189] [--work <folder>]

Serves the manager at http://127.0.0.1:<port>/wp/ on a fresh library in ``--work`` (a new temp
folder by default) and an OpenAI-compatible model at http://127.0.0.1:<port>/fake/v1 that answers
every JSON step with a made-up value of the requested schema, and every other request with a
short text. The AI settings point at it, so every bench step can run; the answers say nothing
about any model. Use it to check the bench's clicks after a UI change, then run the bench on a
real model.

The fake also takes a script, for tests that need one exact answer (the AI smoke pack in
``bench/smoke``). ``POST /fake/script`` with ``{"answers": [...]}`` queues answers for the next
model calls; ``DELETE /fake/script`` empties the queue; ``GET /fake/log`` lists the calls the
manager made (newest last). An answer is one of:

- ``{"calls": [{"tool": "create_wildcard", "args": {...}}]}``: a chat step that calls tools. It
  goes out as native ``tool_calls`` when the request offers tools, and in the JSON step shape
  (``{plan, message, calls}``) when it asks for one. The chat step after it, with the queue
  empty, answers "Done." so the turn ends.
- ``{"text": "..."}``: a chat reply, or the text of a plain request.
- ``{"json": {...}}``: the answer to the next request that asks for a JSON schema (an editor
  panel, the pack builder), sent as it is.

Each answer waits for the request it fits: a queued ``json`` answer is not used up by a chat
step, and a queued ``calls`` answer is not used up by a panel. With the queue empty, every
request gets the sample answer as before.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from aiohttp import web

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

MODEL = "fake-bench-model"


# ---- a value for a JSON schema ----------------------------------------------------------------


def _resolve(schema: dict[str, Any], root: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/"):
        node: Any = root
        for part in ref[2:].split("/"):
            node = node.get(part, {}) if isinstance(node, dict) else {}
        return _resolve(node, root) if isinstance(node, dict) else {}
    return schema


def sample(
    schema: Any, root: dict[str, Any] | None = None, name: str = "value", depth: int = 0
) -> Any:
    """A small value that fits ``schema`` (the parts a model's JSON schema uses)."""
    if not isinstance(schema, dict):
        return None
    root = root if root is not None else schema
    schema = _resolve(schema, root)
    if "const" in schema:
        return schema["const"]
    if schema.get("enum"):
        return schema["enum"][0]
    for key in ("anyOf", "oneOf"):
        options = [o for o in schema.get(key) or [] if _resolve(o, root).get("type") != "null"]
        if options:
            return sample(options[0], root, name, depth)
    if schema.get("allOf"):
        merged: dict[str, Any] = {}
        for part in schema["allOf"]:
            merged.update(_resolve(part, root))
        return sample(merged, root, name, depth)
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), "null")
    if kind is None:
        kind = "object" if "properties" in schema else "array" if "items" in schema else "string"
    if kind == "object":
        props: dict[str, Any] = schema.get("properties") or {}
        keys = schema.get("required") or (list(props) if depth < 6 else [])
        return {k: sample(props.get(k, {}), root, k, depth + 1) for k in keys}
    if kind == "array":
        count = max(int(schema.get("minItems") or 0), 2 if depth < 4 else 0)
        maximum = schema.get("maxItems")
        if isinstance(maximum, int):
            count = min(count, maximum)
        items = schema.get("items") or {}
        return [_unique(sample(items, root, name, depth + 1), i) for i in range(count)]
    if kind == "integer":
        return int(schema.get("minimum") or 1)
    if kind == "number":
        return float(schema.get("minimum") or 1)
    if kind == "boolean":
        return True
    if kind == "null":
        return None
    text = f"sample {name.replace('_', ' ')}"
    limit = schema.get("maxLength")
    if isinstance(limit, int):
        text = text[:limit]
    return text


def _unique(value: Any, i: int) -> Any:
    return f"{value} {i + 1}" if isinstance(value, str) and i else value


# ---- the fake model ----------------------------------------------------------------------------


class Script:
    """Queued answers for the next model calls, and a log of the calls made."""

    def __init__(self) -> None:
        self.answers: list[dict[str, Any]] = []
        self.log: list[dict[str, Any]] = []

    def take(self, kind: str) -> dict[str, Any] | None:
        """The first queued answer of this kind ("calls", "text" or "json"), taken off."""
        for i, a in enumerate(self.answers):
            if kind in a:
                return self.answers.pop(i)
        return None

    def peek(self, kind: str) -> dict[str, Any] | None:
        return next((a for a in self.answers if kind in a), None)


SCRIPT = Script()


def _schema_of(body: dict[str, Any]) -> dict[str, Any] | None:
    fmt = body.get("response_format") or {}
    schema = (fmt.get("json_schema") or {}).get("schema") if isinstance(fmt, dict) else None
    return schema if isinstance(schema, dict) else None


def _last_user_text(body: dict[str, Any]) -> str:
    for m in reversed(body.get("messages") or []):
        if isinstance(m, dict) and m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                return " ".join(str(p.get("text", "")) for p in c if isinstance(p, dict))
    return ""


def _args_for(schema: dict[str, Any], tool: str, args: Any) -> Any:
    """`args` as the step schema wants them: an object, or JSON text when it says string."""
    calls = ((schema.get("properties") or {}).get("calls") or {}).get("items") or {}
    shapes = calls.get("anyOf") or [calls]
    for shape in shapes:
        props = shape.get("properties") or {}
        enum = (props.get("tool") or {}).get("enum") or []
        if tool in enum or not enum:
            return json.dumps(args) if (props.get("args") or {}).get("type") == "string" else args
    return args


def _json_step(schema: dict[str, Any]) -> Any:
    """The answer to a JSON chat step (the step, its act half, its choose half or its answer
    half), or None when the schema isn't a chat step."""
    props = schema.get("properties") or {}
    if "tool" in props and "plan" in props and "calls" not in props:
        head = SCRIPT.peek("calls")
        names = (props["tool"] or {}).get("enum") or []
        tool = head["calls"][0]["tool"] if head else "answer"
        return {"plan": "", "tool": tool if tool in names else "answer"}
    if "calls" in props and "plan" in props:
        head = SCRIPT.take("calls")
        calls = [
            {"tool": c["tool"], "args": _args_for(schema, c["tool"], c.get("args") or {})}
            for c in (head or {}).get("calls", [])
        ]
        out: dict[str, Any] = {"plan": "", "calls": calls}
        if "message" in props:
            text = SCRIPT.take("text") if not calls else None
            out["message"] = "" if calls else (text or {}).get("text", "Done.")
        return out
    if set(props) == {"message"}:
        return {"message": (SCRIPT.take("text") or {}).get("text", "Done.")}
    return None


def answer_for(body: dict[str, Any]) -> dict[str, Any]:
    """The assistant message for a chat completions request: content, or tool calls."""
    schema = _schema_of(body)
    tools = body.get("tools") or []
    if tools and body.get("tool_choice") != "none":
        head = SCRIPT.take("calls")
        if head:
            return {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": f"call_fake{i}",
                        "type": "function",
                        "function": {
                            "name": c["tool"],
                            "arguments": json.dumps(c.get("args") or {}),
                        },
                    }
                    for i, c in enumerate(head["calls"])
                ],
            }
    if schema is not None:
        step = _json_step(schema)
        if step is not None:
            return {"role": "assistant", "content": json.dumps(step)}
        scripted = SCRIPT.take("json")
        return {
            "role": "assistant",
            "content": json.dumps(scripted["json"] if scripted else sample(schema)),
        }
    fmt = body.get("response_format") or {}
    if isinstance(fmt, dict) and fmt.get("type") == "json_object":
        scripted = SCRIPT.take("json")
        value = (
            scripted["json"]
            if scripted
            else {"message": "A made-up answer from the fake bench model."}
        )
        return {"role": "assistant", "content": json.dumps(value)}
    text = SCRIPT.take("text")
    if tools:
        return {"role": "assistant", "content": (text or {}).get("text", "Done.")}
    return {
        "role": "assistant",
        "content": (text or {}).get("text", "A made-up answer from the fake bench model."),
    }


def _note(body: dict[str, Any], message: dict[str, Any]) -> None:
    schema = _schema_of(body)
    SCRIPT.log.append(
        {
            "at": time.time(),
            "tools": [
                t.get("function", {}).get("name")
                for t in body.get("tools") or []
                if isinstance(t, dict)
            ],
            "tool_choice": body.get("tool_choice"),
            "schema": sorted((schema or {}).get("properties") or {}),
            "user": _last_user_text(body)[-2000:],
            "answer": message,
        }
    )
    del SCRIPT.log[:-200]


async def script_post(request: web.Request) -> web.Response:
    body = await request.json()
    answers = body.get("answers") if isinstance(body, dict) else None
    if not isinstance(answers, list) or not all(
        isinstance(a, dict) and ({"calls", "text", "json"} & set(a)) for a in answers
    ):
        return web.json_response(
            {"error": "answers must be a list of {calls|text|json}"}, status=400
        )
    SCRIPT.answers.extend(answers)
    return web.json_response({"queued": len(SCRIPT.answers)})


async def script_delete(_request: web.Request) -> web.Response:
    SCRIPT.answers.clear()
    SCRIPT.log.clear()
    return web.json_response({"queued": 0})


async def script_get(_request: web.Request) -> web.Response:
    return web.json_response({"queued": SCRIPT.answers, "log": SCRIPT.log})


async def capabilities(_request: web.Request) -> web.Response:
    """LM Studio's model info: says the fake takes native tools."""
    return web.json_response({"id": MODEL, "capabilities": ["tool_use"]})


async def models(_request: web.Request) -> web.Response:
    return web.json_response({"object": "list", "data": [{"id": MODEL, "object": "model"}]})


async def completions(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    message = answer_for(body)
    _note(body, message)
    text = message.get("content") or ""
    calls = message.get("tool_calls")
    await asyncio.sleep(0.3)  # long enough for the page to show it working
    created = int(time.time())
    usage = {
        "prompt_tokens": 100,
        "completion_tokens": max(1, len(text) // 4),
        "total_tokens": 100 + len(text) // 4,
    }
    finish = "tool_calls" if calls else "stop"
    if not body.get("stream") or calls:
        # Tool calls go out whole: the manager reads an answer that ignored `stream`.
        return web.json_response(
            {
                "id": "fake",
                "object": "chat.completion",
                "created": created,
                "model": MODEL,
                "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                "usage": usage,
            }
        )
    response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
    await response.prepare(request)
    for start in range(0, len(text), 40):
        chunk = {
            "id": "fake",
            "object": "chat.completion.chunk",
            "created": created,
            "model": MODEL,
            "choices": [
                {"index": 0, "delta": {"content": text[start : start + 40]}, "finish_reason": None}
            ],
        }
        await response.write(f"data: {json.dumps(chunk)}\n\n".encode())
        await asyncio.sleep(0.02)
    end = {
        "id": "fake",
        "object": "chat.completion.chunk",
        "created": created,
        "model": MODEL,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        "usage": usage,
    }
    await response.write(f"data: {json.dumps(end)}\n\ndata: [DONE]\n\n".encode())
    await response.write_eof()
    return response


# ---- the manager -------------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--port", type=int, default=8189)
    parser.add_argument(
        "--work",
        help="folder for the library, AI settings and settings (default: a new temp folder)",
    )
    args = parser.parse_args()
    work = Path(args.work) if args.work else Path(tempfile.mkdtemp(prefix="wp-bench-dev-"))
    work.mkdir(parents=True, exist_ok=True)
    os.environ["WP_DB_PATH"] = str(work / "library.db")
    os.environ["WP_AI_CONFIG_PATH"] = str(work / "ai.json")
    os.environ["WP_SETTINGS_PATH"] = str(work / "wp-settings.json")

    import wp_api  # after the environment, so it opens the work folder's files
    from engine.ai import config as ai_config

    ai_config.update(
        {
            "enabled": True,
            "provider": "lmstudio",
            "model": MODEL,
            "base_url": f"http://127.0.0.1:{args.port}/fake/v1",
            "thinking": "off",
        }
    )
    app = web.Application(client_max_size=32 * 1024 * 1024)
    app.router.add_get("/fake/v1/models", models)
    app.router.add_post("/fake/v1/chat/completions", completions)
    app.router.add_get("/fake/api/v0/models/{name}", capabilities)
    app.router.add_post("/fake/script", script_post)
    app.router.add_delete("/fake/script", script_delete)
    app.router.add_get("/fake/script", script_get)
    app.router.add_get("/fake/log", script_get)
    wp_api.register_routes(app)
    print(
        f"Manager on http://127.0.0.1:{args.port}/wp/ with a fake model; files in {work}",
        flush=True,
    )
    web.run_app(app, host="127.0.0.1", port=args.port, print=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
