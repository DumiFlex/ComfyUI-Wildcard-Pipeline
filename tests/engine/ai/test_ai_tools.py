"""The chat's tool registry: one declaration per tool, checked calls."""
from __future__ import annotations

import json

import pytest

from engine.ai import chat, tools


def test_every_tool_has_code_and_a_matching_prompt_line():
    for t in tools.TOOLS:
        assert t.kind in ("read", "change")
        assert t.name == "more_tools" or callable(getattr(chat.Library, t.name, None)), t.name
        props = set(t.params.get("properties") or {})
        missing = [p for p in props if f'"{p}"' not in t.line]
        assert not missing, (t.name, missing)
        assert t.summary.strip() and t.line.startswith("{"), t.name


def test_prompt_lists_tools_from_the_registry():
    head = chat.system_prompt(slim=True)
    for t in tools.TOOLS:
        if t.name != "more_tools":
            assert f"- {t.name} " in head
    native = chat.system_prompt(slim=True, native=True)
    assert "Read tools:" not in native and "plain text without calling a tool" in native
    scoped = chat.system_prompt(slim=True, tools=tools.toolset("templates", scoped=True))
    assert "- create_template " in scoped and "- create_wildcard " not in scoped


def test_toolsets():
    assert "more_tools" not in tools.toolset("wildcards", scoped=False)
    small = tools.toolset("derivations-edit", scoped=True)
    assert small[-1] == "more_tools" and "edit_rules" in small and "create_bundle" not in small
    assert "search" in small and "run_test" in small
    assert "plan_pack" in tools.toolset(None, scoped=True)


def test_native_declarations():
    chosen = tools.tools(["read", "search"])
    assert [t.name for t in chosen] == ["search", "read"]  # catalog order
    oa = tools.native(chosen, "openai")
    assert oa[0]["type"] == "function" and oa[0]["function"]["name"] == "search"
    assert oa[1]["function"]["parameters"]["required"] == ["id"]
    an = tools.native(chosen, "anthropic")
    assert an[1] == {"name": "read", "description": chosen[1].summary,
                     "input_schema": chosen[1].params}
    json.dumps(tools.native(tools.TOOLS, "openai"))


def test_check_args():
    run = tools.BY_NAME["run_test"]
    args, notes = tools.check_args(run, {"stack": "Hair", "seeds": "50", "proposed": "true",
                                         "why": "x"})
    assert args == {"stack": ["Hair"], "seeds": 50, "proposed": True}
    assert notes and "why" in notes[0]
    with pytest.raises(tools.ArgsError, match="missing 'stack'"):
        tools.check_args(run, {})
    with pytest.raises(tools.ArgsError, match="seeds"):
        tools.check_args(run, {"stack": ["a"], "seeds": "lots"})
    with pytest.raises(tools.ArgsError, match="JSON object"):
        tools.check_args(run, ["a"])
    opts = tools.BY_NAME["edit_options"]
    args, _ = tools.check_args(opts, {"id": "x", "remove": "[1, 2]", "fallback": 2.0})
    assert args == {"id": "x", "remove": [1, 2], "fallback": 2}
    assert tools.check_args(tools.BY_NAME["read"], {"id": "a", "extra": None})[0] == {"id": "a"}


def test_step_schema_names_the_offered_tools():
    schema = tools.step_schema(["search", "read"])
    assert schema["properties"]["calls"]["items"]["properties"]["tool"]["enum"] == [
        "search", "read"]
