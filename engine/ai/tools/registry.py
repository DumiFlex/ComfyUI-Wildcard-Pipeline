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
#: ask: questions shown in the chat (`engine/ai/ask.py`); the turn pauses
#:   until the user answers them.
KINDS = ("read", "change", "client", "web", "ask")


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


def _check(tool: str, schema: dict[str, Any], value: Any, where: str) -> Any:
    """`value` coerced to `schema`, list items and nested objects included,
    or ArgsError naming where it went wrong. A wrong list item is refused,
    never dropped: a model that wrote `[{...}, 12, 13]` meant four options."""
    value = _coerce(schema, value)
    if not _type_ok(schema, value):
        raise ArgsError(f"{tool}: {where} must be {_type_name(schema)}")
    t = schema.get("type")
    if t == "array" and isinstance(schema.get("items"), dict):
        items = schema["items"]
        return [_check(tool, items, _item(items, v), f"{where} item {i + 1}")
                for i, v in enumerate(value)]
    if t == "object" and isinstance(value, dict):
        props = schema.get("properties") or {}
        out = dict(value)
        for k, v in value.items():
            if k in props and v is not None:
                out[k] = _check(tool, props[k], v, f"{where}.{k}")
        missing = [k for k in schema.get("required") or [] if out.get(k) is None]
        if missing:
            raise ArgsError(f"{tool}: {where} is missing {', '.join(repr(k) for k in missing)}")
        return out
    return value


def _item(schema: dict[str, Any], value: Any) -> Any:
    """A bare string where an object with a "text" goes is that text."""
    if (isinstance(value, str) and schema.get("type") == "object"
            and "text" in (schema.get("properties") or {})):
        return {"text": value}
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
        out[key] = _check(tool.name, props[key], value, f'"{key}"')
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


#: Parameter names Ollama's Gemma 4 renderer drops from the prompt
#: (ollama#18468): sent to Ollama as ``name_`` and mapped back on the way in.
OLLAMA_RESERVED = frozenset({"description", "type", "properties", "required", "nullable"})


def _alias_schema(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return schema
    out = dict(schema)
    if isinstance(schema.get("properties"), dict):
        out["properties"] = {(f"{k}_" if k in OLLAMA_RESERVED else k): _alias_schema(v)
                             for k, v in schema["properties"].items()}
        if isinstance(schema.get("required"), list):
            out["required"] = [f"{k}_" if k in OLLAMA_RESERVED else k
                               for k in schema["required"]]
    if isinstance(schema.get("items"), dict):
        out["items"] = _alias_schema(schema["items"])
    if isinstance(schema.get("anyOf"), list):
        out["anyOf"] = [_alias_schema(o) for o in schema["anyOf"]]
    return out


def alias_args(value: Any, back: bool = False) -> Any:
    """Arguments with the reserved names aliased for Ollama (``back``: the
    model's ``description_`` turned into ``description`` again)."""
    if isinstance(value, list):
        return [alias_args(v, back) for v in value]
    if not isinstance(value, dict):
        return value
    out = {}
    for k, v in value.items():
        if back and isinstance(k, str) and k.endswith("_") and k[:-1] in OLLAMA_RESERVED:
            k = k[:-1]
        elif not back and k in OLLAMA_RESERVED:
            k = f"{k}_"
        out[k] = alias_args(v, back)
    return out


def native(tools: list[Tool], api: str) -> list[dict[str, Any]]:
    """Tool declarations in the provider's own format, in a fixed order so
    the request prefix stays the same from step to step."""
    out: list[dict[str, Any]] = []
    for t in tools:
        params = _strip_schema(t.params or obj())
        if api == "ollama":
            params = _alias_schema(params)
        if api == "anthropic":
            out.append({"name": t.name, "description": t.summary, "input_schema": params})
        else:
            out.append({"type": "function", "function": {
                "name": t.name, "description": t.summary, "parameters": params}})
    return out


#: The act half of a split step (`_ai_chat.split_step`) in native mode:
#: called instead of a tool when the model has what it needs, since the act
#: ask must call something. Never run; declared only in split chats.
ANSWER_TOOL = "answer"
ANSWER_SUMMARY = ("Call this instead of a tool when you have everything you need to reply: "
                  "you then write your reply to the user.")


def answer_decl(api: str) -> dict[str, Any]:
    """The `answer` tool as a native declaration."""
    params: dict[str, Any] = {"type": "object", "properties": {}}
    if api == "anthropic":
        return {"name": ANSWER_TOOL, "description": ANSWER_SUMMARY, "input_schema": params}
    return {"type": "function", "function": {
        "name": ANSWER_TOOL, "description": ANSWER_SUMMARY, "parameters": params}}


def act_schema(names: list[str], typed: list[Tool] | None = None,
               max_calls: int = 0) -> dict[str, Any]:
    """The act half of a split JSON step: a plan and the calls to make,
    none when the model is ready to answer. No message: it writes that in
    the answer half (`ANSWER_SCHEMA`). `max_calls` caps the calls per step
    (0: no cap, for hosted strict modes that may refuse maxItems)."""
    calls = dict(step_schema(names, typed)["properties"]["calls"])
    if max_calls > 0:
        calls["maxItems"] = max_calls
    return {
        "type": "object", "additionalProperties": False, "required": ["plan", "calls"],
        "properties": {"plan": {"type": "string"}, "calls": calls},
    }


#: The answer half of a split JSON step: only the message.
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False, "required": ["message"],
    "properties": {"message": {"type": "string"}},
}


def step_schema(names: list[str], typed: list[Tool] | None = None) -> dict[str, Any]:
    """The JSON-mode answer: a plan, a message and calls by name. `typed`
    (the offered tools, for local servers whose grammar follows the
    schema): each call's args are that tool's own parameters, so a small
    model can't send broken JSON or wrong argument names. Hosted strict
    mode refuses optional properties, so they get args as a string."""
    if typed:
        calls: dict[str, Any] = {"anyOf": [{
            "type": "object", "additionalProperties": False, "required": ["tool", "args"],
            "properties": {"tool": {"type": "string", "enum": [t.name]},
                           "args": _strip_schema(t.params or obj())},
        } for t in typed]}
        return {
            "type": "object", "additionalProperties": False,
            "required": ["plan", "message", "calls"],
            "properties": {"plan": {"type": "string"}, "message": {"type": "string"},
                           "calls": {"type": "array", "items": calls}},
        }
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
