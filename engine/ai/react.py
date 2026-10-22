"""Reactions: an emoji on the user's message instead of a reply.

Two ways in:

- `quick(text)`: a message that is only thanks or praise ("thanks!",
  "perfect, ty", "👍") gets a reaction and never reaches the model, the way
  a rule-based bot answers a thank-you intent without a model call. The
  server stores it as an ``aside`` log entry that `chatlog.render` skips, so
  the model's prefix (and the prompt cache) stays the same.
- `opening(text)`: a message that opens with thanks or praise and then asks
  for more ("perfect, now add boots") gets its reaction as soon as it is
  sent, before the model answers.
- the `react` tool: the model puts one emoji on the user's message, with or
  without a reply. It shows as soon as the tool runs.

"yes", "ok", "sure", "do it" never count: they answer a question.
"""
from __future__ import annotations

import re

#: What the model (and the quick path) may react with.
REACTIONS = ("👍", "❤️", "🎉", "😄", "🙏", "👀")
MAX_CHARS = 60

_THANKS = re.compile(
    r"(?:thanks?|thank you|thankyou|thx|thnx|ty|tysm|tyvm|cheers|much appreciated|"
    r"appreciate it|appreciated)"
    r"(?: (?:so|very) much| a lot| a ton| again| man| mate| buddy| claude)?")
_PRAISE = re.compile(
    r"(?:(?:that'?s |this is |it'?s |looks |works )?"
    r"(?:perfect|awesome|great|amazing|brilliant|excellent|wonderful|fantastic|"
    r"beautiful|lovely|nice|cool|sweet|neat|superb|incredible|exactly what i wanted)"
    r"(?: work| job| stuff| one)?|"
    r"(?:i )?love (?:it|this|that)|good job|well done|nailed it|you'?re the best|"
    r"(?:that )?works(?: now)?(?: perfectly| great)?)")
#: Emoji a whole message may be made of, and what each gets back.
_EMOJI = {
    "👍": "👍", "👌": "👍", "💯": "🎉", "🔥": "🎉", "🎉": "🎉", "🥳": "🎉",
    "❤": "❤️", "❤️": "❤️", "♥": "❤️", "♥️": "❤️", "🥰": "❤️", "😍": "❤️", "💜": "❤️",
    "💙": "❤️", "🧡": "❤️", "💚": "❤️", "🙏": "🙏", "😄": "😄", "😊": "😄",
    "😁": "😄", "😀": "😄", "🙂": "😄", "😂": "😄",
}
_INTENS = re.compile(r"^(?:oh |wow |omg |ok(?:ay)? |so |really |very |super |just )+")


def _part_kind(part: str) -> str:
    part = _INTENS.sub("", part.strip())
    if not part:
        return ""
    if _THANKS.fullmatch(part):
        return "thanks"
    if _PRAISE.fullmatch(part):
        return "praise"
    # "perfect thanks", "great job thank you"
    for m in _PRAISE.finditer(part):
        if m.start() == 0 and _THANKS.fullmatch(part[m.end():].strip()):
            return "thanks"
    return "other"


def quick(text: str) -> str:
    """The reaction for a message that is only thanks or praise, else ""."""
    t = (text or "").strip()
    if not t or len(t) > MAX_CHARS or "?" in t:
        return ""
    emoji = [ch for ch in _EMOJI if ch in t]
    words = t
    for ch in sorted(_EMOJI, key=len, reverse=True):
        words = words.replace(ch, " ")
    words = re.sub(r"[️‍]", "", words).lower()
    words = re.sub(r"[!.~,:;)(\-]+", ",", words)
    parts = [p for p in (x.strip() for x in words.split(",")) if p]
    if not parts:
        if not emoji:
            return ""
        return _EMOJI[emoji[0]]
    kinds = {_part_kind(p) for p in parts} - {""}
    if not kinds or "other" in kinds:
        return ""
    if emoji:
        return _EMOJI[emoji[0]]
    return "❤️" if "thanks" in kinds else "🎉"


_TURN = re.compile(r"^(?:but|however|except|although|though|yet|still|not)\b")


def opening(text: str) -> str:
    """The reaction for a message whose first part is thanks or praise and
    which goes on to ask for more ("thanks! can you add boots too"), else "".
    "great, but it's broken" doesn't count."""
    t = (text or "").strip()
    m = re.match(r"([^,.!;:\n]{1,40})[,.!;:\n]+\s*(.+)", t, re.S)
    if not m or quick(t):
        return ""
    head, rest = m.group(1), m.group(2).strip().lower()
    if not rest or _TURN.match(rest):
        return ""
    return quick(head)


def clean(emoji: object) -> str:
    """`emoji` when it is one of REACTIONS (variation selector optional), else ""."""
    if not isinstance(emoji, str):
        return ""
    e = emoji.strip()
    for r in REACTIONS:
        if e == r or e == r.replace("️", ""):
            return r
    return ""
