"""`extract_at_uuid_refs` skips strings that cannot hold a ref.

The scan runs over every payload on every Context run, so a string without a
literal ``@{`` must never reach the tokenizer; the refs it finds must stay
exactly what the tokenizer reports.
"""
from __future__ import annotations

from engine.modules import snapshot
from engine.syntax.tokenize import tokenize_text


def test_finds_refs_in_nested_strings():
    payload = {
        "options": [
            {"id": "o1", "value": "red @{aa111111} and @{bb222222:t1}"},
            {"id": "o2", "value": "plain", "negative": "no @{cc333333#Name!null}"},
        ],
        "tags": ["@{dd444444}"],
    }
    assert snapshot.extract_at_uuid_refs(payload) == {
        "aa111111", "bb222222", "cc333333", "dd444444",
    }


def test_escaped_and_malformed_refs_match_the_tokenizer():
    texts = ["@@{aa111111}", "@{AA111111}", "@{aa11111}", "@ {aa111111}", "@{aa111111"]
    for text in texts:
        want = {
            t.meta.get("uuid") for t in tokenize_text(text)
            if t.kind.name == "REF" and isinstance((t.meta or {}).get("uuid"), str)
        }
        assert snapshot.extract_at_uuid_refs({"v": text}) == want, text


def test_strings_without_a_ref_marker_skip_the_tokenizer(monkeypatch):
    seen: list[str] = []
    real = snapshot.tokenize_text

    def spy(text):
        seen.append(text)
        return real(text)

    monkeypatch.setattr(snapshot, "tokenize_text", spy)
    refs = snapshot.extract_at_uuid_refs({
        "options": [{"id": "o1", "value": "plain text {a|b}", "sub_categories": ["t1"]},
                    {"id": "o2", "value": "with @{aa111111}"}],
    })
    assert refs == {"aa111111"}
    assert seen == ["with @{aa111111}"]
