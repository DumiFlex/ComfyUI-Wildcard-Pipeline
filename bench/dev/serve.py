"""The manager with a fake AI model, for trying the bench pack without ComfyUI or a real model.

    python bench/dev/serve.py [--port 8189] [--work <folder>]

Serves the manager at http://127.0.0.1:<port>/wp/ on a fresh library in ``--work`` (a new temp
folder by default) and an OpenAI-compatible model at http://127.0.0.1:<port>/fake/v1 that answers
every JSON step with a made-up value of the requested schema, and every other request with a
short text. The AI settings point at it, so every bench step can run; the answers say nothing
about any model. Use it to check the bench's clicks after a UI change, then run the bench on a
real model.
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


def answer_for(body: dict[str, Any]) -> str:
    fmt = body.get("response_format") or {}
    schema = (fmt.get("json_schema") or {}).get("schema") if isinstance(fmt, dict) else None
    if isinstance(schema, dict):
        return json.dumps(sample(schema))
    if isinstance(fmt, dict) and fmt.get("type") == "json_object":
        return json.dumps({"message": "A made-up answer from the fake bench model."})
    return "A made-up answer from the fake bench model."


async def models(_request: web.Request) -> web.Response:
    return web.json_response({"object": "list", "data": [{"id": MODEL, "object": "model"}]})


async def completions(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    text = answer_for(body)
    await asyncio.sleep(0.3)  # long enough for the page to show it working
    created = int(time.time())
    usage = {
        "prompt_tokens": 100,
        "completion_tokens": max(1, len(text) // 4),
        "total_tokens": 100 + len(text) // 4,
    }
    if not body.get("stream"):
        return web.json_response(
            {
                "id": "fake",
                "object": "chat.completion",
                "created": created,
                "model": MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
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
    wp_api.register_routes(app)
    print(
        f"Manager on http://127.0.0.1:{args.port}/wp/ with a fake model; files in {work}",
        flush=True,
    )
    web.run_app(app, host="127.0.0.1", port=args.port, print=None)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
