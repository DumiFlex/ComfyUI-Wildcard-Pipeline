"""Step fields leaked into a JSON-mode message are not shown."""
import json
from pathlib import Path

import pytest

from engine.ai.step_fields import strip_step_fields

CORPUS = json.loads(
    (Path(__file__).parents[2] / "fixtures" / "step-fields-corpus.json").read_text("utf-8"))


@pytest.mark.parametrize("name,text,shown", CORPUS["cases"], ids=[c[0] for c in CORPUS["cases"]])
def test_corpus(name: str, text: str, shown: str) -> None:
    assert strip_step_fields(text) == shown


def test_unchanged_text_is_returned_as_is() -> None:
    assert strip_step_fields("Hi.\n") == "Hi.\n"
