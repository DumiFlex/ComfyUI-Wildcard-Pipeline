"""The chat's turn log: replayed exactly, shortened rarely and only forward."""
from __future__ import annotations

from engine.ai import chatlog as cl


def _turn(n: int, result: str = "r" * 2000) -> list[dict]:
    call = {"id": f"c{n}", "tool": "search", "args": {"query": "x"}, "args_text": "{}"}
    return [
        cl.user_entry(f"q{n}", f"q{n} (sent)"),
        cl.step_entry("", [call]),
        cl.results_entry([{"id": f"c{n}", "tool": "search", "text": f"search:\n{result}"}],
                         "\n\ntail"),
        cl.step_entry(f"a{n}", []),
    ]


def test_render_replays_what_was_sent():
    log = _turn(1)
    msgs = cl.render(log, {})
    assert [m["role"] for m in msgs] == ["user", "assistant", "tool", "assistant"]
    assert msgs[0]["content"] == "q1 (sent)"
    assert msgs[2]["items"][0]["content"].startswith("search:") and msgs[2]["tail"] == "\n\ntail"
    # A nudge after a user message joins it rather than making two in a row.
    joined = cl.render([cl.user_entry("a", "a"), cl.note_entry("go")], {})
    assert joined == [{"role": "user", "content": "a\n\ngo"}]


def test_fit_masks_old_results_then_drops_whole_turns():
    log = [e for n in range(6) for e in _turn(n)]
    meta = cl.fit(log, {}, 10**6)
    assert meta == {}
    meta = cl.fit(log, {}, 8000)
    starts = [i for i, e in enumerate(log) if e["kind"] == "user"]
    assert meta["masked_before"] == starts[-cl.KEEP_TURNS] and "dropped_before" not in meta
    msgs = cl.render(log, meta)
    tools = [m for m in msgs if m["role"] == "tool"]
    assert "older result left out" in tools[0]["items"][0]["content"]
    assert "older result left out" not in tools[-1]["items"][0]["content"]
    # Fitting again with the same limit changes nothing: the prefix stays put.
    assert cl.fit(log, meta, 8000) == meta
    tight = cl.fit(log, meta, 2600)
    assert tight["dropped_before"] in starts
    msgs = cl.render(log, tight)
    assert msgs[0]["content"].startswith(cl.DROPPED_NOTE)
    assert msgs[-1]["content"] == "a5"


def test_last_reply_and_title():
    log = _turn(1)
    assert cl.last_reply(log) == "a1"
    json_step = cl.step_entry('{"message": "hi"}', [], answer={"message": "hi", "calls": []})
    assert cl.last_reply([json_step]) == "hi"
    # The first line, without the polite opener, cut at a word.
    assert cl.title_for("  make hats\n and more ") == "Make hats"
    assert cl.title_for("could we take a closer look at pose pool?") == \
        "Take a closer look at pose pool"
    assert cl.title_for("Hi, can you please add weather") == "Add weather"
    assert cl.title_for("Can I add hair?") == "Can I add hair"
    assert cl.title_for("hey") == "hey"
    long = cl.title_for("word " * 40)
    assert len(long) <= 60 and long.endswith("word…")
    assert len(cl.title_for("x" * 200)) == 60


def test_display_rebuilds_what_the_user_saw():
    view = {"message": "Here.", "steps": [], "refs": {},
            "proposals": [{"pid": "p1", "title": "Add hats"}, {"pid": "p2", "title": "New"}]}
    log = [cl.user_entry("hats", "hats"), cl.step_entry("Here.", []), cl.shown_entry(view),
           cl.user_entry("old turn", "old turn"), cl.step_entry("plain reply", [])]
    meta = {"proposals": {"p1": {"status": "dismissed"}, "p2": {"status": None}},
            "shown_status": {"p2": {"status": "applied", "created": "ab12cd34"}}}
    turns = cl.display(log, meta)
    assert [t["role"] for t in turns] == ["user", "assistant", "user", "assistant"]
    assert turns[1]["status"] == {"p1": "dismissed", "p2": "applied"}
    assert turns[1]["created"] == {"p2": "ab12cd34"}
    # A turn from before "shown" entries: its reply text only.
    assert turns[3]["view"]["message"] == "plain reply"
    # The model never sees "shown".
    assert all("Here." not in str(m.get("content")) or m["role"] == "assistant"
               for m in cl.render(log, {}))
    assert sum(1 for m in cl.render(log, {}) if m["role"] == "assistant") == 2
    assert cl.last_turn_start(log) == 3


def test_events_and_library_changes():
    meta = {"proposals": {"p1": {"title": "Add hats", "status": None}}}
    meta2, line = cl.apply_events(meta, [{"pid": "p1", "status": "applied"},
                                         {"pid": "p7", "status": "applied"},
                                         {"pid": "p1", "status": "bogus"}])
    assert line == 'Since your last message the user p1 "Add hats" applied.'
    assert meta2["proposals"]["p1"]["status"] == "applied"
    assert meta["proposals"]["p1"]["status"] is None
    assert cl.apply_events(meta2, [{"pid": "p1", "status": "applied"}])[1] == ""
    old = {"a": ["Hair", "wildcard", "1"], "b": ["Eyes", "wildcard", "1"]}
    new = {"a": ["Hair", "wildcard", "2"], "c": ["Pose", "wildcard", "1"]}
    line = cl.library_changes(old, new)
    assert line == ("Library changed since the last message: new: Pose (c, wildcard); "
                    "changed: Hair (a); removed: Eyes (b).")
    assert cl.library_changes({}, new) == ""
    assert cl.library_changes(new, new) == ""


def test_dumps_is_stable():
    assert cl.dumps({"b": 1, "a": "é"}) == '{"a": "é", "b": 1}'


def test_last_shown_is_the_answer_the_user_replies_to():
    assert cl.last_shown([]) == ""
    log = [cl.user_entry("a", "a"), cl.step_entry("x", []),
           cl.shown_entry({"message": "You have [[aaaa0001#Weather]]."}),
           cl.user_entry("b", "b")]
    assert cl.last_shown(log[:3]) == "You have [[aaaa0001#Weather]]."
    # After the user wrote again, no answer is being replied to yet.
    assert cl.last_shown(log) == ""



def test_many_cards_with_one_status_are_said_together():
    meta = {"proposals": {f"p{n}": {"title": f"Create wildcard W{n}", "status": None}
                          for n in range(1, 6)}}
    _, line = cl.apply_events(meta, [
        *({"pid": f"p{n}", "status": "applied"} for n in (1, 2, 3)),
        {"pid": "p4", "status": "applied", "left_out": 2},
        {"pid": "p5", "status": "dismissed"},
    ])
    assert line == ('Since your last message the user p4 "Create wildcard W4" applied without 2 '
                    'of its options (the user left them out); applied 3 cards: '
                    'p1 "Create wildcard W1", p2 "Create wildcard W2", p3 "Create wildcard W3"; '
                    'p5 "Create wildcard W5" dismissed.')
