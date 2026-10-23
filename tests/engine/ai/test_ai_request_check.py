"""The request check: features the request asks for that no card has."""
from __future__ import annotations

from engine.ai import request_check as rc

ONLY_ASK = ("Make a Setting wildcard and an Outfit wildcard, then make each setting get only "
            "outfits that suit it.")


def _constraint(mode):
    return {"tool": "create_constraint", "op": {"op": "create", "body": {"payload": {
        "rules": [{"source": "#beach", "target": "#swim", "mode": mode}]}}}}


def _wildcard(**opt):
    return {"tool": "create_wildcard", "op": {"op": "create", "body": {"payload": {
        "options": [{"value": "beach", **opt}]}}}}


def test_an_only_ask_needs_an_only_rule():
    assert rc.gaps(ONLY_ASK, [_wildcard()]) == [
        'an "only" rule (effect only: the target may use just what the row names)']
    assert rc.gaps(ONLY_ASK, [_wildcard(), _constraint("boost")])[0].startswith('an "only"')
    assert rc.gaps(ONLY_ASK, [_wildcard(), _constraint("only")]) == []


def test_constraints_fallbacks_and_negatives():
    ask = "never give a longsword to a mage, with a fallback weapon"
    assert rc.gaps(ask, [_wildcard()]) == ["a constraint", "a fallback option"]
    assert rc.gaps(ask, [_constraint("exclude"), _wildcard(fallback=True)]) == []
    neg = "add negatives to the stormy options"
    assert rc.gaps(neg, [_wildcard()]) == ["negatives"]
    assert rc.gaps(neg, [_wildcard(negative="sunny sky")]) == []
    derived = {"tool": "create_derivation", "op": {"body": {"payload": {"branches": [
        {"actions": [{"mode": "negative", "value": "blur"}]}]}}}}
    assert rc.gaps(neg, [derived]) == []


def test_no_cards_plain_words_and_chips_ask_nothing():
    assert rc.gaps(ONLY_ASK, []) == []
    assert rc.gaps("make a hair wildcard with 5 styles", [_wildcard()]) == []
    assert rc.gaps("an outfit wildcard that never has hats", [_wildcard()]) == []
    assert rc.gaps("add options to [[1a2b3c4d#Never Rain In Town]]", [_wildcard()]) == []


def test_the_nudge_quotes_the_request():
    text = rc.nudge(["a constraint", "a fallback option"], "never rain in the desert")
    assert "a constraint and a fallback option" in text and "them" in text
    assert text.endswith('The request: "never rain in the desert"')
    assert len(rc.nudge(["negatives"], "x" * 900)) < 800


def test_a_tag_filter_ask_is_not_an_only_rule():
    ask = "Make a Sky wildcard whose options use only warm colours from Palette."
    plain = {"tool": "create_wildcard", "op": {"body": {"payload": {
        "options": [{"value": "crimson sky"}]}}}}
    ref = {"tool": "create_wildcard", "op": {"body": {"payload": {
        "options": [{"value": "a @{0a1b2c3d#Palette:warm} sky"}]}}}}
    missing = rc.gaps(ask, [plain])
    assert len(missing) == 1 and missing[0].startswith("a tag-filtered ref")
    assert rc.gaps(ask, [ref]) == []


def test_a_fallback_described_by_rules_asks_no_constraint():
    ask = ("Make a Weather wildcard with 5 options where clear sky is the fallback when "
           "rules rule out everything else.")
    assert rc.gaps(ask, [_wildcard(fallback=True)]) == []
    assert rc.gaps(ask, [_wildcard()]) == ["a fallback option"]


def test_fix_tools_are_the_cards_own_and_what_adds_the_gap():
    from engine.ai.request_check import fix_tools
    cards = [{"tool": "create_wildcard", "op": {}}]
    assert fix_tools(["a fallback option"], cards) == ["create_wildcard", "edit_options"]
    assert fix_tools(["a constraint"], cards) == [
        "create_wildcard", "create_constraint", "edit_constraint"]


def test_claimed_finds_what_the_answer_says_it_made():
    from engine.ai.request_check import FEATURES, claimed
    tag = FEATURES[-1][0]
    assert claimed(["a fallback option", tag], "Options: a @{Palette:warm} sky.") == [tag]
    assert claimed(["a fallback option"], "Proposed Weapon.") == []
    assert claimed(["a fallback option"], "No fallback is needed here.") == []
    assert claimed(["a fallback option"], "It works without a fallback. Clear sky (fallback).") == [
        "a fallback option"]
