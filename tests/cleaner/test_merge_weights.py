"""Merge weights rule — fold nested ( ) weights into one group."""
import pytest

from engine.cleaner.rules.syntax import apply_merge_weights


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("((a:1.1):1.2)", "(a:1.32)"),
        ("((a:1.5))", "(a:1.65)"),
        ("((a))", "(a:1.21)"),
        ("(((a)))", "(a:1.33)"),
        ("( (a:1.1) :1.2)", "(a:1.32)"),
        ("(((a:2):0.5):1.2)", "(a:1.2)"),
        ("(a:1.0)", "a"),
        ("(a, b:1)", "a, b"),
        ("((a:0.5):2)", "a"),
        ("x, ((a, (b)):1.2), y", "x, (a, (b):1.32), y"),
        ("((embedding:foo:1.1):1.2)", "(embedding:foo:1.32)"),
        ("(((a:1.1):1.2), c)", "((a:1.32), c)"),
    ],
)
def test_merges(text, expected):
    assert apply_merge_weights(text, "tags", {})["text"] == expected


@pytest.mark.parametrize(
    "text",
    [
        "(a)",
        "(a:1.2)",
        "((a:1.1), b:1.2)",
        "[[a]]",
        "([a])",
        r"\(\(a\)\)",
        "((a:1.1):1.2",
        "(<lora:x:1>)",
        "",
    ],
)
def test_leaves_alone(text):
    out = apply_merge_weights(text, "tags", {})
    assert out["text"] == text
    assert out["stats"] == {"merged": 0}


def test_counts_merges():
    out = apply_merge_weights("((a:1.1):1.2), ((b)), (c:1)", "tags", {})
    assert out["text"] == "(a:1.32), (b:1.21), c"
    assert out["stats"] == {"merged": 3}


def test_a_deep_stack_counts_once():
    out = apply_merge_weights("((((a))))", "tags", {})
    assert out["text"] == "(a:1.46)"
    assert out["stats"] == {"merged": 1}


def test_idempotent():
    once = apply_merge_weights("(((a:1.1):1.2)), ((b))", "tags", {})["text"]
    assert apply_merge_weights(once, "tags", {})["text"] == once
