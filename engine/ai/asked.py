"""Numbers a typed request names: how many options, and by how much.

`option_count` reads "draft 6 desert weather options" as 6, so the Draft
panel's How many box and the chat's `draft_options` follow the request
instead of falling back to 10 (bench W3 asked 8, W18 asked 6, both got 10).
It is mirrored in TS at `src/manager/utils/asked-count.ts` through the
shared `tests/fixtures/asked-count-corpus.json`.

`weight_factor` and `weight_direction` read a re-weight request ("half as
likely", "twice as common", "rarer") so a model that writes the factor as
the new weight (bench W12: a 0.1 option set to 0.5 for "half as likely")
is corrected, and a weight that moves the wrong way is refused.
"""
from __future__ import annotations

import re

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "dozen": 12,
}
#: A count: digits that aren't part of a longer number, a decimal, "1920s",
#: "3-piece" or "50%", or a number word.
_COUNT = re.compile(
    r"(?<![\w.$@#{|:-])(\d{1,3}|" + "|".join(_NUMBER_WORDS) + r")(?![\w.%°'’-])", re.I)
#: Plural-looking words that aren't the things being counted.
_NOT_NOUNS = {
    "this", "is", "was", "has", "its", "as", "us", "yes", "less", "plus", "thus",
    "words", "letters", "characters", "chars", "tokens", "times", "seconds", "minutes",
    "hours", "days", "weeks", "months", "years", "syllables", "tags", "sentences",
    "steps", "seeds", "runs", "points", "pixels", "percent", "weights",
}
#: Words that end the look for a noun: the count is about something else.
_STOPS = {"for", "of", "in", "to", "with", "from", "and", "or", "than", "each", "per",
          "at", "by", "on", "a", "an", "the", "x"}
#: Up to this many words after a count, its noun included.
_REACH = 4
_RUN = re.compile(r"\s+((?:[A-Za-z][A-Za-z'’-]*[ \t]+){0,"
                  + str(_REACH - 1) + r"}[A-Za-z][A-Za-z'’-]*)")
#: A number right after these is a reference or a limit, not a count:
#: "the four seasons", "under 5 words", "all 12 options".
_BEFORE = re.compile(r"\b(?:the|these|those|all|my|its|their|under|over|than|max|maximum|"
                     r"least|most|every|only|first|last)\s+$", re.I)
MAX = 100


def option_count(text: str) -> int:
    """How many options `text` asks for (1 to `MAX`), or 0 when it names no
    count: the first number followed, within a few words, by a plural noun
    ("6 desert weather options", "8 more outfits", "3 pairs of shoes",
    "a dozen names"). "under 5 words", "1920s", "2 tags each" are not counts."""
    if not isinstance(text, str):
        return 0
    for m in _COUNT.finditer(text):
        word = m.group(1).lower()
        n = int(word) if word.isdigit() else _NUMBER_WORDS[word]
        if not 1 <= n <= MAX:
            continue
        if _BEFORE.search(text, 0, m.start()):
            continue
        # Up to `_REACH` words joined by spaces: "6, 3 casual" is not "6 casual".
        run = _RUN.match(text, m.end())
        if not run:
            continue
        for i, low in enumerate(run.group(1).lower().split()):
            if low in _NOT_NOUNS or (low in _STOPS and i > 0):
                break
            if (low.endswith("s") and len(low) > 3) or (n == 1 and low in ("option", "one")):
                return n
    return 0


_HALF = re.compile(r"\bhalf\b|\bhalve[sd]?\b", re.I)
_THIRD = re.compile(r"\b(?:a|one)[ -]third\b", re.I)
_QUARTER = re.compile(r"\b(?:a|one)[ -]quarter\b|\bquarter as\b", re.I)
_DOUBLE = re.compile(r"\btwice\b|\bdouble[sd]?\b", re.I)
_TRIPLE = re.compile(r"\bthrice\b|\btriple[sd]?\b", re.I)
_TIMES = re.compile(r"\b(\d+(?:\.\d+)?|two|three|four|five|ten)\s*(?:times|x|×)\s+"
                    r"(?:as\s+|more\s+|less\s+)?(\w+)", re.I)
_LESS = re.compile(r"\b(?:less|fewer|rarer|rarely|lower|reduce[sd]?|cut|decrease[sd]?|"
                   r"halve[sd]?|half|third|quarter|down|seldom|uncommon|unlikely|rare)\b", re.I)
_MORE = re.compile(r"\b(?:more|commoner|common|often|higher|raise[sd]?|increase[sd]?|boost"
                   r"(?:ed|s)?|double[sd]?|twice|triple[sd]?|up|frequent|likelier)\b", re.I)
_RARE_WORDS = {"less", "rarer", "fewer", "lower"}


def weight_factor(text: str) -> float | None:
    """The factor a re-weight request names ("half as likely" 0.5, "twice as
    common" 2, "3 times less likely" 1/3), or None when it names none."""
    if not isinstance(text, str):
        return None
    m = _TIMES.search(text)
    if m:
        raw = m.group(1).lower()
        n = float(raw) if raw[0].isdigit() else float(_NUMBER_WORDS[raw])
        if n > 0:
            return round(1 / n, 4) if m.group(2).lower() in _RARE_WORDS or re.search(
                r"\bless\b", m.group(0), re.I) else n
    if _HALF.search(text):
        return 0.5
    if _THIRD.search(text):
        return round(1 / 3, 4)
    if _QUARTER.search(text):
        return 0.25
    if _DOUBLE.search(text):
        return 2.0
    if _TRIPLE.search(text):
        return 3.0
    return None


def weight_direction(text: str) -> int:
    """-1 when a re-weight request only makes options rarer, 1 when it only
    makes them more common, 0 when it says both, neither, or sets values."""
    if not isinstance(text, str):
        return 0
    less, more = bool(_LESS.search(text)), bool(_MORE.search(text))
    # "less common" reads both words; "less" decides it.
    if less and more and re.search(r"\b(?:less|fewer)\s+(?:common|often|frequent|likely)\b",
                                   text, re.I) and not re.search(
            r"\b(?:more|twice|double)\b", text, re.I):
        return -1
    if less and not more:
        return -1
    if more and not less:
        return 1
    return 0
