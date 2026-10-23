"""Request-dependent shortlists (harness notes H3 + H5): a question gets no
change tools, and the core only carries the docs, `react`, `variables` and
`run_test` when the message calls for them."""
from __future__ import annotations

import pytest

from engine.ai import tools as ai_tools

NAMES = ai_tools.toolset("library", scoped=True)


@pytest.mark.parametrize(("text", "kind"), [
    ("How does a constraint's only mode work? Keep it short.", "question"),
    ("Where do I turn on deleting for the AI assistant?", "question"),
    ("how do I add a fallback?", "question"),
    ("why did my weather wildcard pick rain?", "question"),
    ("is there a way to weight options by tag", "question"),
    ("thanks!", "chat"),
    ("cool", "chat"),
    ("Make a Hair wildcard bound to $hair with 4 options.", "task"),
    ("Rename its variable to hair_color.", "task"),
    ("can you add rain to Weather?", "task"),
    ("Add negatives to the dark options so the image isn't overexposed.", "task"),
    ("I would like a list of twenty medieval weapons for my knight scenes", "task"),
])
def test_message_kind(text, kind):
    assert ai_tools.message_kind(text) == kind


def test_a_follow_up_in_a_working_chat_is_more_work():
    assert ai_tools.message_kind("same for the eyes?") == "question"
    assert ai_tools.message_kind("same for the eyes?", working=True) == "task"
    assert ai_tools.message_kind("now the eyes", working=True) == "task"
    # An opener still makes a question.
    assert ai_tools.message_kind("why did it pick blue?", working=True) == "question"


@pytest.mark.parametrize("text", [
    "How does a constraint's only mode work? Keep it short.",
    "Where do I turn on deleting for the AI assistant?",
    "how do negatives work?",
    "thanks!",
])
def test_a_question_gets_no_change_tools(text):
    short = ai_tools.shortlist(NAMES, text, "library")
    assert short is not None
    assert not [n for n in short if n in ai_tools.CHANGE]
    assert "draft_options" not in short and "use_panel" not in short
    assert {"docs_search", "docs_read", "explain", "more_tools"} <= set(short)


def test_a_task_keeps_its_tools_and_leaves_the_docs_out():
    short = ai_tools.shortlist(NAMES, "make a hair wildcard with 5 styles", "library")
    assert "create_wildcard" in short and "more_tools" in short
    assert not set(ai_tools.DOCS_TOOLS) & set(short)
    assert "react" not in short and "run_test" not in short and "variables" not in short


def test_the_core_follows_the_request():
    assert "variables" in ai_tools.shortlist(NAMES, "Rename its variable to hair_color.")
    assert "variables" in ai_tools.shortlist(NAMES, "bind it to $hair")
    assert "run_test" in ai_tools.shortlist(NAMES, "why did my weather wildcard pick rain?")
    assert "react" in ai_tools.shortlist(NAMES, "thanks!")
    assert "react" not in ai_tools.shortlist(NAMES, "how do negatives work?")


@pytest.mark.parametrize("text", [
    "make a hair wildcard with 5 styles",
    "rename the Weather variable to sky",
    "how do negatives work?",
    "add a constraint so rain excludes sunglasses",
    "Where do I turn on deleting for the AI assistant?",
    "Add negatives to the dark options so the image isn't overexposed.",
])
def test_a_first_step_offers_about_ten(text):
    assert len(ai_tools.shortlist(NAMES, text, "library")) <= 10


def test_where_in_a_task_is_not_about_the_page():
    task = ai_tools.shortlist(NAMES, "Make a Weather wildcard with 5 options where clear sky "
                              "is the fallback when rules rule out everything else.", "library")
    assert "open" not in task and "highlight" not in task
    ask = ai_tools.shortlist(NAMES, "where is the reach setting?", "library")
    assert {"open", "read_page", "highlight"} <= set(ask)


def test_option_tags_in_a_wildcard_ask_bring_no_list_tools():
    # Smoke s-tag-filter: "tagged warm" offered all six list tools.
    names = ai_tools.toolset("/library", scoped=True, wide=False)
    names += [t.name for t in ai_tools.tools(list(ai_tools.BY_NAME))
              if "lists" in t.groups and t.name not in names]
    short = ai_tools.shortlist(names, "Make a Palette wildcard with no variable: 4 warm colours "
                             "tagged warm and 4 cool colours tagged cool.", "/library")
    assert short is not None and "edit_tags" not in short and "organize" not in short
    assert len(short) <= 13
    assert "lists" in ai_tools.groups_for("Add tags to my Hair wildcard")
    assert "lists" in ai_tools.groups_for("Retag my outfits")
