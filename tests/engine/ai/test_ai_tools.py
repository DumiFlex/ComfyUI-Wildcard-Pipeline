"""The chat's tool registry: one declaration per tool, checked calls."""
from __future__ import annotations

import json

import pytest

from engine.ai import chat, client_tools, tools


def test_every_tool_has_code_and_a_matching_prompt_line():
    for t in tools.TOOLS:
        assert t.kind in ("read", "change", "client", "web", "ask")
        if t.kind in ("client", "web", "ask"):
            # Checked here, run by the browser (or the server once allowed).
            assert t.name in client_tools._PREPARE, t.name
        else:
            assert t.name == "more_tools" or callable(getattr(chat.Library, t.name, None)), t.name
        props = set(t.params.get("properties") or {})
        missing = [p for p in props if f'"{p}"' not in t.line]
        assert not missing, (t.name, missing)
        assert t.summary.strip() and t.line.startswith("{"), t.name


def test_prompt_lists_tools_from_the_registry():
    head = chat.system_prompt(slim=True)
    for t in tools.TOOLS:
        if t.name != "more_tools" and t.kind != "web" and t.name not in tools.DELETE + tools.VOCAB:
            assert f"- {t.name} " in head
    assert "- web_search " not in head and "Page tools (run in the user's browser" in head
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
    # Web search only once the user set up an engine.
    assert "web_search" not in tools.toolset(None, scoped=False)
    assert "web_search" in tools.toolset(None, scoped=False, web=True)
    # Deleting only once the user allowed it, scoped or not.
    assert "delete_items" not in tools.toolset(None, scoped=False)
    assert "delete_items" not in tools.toolset("all", scoped=True)
    assert "delete_items" in tools.toolset(None, scoped=False, delete=True)
    assert "delete_items" in tools.toolset("all", scoped=True, delete=True)
    assert "edit_tags" in tools.toolset("all", scoped=True)


def test_sync_delete_adds_and_removes_in_catalog_order():
    base = tools.toolset(None, scoped=False)
    on = tools.sync_delete(base, True)
    assert on == tools.toolset(None, scoped=False, delete=True)
    assert tools.sync_delete(on, True) is on  # unchanged: same list back
    assert tools.sync_delete(on, False) == base
    assert tools.sync_delete(base, False) is base
    assert "web_search" in tools.toolset("wildcards", scoped=True, web=True)
    lists = tools.toolset("all", scoped=True)
    assert "select_rows" in lists and "organize" in lists and "show_test" not in lists
    assert "show_test" in tools.toolset("test", scoped=True)
    assert "draft_options" in tools.toolset("wildcards-edit", scoped=True)


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


def test_check_args_checks_list_items():
    add = tools.BY_NAME["add_options"]
    # Seen with a 12B: four options meant, one object and three numbers sent.
    with pytest.raises(tools.ArgsError, match='"options" item 2 must be an object'):
        tools.check_args(add, {"id": "w", "options": [{"text": "crouching"}, 12, 13, 14]})
    with pytest.raises(tools.ArgsError, match="item 1 is missing 'text'"):
        tools.check_args(add, {"id": "w", "options": [{"weight": 2}]})
    with pytest.raises(tools.ArgsError, match=r"item 1\.weight"):
        tools.check_args(add, {"id": "w", "options": [{"text": "a", "weight": "lots"}]})
    # A bare string is an option's text; nested numbers are coerced.
    args, _ = tools.check_args(add, {"id": "w", "options": ["a", {"text": "b", "weight": "2"}]})
    assert args["options"] == [{"text": "a"}, {"text": "b", "weight": 2}]


def test_unapplied_proposals_say_so():
    lib = chat.Library([], [], [])
    lib.earlier_proposals = {"p3": {"title": "New wildcard Outfit — Victorian", "status": None}}
    assert "only proposed (p3" in lib.not_found("Outfit — Victorian")
    assert "search for it" in lib.not_found("Hat")
    # Opening it opens its card in an editor instead.
    args, label = client_tools.prepare(lib, "open", {"id": "Outfit — Victorian"})
    assert args == {"proposal": "p3"} and "in an editor" in label


def test_highlight_takes_the_key_with_its_brackets():
    lib = chat.Library([], [], [])
    args, _ = client_tools.prepare(lib, "highlight", {"anchor": "[settings]"})
    assert args["points"] == [{"anchor": "settings", "caption": ""}]


def test_step_schema_names_the_offered_tools():
    schema = tools.step_schema(["search", "read"])
    assert schema["properties"]["calls"]["items"]["properties"]["tool"]["enum"] == [
        "search", "read"]


def test_typed_step_schema_gives_each_tool_its_own_args():
    schema = tools.step_schema(["search", "read"], tools.tools(["search", "read"]))
    options = schema["properties"]["calls"]["items"]["anyOf"]
    assert [o["properties"]["tool"]["enum"] for o in options] == [["search"], ["read"]]
    read = options[1]["properties"]["args"]
    assert read["type"] == "object" and "id" in read["properties"]


def test_the_typed_prompt_shows_args_as_objects():
    typed = chat.system_prompt(typed=True)
    assert "the arguments as a JSON object" in typed and "written as a string" not in typed
    assert '"args": {"' in typed
    assert "written as a string" in chat.system_prompt()


def test_the_leanest_prompt_keeps_the_example_and_the_rules():
    from engine.ai import budget, safety

    lean = chat.system_prompt(slim=True, **{k: v for k, v in budget.LEVELS[-1].items()
                                            if k in ("examples", "prose")})
    assert "Example. User:" in lean and safety.UNTRUSTED_RULE in lean
    assert "Per-use settings" not in lean
    assert len(lean) < len(chat.system_prompt(slim=True, examples=False))


def test_open_with_nothing_to_open_is_refused_with_a_reason():
    lib = chat.Library([], [], [])
    with pytest.raises(ValueError, match="already on screen"):
        client_tools.prepare(lib, "open", {"id": " "})
