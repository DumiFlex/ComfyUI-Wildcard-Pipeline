"""LoRA spacing rule — tidy <lora:...> tags and the space around them."""
import pytest

from engine.cleaner.rules.lora import apply


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("< lora : myStyle : 0.8 >", "<lora:myStyle:0.8>"),
        ("girl<lora:x:1>smile", "girl <lora:x:1> smile"),
        ("<lora:x:1> , hat", "<lora:x:1>, hat"),
        ("<lora:a:1><lora:b:1>", "<lora:a:1> <lora:b:1>"),
        ("(<lora:x:1>)", "(<lora:x:1>)"),
        ("<LyCO: my file :0.5>", "<LyCO:my file:0.5>"),
        ("<hypernet:h:1>,x", "<hypernet:h:1>,x"),
    ],
)
def test_tidies(text, expected):
    assert apply(text, "tags", {})["text"] == expected


def test_leaves_tidy_text_alone():
    text = "girl, <lora:my file_v2:0.8>, smile"
    out = apply(text, "tags", {})
    assert out["text"] == text
    assert out["stats"] == {"tidied": 0}


def test_ignores_other_angle_text():
    assert apply("a <b> c<x:1>d", "text", {})["text"] == "a <b> c<x:1>d"


def test_counts_tags_changed():
    out = apply("a<lora:x:1>, <lora:y:1>, < lora:z:1>", "tags", {})
    assert out["stats"] == {"tidied": 2}
