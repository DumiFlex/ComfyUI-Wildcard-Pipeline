"""Empty groups rule — drop (), [], ( , ), (:1.2) and close the seam."""
import pytest

from engine.cleaner.rules.syntax import apply_empty_groups


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("red (), dress", "red, dress"),
        ("red () dress", "red dress"),
        ("red()dress", "reddress"),
        ("(:1.2), smile", "smile"),
        ("( , ) girl", "girl"),
        ("((  )), hat", "hat"),
        ("hat, []", "hat"),
        ("a, ( :1.2), b", "a, b"),
        ("a, () [], b", "a, b"),
        ("(a, ()), b", "(a), b"),
        ("(a, (), b:1.2)", "(a, b:1.2)"),
        ("(():1.2) x", "x"),
        ("()", ""),
    ],
)
def test_removes_empty_groups(text, expected):
    assert apply_empty_groups(text, "tags", {})["text"] == expected


def test_counts_each_removed_group():
    assert apply_empty_groups("a, (()), []", "tags", {})["stats"] == {"removed": 3}


@pytest.mark.parametrize(
    "text",
    [
        "(a:1.2), [b]",
        r"artist \(style\), \(\)",
        "<lora:x():1>",
        "a (b",
        "a ) b ()",
        "(a]",
    ],
)
def test_leaves_other_text_alone(text):
    out = apply_empty_groups(text, "tags", {})
    assert out["text"] == text
    assert out["stats"] == {"removed": 0}


def test_text_mode_keeps_newlines():
    assert apply_empty_groups("a ()\nb", "text", {})["text"] == "a\nb"
