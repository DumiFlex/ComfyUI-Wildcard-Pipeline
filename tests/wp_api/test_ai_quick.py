"""`complete_json(quick=True)`: the editor panels' short answers skip a local
model's reasoning on Auto, get an output limit sized to the answer, and a
model that thinks anyway is stopped and asked again without."""
from __future__ import annotations

import json

import pytest

from engine.ai import refs as ai_refs
from engine.ai import wildcard as ai_wildcard
from engine.ai import wildcard_edit as ai_edit
from tests.wp_api.test_ai_chats import _cfg, _sse, streamer  # noqa: F401
from wp_api import _ai_chat, _ai_client, _ai_progress, _ai_thinking

_SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
_OK = {"choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}]}


@pytest.fixture(autouse=True)
def _clean():
    for s in (_ai_client._JSON_THINK_OFF, _ai_client._QUICK_OFF_REFUSED, _ai_chat._NO_STREAM):
        s.clear()
    yield
    for s in (_ai_client._JSON_THINK_OFF, _ai_client._QUICK_OFF_REFUSED, _ai_chat._NO_STREAM):
        s.clear()


def _local(server, **extra):
    return {**_cfg(server), "provider": "lmstudio", "local": True, "thinking": "auto", **extra}


async def test_quick_on_auto_turns_a_local_models_thinking_off(streamer):  # noqa: F811
    streamer.state["plain"] = _OK
    answer = await _ai_client.complete_json(
        _local(streamer), system="s", user="u", schema=_SCHEMA, schema_name="t",
        max_tokens=700, quick=True)
    assert answer == {"ok": True}
    sent = streamer.state["seen"][0]
    assert sent["reasoning_effort"] == "none" and sent["max_tokens"] == 700


async def test_without_quick_auto_sends_no_switch(streamer):  # noqa: F811
    streamer.state["plain"] = _OK
    await _ai_client.complete_json(_local(streamer), system="s", user="u", schema=_SCHEMA,
                                   schema_name="t", max_tokens=700)
    sent = streamer.state["seen"][0]
    assert "reasoning_effort" not in sent and sent["max_tokens"] == 700


async def test_quick_leaves_cloud_models_alone_and_keeps_room_to_think(streamer):  # noqa: F811
    streamer.state["plain"] = _OK
    cfg = {**_cfg(streamer), "provider": "openrouter", "thinking": "auto"}
    await _ai_client.complete_json(cfg, system="s", user="u", schema=_SCHEMA, schema_name="t",
                                   max_tokens=700, quick=True)
    sent = streamer.state["seen"][0]
    assert "reasoning" not in sent and "reasoning_effort" not in sent
    assert sent["max_tokens"] == _ai_client.THINKING_MAX_TOKENS


async def test_a_model_that_refuses_the_off_switch_is_asked_as_is_from_then_on(streamer):  # noqa: F811
    seen = streamer.state["seen"]
    real = _ai_client._answer

    async def fake(cfg_, path, body, kind, **kw):
        if body.get("reasoning_effort") == "none":
            err = _ai_client.AIError("reasoning_effort none is not supported")
            err.upstream = 400
            seen.append(dict(body))
            raise err
        streamer.state["plain"] = _OK
        return await real(cfg_, path, body, kind, **kw)

    _ai_client._answer = fake
    try:
        cfg = _local(streamer)
        await _ai_client.complete_json(cfg, system="s", user="u", schema=_SCHEMA,
                                       schema_name="t", max_tokens=700, quick=True)
        assert seen[0]["reasoning_effort"] == "none"
        assert "reasoning_effort" not in seen[1]
        assert seen[1]["max_tokens"] == _ai_client.THINKING_MAX_TOKENS
        await _ai_client.complete_json(cfg, system="s", user="u", schema=_SCHEMA,
                                       schema_name="t", max_tokens=700, quick=True)
        assert len(seen) == 3 and "reasoning_effort" not in seen[2]
    finally:
        _ai_client._answer = real


async def test_watchdog_stops_long_thinking_and_asks_without(streamer, monkeypatch):  # noqa: F811
    monkeypatch.setattr(_ai_client, "QUICK_THINK_CHARS", 300)

    async def as_is(cfg_):
        return cfg_

    monkeypatch.setattr(_ai_thinking, "fitted", as_is)
    # Thinking on: the first ask lets it think.
    cfg = _local(streamer, thinking="on")
    streamer.state["body"] = _sse(
        *[{"choices": [{"delta": {"reasoning_content": "Wait, let me check. "}}]}] * 40,
        {"choices": [{"delta": {"content": '{"ok": false}'}, "finish_reason": "stop"}]},
    )
    seen = streamer.state["seen"]
    real = _ai_client._answer

    async def fake(cfg_, path, body, kind, **kw):
        if seen:
            streamer.state["body"] = _sse(
                {"choices": [{"delta": {"content": '{"ok": true}'}, "finish_reason": "stop"}]})
        return await real(cfg_, path, body, kind, **kw)

    _ai_progress.begin("quick-watch-1")
    token = _ai_progress.current.set("quick-watch-1")
    _ai_client._answer = fake
    try:
        answer = await _ai_client.complete_json(
            cfg, system="s", user="u", schema=_SCHEMA, schema_name="t",
            max_tokens=700, quick=True)
    finally:
        _ai_client._answer = real
        _ai_progress.current.reset(token)
        _ai_progress.finish("quick-watch-1")
    assert answer == {"ok": True}
    assert seen[0]["reasoning_effort"] == "medium"
    assert seen[0]["max_tokens"] == _ai_client.THINKING_MAX_TOKENS
    assert seen[1]["reasoning_effort"] == "none" and seen[1]["max_tokens"] == 700
    assert (cfg["base_url"], cfg["model"]) in _ai_client._JSON_THINK_OFF
    assert _ai_progress.view("quick-watch-1")["calls"] == 2


async def test_an_ignored_off_switch_gets_room_to_think_from_then_on(streamer):  # noqa: F811
    thought = {"choices": [{"message": {"content": "", "reasoning_content": "hmm " * 50},
                            "finish_reason": "length"}]}
    seen = streamer.state["seen"]
    real = _ai_client._answer

    async def fake(cfg_, path, body, kind, **kw):
        streamer.state["plain"] = thought if len(seen) == 0 else _OK
        return await real(cfg_, path, body, kind, **kw)

    _ai_client._answer = fake
    try:
        cfg = _local(streamer)
        answer = await _ai_client.complete_json(cfg, system="s", user="u", schema=_SCHEMA,
                                                schema_name="t", max_tokens=700, quick=True)
        assert answer == {"ok": True}
        assert seen[0]["reasoning_effort"] == "none" and seen[0]["max_tokens"] == 700
        assert "reasoning_effort" not in seen[1]
        assert seen[1]["max_tokens"] == _ai_client.THINKING_MAX_TOKENS
        await _ai_client.complete_json(cfg, system="s", user="u", schema=_SCHEMA,
                                       schema_name="t", max_tokens=700, quick=True)
        assert "reasoning_effort" not in seen[2]
        assert seen[2]["max_tokens"] == _ai_client.THINKING_MAX_TOKENS
    finally:
        _ai_client._answer = real


async def test_progress_counts_thinking(streamer, monkeypatch):  # noqa: F811
    streamer.state["body"] = _sse(
        *[{"choices": [{"delta": {"reasoning_content": "x" * 100}}]}] * 12,
        {"choices": [{"delta": {"content": '{"ok": true}'}, "finish_reason": "stop"}]},
    )
    tokens: list[int] = []
    real = _ai_progress.thought

    def spy(chars):
        real(chars)
        v = _ai_progress.view("quick-watch-2")
        if v["phase"] == "thinking":
            tokens.append(v["tokens"])

    monkeypatch.setattr(_ai_progress, "thought", spy)
    _ai_progress.begin("quick-watch-2")
    token = _ai_progress.current.set("quick-watch-2")
    try:
        await _ai_client.complete_json(_cfg(streamer), system="s", user="u", schema=_SCHEMA,
                                       schema_name="t")
    finally:
        _ai_progress.current.reset(token)
        _ai_progress.finish("quick-watch-2")
    assert tokens and max(tokens) >= 250


def test_meter_counts_an_open_think_tag_and_spares_a_started_answer():
    meter = _ai_client._meter(20)
    meter(0, "<think>short")
    with pytest.raises(_ai_client._Overthought):
        meter(0, "<think>" + "a" * 20)
    meter(50, '{"ok": tr')  # the answer began: never stopped


def test_panel_sizes():
    assert ai_wildcard.over_ask(1) == 2 and ai_wildcard.over_ask(3) == 4
    assert ai_wildcard.over_ask(10) == 14 and ai_wildcard.over_ask(100) == 100
    assert ai_wildcard.answer_tokens(4) == 1200 and ai_wildcard.answer_tokens(100) == 8192
    assert ai_edit.answer_tokens("reweight", 10) == 650
    assert ai_edit.answer_tokens("rewrite", 300) == 8192


def test_refs_describe_counts_the_rest_without_the_excluded_row():
    rows = [{"id": f"{i:08x}", "type": "wildcard", "name": f"W{i}", "payload": {}}
            for i in range(5)]
    idx = ai_refs.RefIndex(rows)
    text = idx.describe(limit=3, exclude="00000000")
    assert "@{W0}" not in text and text.endswith("(+1 more)")
    assert "more" not in idx.describe(limit=4, exclude="00000000")


async def test_add_asks_once_more_when_options_set_another_concept(wp_client, fake_llm):
    from engine.ai import config as ai_config

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})

    def opts(*texts):
        return {"axes": [], "options": [{"text": t, "weight": 1, "tags": [], "negative": ""}
                                        for t in texts]}

    fake_llm.overrides["wildcard_options"] = [
        opts("ponytail with a red dress", "braid and blue jeans", "bob cut"),
        opts("ponytail", "braid", "bob cut")]
    body = {"instruction": "3 hair styles", "count": 3, "wildcard": {
        "name": "Hair style", "var_binding": "hair_style",
        "payload": {"options": [], "sub_categories": []}}}
    resp = await wp_client.post("/wp/api/ai/wildcard/draft", json=body)
    out = await resp.json()
    assert [o["value"] for o in out["options"]] == ["ponytail", "braid", "bob cut"]
    asks = [s for s in fake_llm.seen if "response_format" in s["body"]]
    assert len(asks) == 2 and "also set clothing" in json.dumps(asks[1]["body"]["messages"])
    # Asked for: no second ask.
    fake_llm.overrides["wildcard_options"] = [opts("ponytail with a red dress", "braid and "
                                                   "blue jeans", "bob cut")]
    body["instruction"] = "3 hair styles, each with a dress"
    before = len(fake_llm.seen)
    out = await (await wp_client.post("/wp/api/ai/wildcard/draft", json=body)).json()
    assert len(out["options"]) == 3 and len(fake_llm.seen) == before + 1


def _text_body(kind, instruction):
    item = ({"name": "Cozy room", "payload": {"values": []}} if kind == "fixed_values"
            else {"name": "Portrait", "template_string": ""})
    return {"kind": kind, "instruction": instruction, "item": item}


async def test_a_text_answer_cut_off_is_asked_once_more_with_a_sized_limit(
        wp_client, fake_llm, monkeypatch):
    from engine.ai import config as ai_config
    from engine.ai import text_items

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    seen = []
    answers = [_ai_client.AIError(_ai_client.CUT_OFF_MESSAGE),
               {"template": "$who, rain", "negative": ""}]

    async def fake(cfg, **kwargs):
        seen.append(kwargs)
        got = answers.pop(0)
        if isinstance(got, Exception):
            raise got
        return got

    monkeypatch.setattr(_ai_client, "complete_json", fake)
    resp = await wp_client.post("/wp/api/ai/text/draft",
                                json=_text_body("template", "a portrait in the rain"))
    assert resp.status == 200, await resp.text()
    assert len(seen) == 2
    assert all(k["max_tokens"] == text_items.answer_tokens("template") < 8192 for k in seen)
    # Twice cut off: the error stands.
    answers[:] = [_ai_client.AIError(_ai_client.CUT_OFF_MESSAGE)] * 2
    resp = await wp_client.post("/wp/api/ai/text/draft",
                                json=_text_body("template", "a portrait in the rain"))
    assert resp.status == 502 and len(seen) == 4


async def test_fixed_values_ask_once_more_for_a_variable_the_request_names(wp_client, fake_llm):
    from engine.ai import config as ai_config

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})

    def vals(**kv):
        return {"values": [{"name": k, "value": v, "negative": ""} for k, v in kv.items()]}

    fake_llm.overrides["fixed_values"] = [vals(room="bedroom"),
                                          vals(room="bedroom", light="warm lamp light")]
    body = _text_body("fixed_values", "$room is bedroom and $light is warm lamp light")
    out = await (await wp_client.post("/wp/api/ai/text/draft", json=body)).json()
    assert {v["name"] for v in out["payload"]["values"]} == {"room", "light"}
    asks = [s for s in fake_llm.seen if "response_format" in s["body"]]
    assert len(asks) == 2 and "Set $light too" in json.dumps(asks[1]["body"]["messages"])
    # All set the first time: one ask.
    fake_llm.overrides["fixed_values"] = [vals(room="bedroom", light="lamp")]
    before = len(fake_llm.seen)
    await wp_client.post("/wp/api/ai/text/draft", json=body)
    assert len(fake_llm.seen) == before + 1


async def test_a_template_asks_once_more_for_a_variable_the_request_names(wp_client, fake_llm):
    from engine.ai import config as ai_config

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    fake_llm.overrides["prompt_template"] = [{"template": "$hair", "negative": ""},
                                             {"template": "$hair, $sky", "negative": ""}]
    body = _text_body("template", "a portrait with $hair and $sky")
    await wp_client.post("/wp/api/ai/text/draft", json=body)
    asks = [s for s in fake_llm.seen if "response_format" in s["body"]]
    assert len(asks) == 2 and "Read $sky too" in json.dumps(asks[1]["body"]["messages"])


async def test_fixed_values_send_a_short_catalog(wp_client, fake_llm, monkeypatch):
    from engine.ai import config as ai_config
    from engine.ai import library_vars, text_items

    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": "m1"})
    seen = []
    real = library_vars.describe_for

    def spy(catalog, request, **kw):
        seen.append(kw)
        return real(catalog, request, **kw)

    monkeypatch.setattr(library_vars, "describe_for", spy)
    fake_llm.overrides["fixed_values"] = {"values": [
        {"name": "room", "value": "bedroom", "negative": ""}]}
    await wp_client.post("/wp/api/ai/text/draft",
                         json=_text_body("fixed_values", "$room is bedroom"))
    fake_llm.overrides["prompt_template"] = {"template": "$room", "negative": ""}
    await wp_client.post("/wp/api/ai/text/draft", json=_text_body("template", "a room"))
    # Fixed values read no variable: a few for the style, the rest by name.
    assert seen == [{"keep": text_items.FIXED_CATALOG_VARS,
                     "values": text_items.FIXED_CATALOG_VALUES},
                    {"keep": library_vars.MAX_VARS_FOCUSED,
                     "values": library_vars.MAX_VALUES_SHOWN}]
