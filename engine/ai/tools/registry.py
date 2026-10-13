"""The chat's tools, declared once.

Every tool the chat model may call is one `Tool` in `catalog.TOOLS`. From
that one entry come:

- the JSON-mode prompt line (`prompt_lines`), for models that answer in
  our JSON step format;
- the native tool declarations (`native`) for Ollama, OpenAI-compatible
  servers and Claude, which models are fine-tuned to call;
- the argument check every call goes through before it runs
  (`check_args`): unknown tools are refused, unknown arguments are dropped
  and named back to the model, and simple wrong types are coerced or
  refused. The model never reaches code the registry doesn't list.

Tools are grouped so a small model sees only what its page needs
(`toolset`); `more_tools` adds the rest for the chat.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

#: read: runs on the server and its result goes back to the model.
#: change: compiled into a proposal card; nothing is written.
#: client: runs in the user's browser (navigate, point, drive an AI panel);
#:   the turn pauses until the browser posts the result back.
#: web: leaves the machine (web search); the turn pauses until the user
#:   allows it, then the server runs it.
KINDS = ("read", "change", "client", "web")


@dataclass(frozen=True)
class Tool:
    name: str
    kind: str
    #: One sentence for native declarations.
    summary: str
    #: The JSON-mode prompt line after "- name ": its arguments as an object
    #: sketch, then what it does.
    line: str
    #: JSON schema of the arguments (an object).
    params: dict[str, Any] = field(default_factory=dict)
    #: Groups that offer it to a small model ("core" goes everywhere).
    groups: tuple[str, ...] = ()


def obj(props: dict[str, Any] | None = None, required: tuple[str, ...] = (),
        desc: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {"type": "object", "properties": props or {}}
    if required:
        out["required"] = list(required)
    if desc:
        out["description"] = desc
    return out


def s(desc: str = "", **extra: Any) -> dict[str, Any]:
    return {"type": "string", **({"description": desc} if desc else {}), **extra}


def n(desc: str = "", integer: bool = False) -> dict[str, Any]:
    return {"type": "integer" if integer else "number", **({"description": desc} if desc else {})}


def b(desc: str = "") -> dict[str, Any]:
    return {"type": "boolean", **({"description": desc} if desc else {})}


def arr(items: dict[str, Any], desc: str = "") -> dict[str, Any]:
    return {"type": "array", "items": items, **({"description": desc} if desc else {})}


def any_of(*options: dict[str, Any], desc: str = "") -> dict[str, Any]:
    return {"anyOf": list(options), **({"description": desc} if desc else {})}


# ── argument checking ───────────────────────────────────────────────────


class ArgsError(ValueError):
    """A call's arguments can't be used. The message goes back to the model."""


def _type_ok(schema: dict[str, Any], value: Any) -> bool:
    if "anyOf" in schema:
        return any(_type_ok(o, value) for o in schema["anyOf"])
    t = schema.get("type")
    if t is None:
        return True
    if t == "string":
        return isinstance(value, str)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "array":
        return isinstance(value, list)
    if t == "object":
        return isinstance(value, dict)
    return True


def _coerce(schema: dict[str, Any], value: Any) -> Any:
    """Small models write "100" for 100 and "true" for true; take those."""
    t = schema.get("type")
    if isinstance(value, str):
        text = value.strip()
        if t in ("integer", "number"):
            try:
                num = float(text)
            except ValueError:
                return value
            return int(num) if t == "integer" and num.is_integer() else num
        if t == "boolean" and text.lower() in ("true", "false"):
            return text.lower() == "true"
        if t == "array" and text.startswith("["):
            try:
                parsed = json.loads(text)
            except ValueError:
                return value
            return parsed if isinstance(parsed, list) else value
    if t == "array" and isinstance(value, (str, dict)) and value != "":
        # One item where a list goes.
        items = schema.get("items") or {}
        if _type_ok(items, value):
            return [value]
    if t == "integer" and isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _type_name(schema: dict[str, Any]) -> str:
    if "anyOf" in schema:
        return " or ".join(_type_name(o) for o in schema["anyOf"])
    return {"string": "text", "integer": "a whole number", "number": "a number",
            "boolean": "true or false", "array": "a list", "object": "an object"}.get(
        str(schema.get("type")), str(schema.get("type")))


def check_args(tool: Tool, args: Any) -> tuple[dict[str, Any], list[str]]:
    """The call's arguments as the tool takes them, plus notes for the model
    about what was dropped. Raises ArgsError for anything unusable."""
    if not isinstance(args, dict):
        raise ArgsError(f"{tool.name}: arguments must be a JSON object")
    props: dict[str, Any] = tool.params.get("properties") or {}
    out: dict[str, Any] = {}
    unknown: list[str] = []
    for key, value in args.items():
        if key not in props:
            unknown.append(str(key)[:40])
            continue
        if value is None:
            continue
        schema = props[key]
        value = _coerce(schema, value)
        if not _type_ok(schema, value):
            raise ArgsError(f"{tool.name}: \"{key}\" must be {_type_name(schema)}")
        out[key] = value
    missing = [k for k in tool.params.get("required") or [] if k not in out]
    if missing:
        raise ArgsError(f"{tool.name}: missing {', '.join(repr(k) for k in missing)}")
    notes = []
    if unknown:
        notes.append(f"{tool.name} ignored unknown arguments: {', '.join(unknown[:8])} "
                     f"(it takes {', '.join(props) or 'none'})")
    return out, notes


# ── rendering ───────────────────────────────────────────────────────────


def prompt_lines(tools: list[Tool], kind: str) -> str:
    """The JSON-mode list of one kind of tool, one "- name …" line each."""
    return "\n".join(f"- {t.name} {t.line}" for t in tools if t.kind == kind)


def _strip_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """A copy safe for every provider: no keywords some servers choke on."""
    out: dict[str, Any] = {}
    for k, v in schema.items():
        if k == "properties" and isinstance(v, dict):
            out[k] = {pk: _strip_schema(pv) for pk, pv in v.items()}
        elif k == "items" and isinstance(v, dict):
            out[k] = _strip_schema(v)
        elif k == "anyOf" and isinstance(v, list):
            out[k] = [_strip_schema(o) for o in v]
        else:
            out[k] = v
    return out


def native(tools: list[Tool], api: str) -> list[dict[str, Any]]:
    """Tool declarations in the provider's own format, in a fixed order so
    the request prefix stays the same from step to step."""
    out: list[dict[str, Any]] = []
    for t in tools:
        params = _strip_schema(t.params or obj())
        if api == "anthropic":
            out.append({"name": t.name, "description": t.summary, "input_schema": params})
        else:
            out.append({"type": "function", "function": {
                "name": t.name, "description": t.summary, "parameters": params}})
    return out


def step_schema(names: list[str]) -> dict[str, Any]:
    """The JSON-mode answer: a plan, a message and calls by name."""
    return {
        "type": "object", "additionalProperties": False,
        "required": ["plan", "message", "calls"],
        "properties": {
            # Written first, so the model decides before it calls. Never
            # shown; it stays in the step history the model sees next.
            "plan": {"type": "string"},
            "message": {"type": "string"},
            "calls": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "required": ["tool", "args"],
                    "properties": {
                        "tool": {"type": "string", "enum": list(names)},
                        "args": {"type": "string"},
                    },
                },
            },
        },
    }
