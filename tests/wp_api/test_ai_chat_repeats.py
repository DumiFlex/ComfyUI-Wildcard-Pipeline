"""A card proposed again in the same answer replaces the first: the user
gets one card (Dumi's 9B log: Model Style Tags four times)."""
from __future__ import annotations

import json

from tests.wp_api.test_ai_api import _chat
from tests.wp_api.test_ai_chats import _on

STYLE = {"name": "Model Style Tags", "var": "model_style",
         "options": [{"text": "cinematic lighting"}, {"text": "anime shading"}]}


async def test_a_repeated_card_in_one_answer_is_shown_once(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "create_constraint", "args": json.dumps({
            "source_id": "Model Style Tags", "target_id": "Model Style Tags", "rules": []})},
            {"tool": "create_wildcard", "args": json.dumps(
                {**STYLE, "options": [*STYLE["options"], {"text": "noir"}]})}]},
        {"message": "Proposed Model Style Tags.", "calls": []},
    ])
    out = await _chat(wp_client, "What could I add to my library?")
    cards = [p for p in out["proposals"] if p["tool"] == "create_wildcard"]
    assert len(cards) == 1 and cards[0]["pid"] == "p2" and "replaces" not in cards[0]
    assert len(cards[0]["op"]["body"]["payload"]["options"]) == 3


async def test_opening_its_own_card_is_no_error_and_an_untested_claim_is_marked(
        wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "open", "args": json.dumps({"proposal": "p1"})}]},
        {"message": "I ran a test and every option came up.", "calls": []},
    ])
    # (With "test it" in the message the server would run the test itself:
    # `_ai_turn._auto_test`, covered in test_ai_api.)
    out = await _chat(wp_client, "Make a style wildcard and open it.")
    assert all(s["ok"] for s in out["steps"]) and not out["pending"]
    assert "No test ran in this answer" in out["message"]
    assert not any(s["tool"] == "run_test" for s in out["steps"])


async def test_a_failed_change_sent_again_is_not_run_again(wp_client, fake_llm):
    _on(fake_llm)
    bad = json.dumps({"name": "Bad", "var": "not a name", "options": [{"text": "x"}]})
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": bad}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": bad}]},
        {"message": "That didn't work.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a wildcard.")
    results = json.dumps(fake_llm.seen[-1]["body"]["messages"][-1]["content"])
    assert "already made this exact call and it failed" in results
    assert [s["ok"] for s in out["steps"] if s["tool"] == "create_wildcard"] == [False]


def test_a_claimed_kind_with_no_card_of_it_is_flagged():
    from wp_api import _ai_turn
    wild = [{"op": {"op": "create", "kind": "module", "body": {"type": "wildcard"}}}]
    assert _ai_turn._missing_kinds("I've proposed a combine for the face.", wild) == ["combine"]
    assert _ai_turn._missing_kinds("I've created the fixed values preset.", wild) == [
        "fixed_values"]
    assert _ai_turn._missing_kinds("I've proposed a new wildcard.", wild) == []
    tmpl = [{"op": {"op": "update", "kind": "template", "id": "x"}}]
    assert _ai_turn._missing_kinds("I have made the template tighter.", tmpl) == []


def test_a_card_written_as_text_counts_as_a_claim():
    from wp_api import _ai_turn
    # Re-test on b793872 (9B): no card came with any of these.
    assert _ai_turn._card_as_text("Here's the card to apply: Face Description · $face_desc")
    assert _ai_turn._card_as_text("Apply the cards if they look right.")
    assert _ai_turn._card_as_text('{"tool": "add_rules", "args": {"id": "aaaa0001"}}')
    assert _ai_turn._card_as_text("add_rules({id: 1})")
    assert not _ai_turn._card_as_text("Your wildcard has 3 options; edit_rules can change it.")


async def test_a_promised_call_that_never_came_is_asked_for_once(wp_client, fake_llm):
    # Re-test on 367a6a5 (9B): "I'll use add_rules…" and the turn ended.
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "I'll use create_wildcard to add the style list.", "calls": []},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "Proposed Model Style Tags.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a style wildcard.")
    sent = json.dumps(fake_llm.seen[1]["body"]["messages"])
    assert "You said you'd call create_wildcard" in sent
    assert [p["tool"] for p in out["proposals"]] == ["create_wildcard"]


def test_promised_call_names_only_change_tools():
    from engine.ai import chat
    assert chat.promised_call("Got it. I'll use `add_rules` to add one.") == "add_rules"
    assert chat.promised_call("Let me call edit_rules now") == "edit_rules"
    assert chat.promised_call("I'll use search to look first.") == ""
    assert chat.promised_call("You can use add_rules for that.") == ""


async def test_a_pack_ask_built_item_by_item_is_turned_to_plan_pack(wp_client, fake_llm):
    # Every eval run: "plan a pack" made loose items and never plan_pack.
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "plan_pack", "args": json.dumps(
            {"description": "A fantasy character pack: race, class, gear by class."})}]},
        {"message": "Proposed the pack plan.", "calls": []},
    ])
    out = await _chat(wp_client, "Plan a fantasy character pack for me.")
    assert [p["tool"] for p in out["proposals"]] == ["plan_pack"]
    assert "call plan_pack" in json.dumps(fake_llm.seen[1]["body"]["messages"])


async def test_items_asked_again_after_the_pack_steer_are_made(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "Proposed Model Style Tags.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a style wildcard for my anime pack.")
    assert [p["tool"] for p in out["proposals"]] == ["create_wildcard"]


async def test_an_organize_ask_answered_without_cards_says_nothing_changed(wp_client, fake_llm):
    _on(fake_llm)
    fake_llm.chat_steps.extend([
        {"message": "Here's how I'd group them: Characters, Gear, Scenes.", "calls": []},
    ])
    out = await _chat(wp_client, "Organize my library into categories.")
    assert "Nothing was proposed" in out["message"]


async def test_an_answer_that_puts_the_rest_off_is_asked_for_it_now(wp_client, fake_llm):
    from engine.ai import chat as ai_chat
    _on(fake_llm)
    rule = {"name": "Title rule", "rules": [{"summary": "mages are Archmage", "branches": [
        {"match": "all", "conditions": [{"var": "model_style", "op": "equals",
                                         "value": "anime shading"}],
         "actions": [{"target_var": "title", "mode": "replace", "value": "Archmage"}]}]}]}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "I proposed the Model Style Tags wildcard. Apply it, then I'll propose "
                    "the derivation for $title.", "calls": []},
        {"message": "", "calls": [{"tool": "create_derivation", "args": json.dumps(rule)}]},
    ])
    out = await _chat(wp_client, "Make a style wildcard and a derivation that sets $title.")
    assert any(ai_chat.DEFER_NUDGE in r["body"]["messages"][-1]["content"]
               for r in fake_llm.seen)
    assert [p["tool"] for p in out["proposals"]] == ["create_wildcard", "create_derivation"]
    # Nudged once: an answer that still defers stands.
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "Apply it, then I'll propose the rule.", "calls": []},
        {"message": "Apply it first, then I'll propose the rule.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a style wildcard and a derivation that sets $title.")
    assert out["message"].startswith("Apply it first")
    assert ai_chat.defers_rest("Once you apply that, I can add the derivation.")
    assert not ai_chat.defers_rest("I proposed both; apply them and then test.")


async def test_the_same_card_sent_again_is_a_nudge_to_go_on(wp_client, fake_llm):
    _on(fake_llm)
    other = {**STYLE, "name": "Lens", "var": "lens"}
    fake_llm.chat_steps.extend([
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        # Sonnet 5.5 live: the same create again, unchanged, after a card warning.
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(STYLE)}]},
        {"message": "", "calls": [{"tool": "create_wildcard", "args": json.dumps(other)}]},
        {"message": "Proposed both.", "calls": []},
    ])
    out = await _chat(wp_client, "Make a style wildcard and a lens wildcard.")
    told = json.dumps(fake_llm.seen[2]["body"]["messages"][-1]["content"])
    assert "you already sent exactly this" in told
    # Not forced to stop: it went on and made the second one.
    assert [p["op"]["body"]["name"] for p in out["proposals"]] == ["Model Style Tags", "Lens"]
