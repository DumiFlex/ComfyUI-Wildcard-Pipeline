"""The Thinking setting fitted to each model: what the server lists, what the
name says, what gets sent, and a refused value remembered. See
`/pr-drafts/thinking-levels-per-model.md`."""
from __future__ import annotations

from engine.ai import config as ai_config
from tests.wp_api.test_ai_api import _chat
from wp_api import _ai_thinking as th


def _lms(fake_llm, model, thinking):
    ai_config.update({"enabled": True, "provider": "lmstudio",
                      "base_url": str(fake_llm.make_url("/v1")), "model": model,
                      "thinking": thinking})


def test_lmstudio_lists_on_off_and_levels():
    hybrid = th.from_lmstudio({"capabilities": {
        "reasoning": {"allowed_options": ["off", "on"], "default": "on"}}})
    assert hybrid["kind"] == "switch" and hybrid["default"] == "on"
    leveled = th.from_lmstudio({"capabilities": {
        "reasoning": {"allowed_options": ["off", "low", "high"], "default": "low"}}})
    assert leveled["kind"] == "levels" and leveled["options"] == ["low", "high"]
    assert leveled["can_off"]
    assert th.from_lmstudio({"capabilities": {"vision": True}})["kind"] == "none"


def test_openrouter_efforts_and_mandatory_reasoning():
    seen = th.from_openrouter({"reasoning": {
        "supported_efforts": ["max", "xhigh", "high", "medium", "low"], "mandatory": True}})
    assert seen["options"] == ["low", "medium", "high", "xhigh", "max"]
    assert not seen["can_off"]
    flash = th.from_openrouter({"reasoning": {"supported_efforts": ["xhigh", "high", "none"]}})
    assert flash["options"] == ["high", "xhigh"] and flash["can_off"]
    assert th.from_openrouter({"reasoning": {"mandatory": False}})["kind"] == "switch"
    assert th.from_openrouter({"id": "x"})["kind"] == "none"


def test_claude_models_api_and_ollama_show():
    caps = {"capabilities": {"effort": {"supported": True, "low": {"supported": True},
                                        "medium": {"supported": True},
                                        "high": {"supported": True},
                                        "xhigh": {"supported": False},
                                        "max": {"supported": True}}}}
    info = th.from_claude(caps, "claude-opus-4-6")
    assert info["options"] == ["low", "medium", "high", "max"] and info["can_off"]
    assert not th.from_claude(caps, "claude-opus-5-5")["can_off"]
    assert th.from_claude({"capabilities": {"effort": {"supported": False}}},
                          "claude-haiku-4-5")["kind"] == "none"
    oss = th.from_ollama({"capabilities": ["completion", "thinking"],
                          "thinking": {"values": ["low", "medium", "high"]}})
    assert oss["kind"] == "levels" and not oss["can_off"]
    assert th.from_ollama({"capabilities": ["completion", "thinking"],
                           "thinking": {"values": [True, False]}})["kind"] == "switch"
    assert th.from_ollama({"capabilities": ["completion"]})["kind"] == "none"


def test_names_say_what_cloud_models_take():
    def name(api, model, **kw):
        return th.by_name({"api": api, "model": model, "local": False, **kw})
    assert name("openai", "gpt-5.2")["options"] == ["low", "medium", "high", "xhigh"]
    assert name("openai", "gpt-5.2")["can_off"]
    assert not name("openai", "gpt-6.1-sol")["can_off"]
    assert name("openai", "gpt-4.1")["kind"] == "none"
    assert name("anthropic", "claude-sonnet-4-5")["kind"] == "none"
    assert "xhigh" not in name("anthropic", "claude-sonnet-4-6")["options"]
    assert not name("anthropic", "claude-fable-5-1")["can_off"]
    assert th.by_name({"api": "openai", "provider": "llamacpp", "local": True,
                       "model": "x"})["kind"] == "switch"


def test_fit_maps_each_setting_to_what_the_model_takes():
    switch = th._info("switch", default="on")
    assert [th.fit(s, switch) for s in ("auto", "off", "low", "high", "max")] == [
        "auto", "off", "on", "on", "on"]
    must = th._info("levels", ["low", "medium", "high"], can_off=False)
    assert th.fit("off", must) == "low"
    assert th.fit("max", must) == "high"
    assert th.fit("xhigh", th._info("levels", ["low", "medium", "high", "max"])) == "max"
    assert th.fit("high", th._info("none")) == "auto"
    assert th.fit("high", th.UNKNOWN) == "high"


async def test_an_on_off_model_gets_on_not_a_level(wp_client, fake_llm):
    # LM Studio's Qwen 3.x take only off and on; "low" was just "on" there.
    _lms(fake_llm, "hybrid", "low")
    await _chat(wp_client, "hi")
    # On is the model's default, so nothing is sent.
    assert "reasoning_effort" not in fake_llm.seen[-1]["body"]
    ai_config.update({"thinking": "off"})
    await _chat(wp_client, "hi")
    assert fake_llm.seen[-1]["body"]["reasoning_effort"] == "none"
    _lms(fake_llm, "leveled", "max")
    await _chat(wp_client, "hi")
    assert fake_llm.seen[-1]["body"]["reasoning_effort"] == "high"


async def test_a_refused_level_is_asked_once_then_remembered(wp_client, fake_llm):
    _lms(fake_llm, "no-effort", "high")
    n = len(fake_llm.seen)
    await _chat(wp_client, "hi")
    efforts = [x["body"].get("reasoning_effort") for x in fake_llm.seen[n:]]
    # Not taken for a refused stream: the second ask streams too.
    assert efforts[:2] == ["high", None] and fake_llm.seen[n + 1]["body"].get("stream")
    n = len(fake_llm.seen)
    await _chat(wp_client, "again")
    # Every later ask goes straight to the model's default.
    assert all("reasoning_effort" not in x["body"] for x in fake_llm.seen[n:])
    resp = await wp_client.post("/wp/api/ai/thinking")
    body = await resp.json()
    assert body["refused"] == ["high"] and body["sends"]["high"] == "auto"
    assert "refused" in body["note"]


async def test_the_thinking_route_lists_the_models_choices(wp_client, fake_llm):
    _lms(fake_llm, "hybrid", "auto")
    body = await (await wp_client.post("/wp/api/ai/thinking")).json()
    assert body["kind"] == "switch" and body["shown"] == ["auto", "off", "on"]
    assert body["sends"]["medium"] == "on"
    assert body["note"] == "This model only has thinking on or off."
    _lms(fake_llm, "leveled", "auto")
    body = await (await wp_client.post("/wp/api/ai/thinking")).json()
    assert body["shown"] == ["auto", "off", "low", "medium", "high"]
    _lms(fake_llm, "plain", "auto")
    body = await (await wp_client.post("/wp/api/ai/thinking")).json()
    assert body["shown"] == ["auto"] and body["kind"] == "none"


async def test_a_reply_spent_thinking_is_asked_again_with_thinking_off(wp_client, fake_llm):
    # Qwen 3.8 27B under LM Studio, thinking on: the whole output limit went
    # on reasoning and nothing was left for the answer (2026-10-22).
    _lms(fake_llm, "leveled", "high")
    fake_llm.overrides["_thought_out"] = 1
    n = len(fake_llm.seen)
    out = await _chat(wp_client, "hi")
    assert out["message"] == "Done."
    efforts = [x["body"].get("reasoning_effort") for x in fake_llm.seen[n:]]
    assert efforts[:2] == ["high", "none"]
    # Kept off for this model, and Settings says so.
    n = len(fake_llm.seen)
    await _chat(wp_client, "again")
    assert {x["body"].get("reasoning_effort") for x in fake_llm.seen[n:]} == {"none"}
    body = await (await wp_client.post("/wp/api/ai/thinking")).json()
    assert body["thought_out"] and "thinking off" in body["note"]
    # Picking Thinking again gives the model a fresh try.
    await wp_client.put("/wp/api/ai/config", json={"thinking": "medium"})
    body = await (await wp_client.post("/wp/api/ai/thinking")).json()
    assert not body["thought_out"]


def test_a_chat_templates_own_effort_is_read_from_it():
    # Qwen 3.8's template: enable_thinking plus its own reasoning_effort.
    qwen38 = ("{%- if enable_thinking is undefined or enable_thinking is true %}"
              "{%- set e = reasoning_effort|default('xhigh') %}"
              "{%- if e not in ('xhigh', 'medium', 'low') %}{%- endif %}{%- endif %}")
    info = th.from_template(qwen38)
    assert info["kind"] == "levels" and info["options"] == ["low", "medium", "xhigh"]
    assert info["can_off"]
    assert th.from_template("{% if enable_thinking is false %}x{% endif %}")["kind"] == "switch"
    assert th.from_template("{{ messages }}") is None


def test_llamacpp_hands_a_level_to_the_template():
    from wp_api import _ai_chat
    cfg = {"provider": "llamacpp", "base_url": "http://127.0.0.1:8080/v1"}
    assert _ai_chat._thinking_fields({**cfg, "thinking": "low", "thinking_kind": "levels"}) == {
        "chat_template_kwargs": {"enable_thinking": True, "reasoning_effort": "low"}}
    assert _ai_chat._thinking_fields({**cfg, "thinking": "on", "thinking_kind": "switch"}) == {
        "chat_template_kwargs": {"enable_thinking": True}}
