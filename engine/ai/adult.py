"""Adult packs: the one line the assistant never crosses, and warnings.

Two kinds of words:

- clearly minor words (`minor_words`): child, loli, shota, toddler,
  underage, "15 years old", aged down…;
- words that name a young person but can describe an adult too
  (`_YOUNG_PERSON`): teen, schoolgirl, young girl, little girl, younger
  sister… Outside a sexual context they are only flagged; IN one (an
  option next to a nude word, any item of a pack rated nsfw) they count as
  minor words, since "schoolgirl, nude" is not a costume (NSFW eval
  2026-10-21: an "underage" request was planned as a Subject Age slot of
  "schoolgirl, teenager, little girl" with only "child" dropped);
- costume and adjective words an adult wears or is called (`_COSTUME`):
  school uniform, childish, childhood. Flagged, never dropped.

An AI-written option, value, rule or template that puts a minor word in a
sexual context is always left out, in every AI feature (`sexual_minor`);
in a pack rated nsfw the whole pack is that context. The costume words are
only flagged, so a user can have an adult in a school uniform; the Pack
builder warns and leaves the call to them. A pack REQUEST whose own words
sexualise a minor ("nsfw pack of underage girls") is refused before any
model call (`refused_request`). The youth negative block
(`with_youth_negative`) is a pack setting, on by default.

The words are whole-word matches (the engine's blocklist works the same
way), so "child" is caught but "wild" or "kidney" are not. Words like
"petite" or "small" stay: on their own they describe adults too; the guide
asks for an adult anchor on every character instead.

See `/pr-drafts/prompt-writing-research.md` §7.5.
"""
from __future__ import annotations

import re

# Words that only ever mean a minor, singular and plural, Danbooru
# spellings too.
_MINOR = re.compile(
    r"(?<![\w-])(?:"
    r"child(?:ren|like)?|kids?|toddlers?|infants?|babies|"
    r"loli(?:con|ta)?|shota(?:con)?|cub|"
    r"minors?|underage(?:d)?|under[\s_-]?aged?|preteens?|pre[\s_-]teens?|"
    r"tweens?|adolescen(?:ts?|ce)|juveniles?|jailbait|"
    r"(?:elementary|middle|junior[\s_-]high|primary)[\s_-]?school\w*|"
    r"aged[\s_-]down|"
    r"\d{1,2}[\s_-]?(?:yo|y/o|years?[\s_-]old)"
    r")(?![\w-])",
    re.I,
)
# Words that name a young person but can be an adult too ("teen" for
# 18-19, a "schoolgirl" of 19): flagged on their own, minor words in a
# sexual context.
_YOUNG_PERSON = re.compile(
    r"(?<![\w-])(?:"
    r"kiddos?|teens?|teenage(?:rs?|d)?|"
    r"school[\s_-]?(?:girls?|boys?|kids?|children)|"
    r"(?:young|little)[\s_-](?:girls?|boys?)|"
    r"younger[\s_-]sister|younger[\s_-]brother"
    r")(?![\w-])",
    re.I,
)
# A costume an adult wears, or an adjective about one: flagged, never
# dropped.
_COSTUME = re.compile(
    r"(?<![\w-])(?:"
    r"child(?:ish|hood)|"
    r"school[\s_-]?(?:uniforms?|swimsuits?)"
    r")(?![\w-])",
    re.I,
)
# Sexual or nude words: an option that has one of these AND a clearly minor
# word is never kept, in any pack or chat answer.
_EXPLICIT = re.compile(
    r"(?<![\w-])(?:nsfw|explicit|nude|nudity|naked|topless|bottomless|sex|sexual|"
    r"lewd|erotic|porn\w*|hentai|nipples?|areolae?|breasts? out|genitals?|penis|"
    r"vagina|pussy|cum|orgasm\w*|masturbat\w*|fellatio|cunnilingus|"
    r"(?:vaginal|anal|oral)[\s_-]sex|spread[\s_-]legs|undress\w*|lingerie|"
    r"panties|bondage|bdsm|seductive|aroused|sexy|ecchi|pin-?ups?|boudoir|r-?18|"
    r"smut|fetish\w*|kinky|striptease|stripping)(?![\w-])",
    re.I,
)
_AGE = re.compile(r"(\d{1,2})[\s_-]?(?:yo|y/o|years?[\s_-]old)", re.I)

#: Added to the standing negative of every nsfw template.
YOUTH_NEGATIVE = {
    "tags": ["child", "loli", "shota", "toddler", "aged down", "young", "underage"],
    "sentences": ["child", "minor", "teenager", "young girl", "young boy", "childlike"],
}


def _found(text: str, *patterns: re.Pattern[str]) -> list[str]:
    hits = sorted((m for p in patterns for m in p.finditer(text or "")),
                  key=lambda m: m.start())
    out: list[str] = []
    for m in hits:
        age = _AGE.fullmatch(m.group(0))
        if age and int(age.group(1)) >= 18:
            continue
        word = m.group(0).lower()
        if word not in out:
            out.append(word)
    return out


def minor_words(text: str, *, sexual: bool = False) -> list[str]:
    """The words in ``text`` that only mean a minor ("25 years old" is fine;
    "16 years old" is not), in order, each once. In a sexual context
    (``sexual``) the young-person words count too: "schoolgirl" next to
    "nude" names a minor, not a costume."""
    return _found(text, _MINOR, _YOUNG_PERSON) if sexual else _found(text, _MINOR)


def youth_words(text: str) -> list[str]:
    """``minor_words`` plus the words an adult can be described with too
    (teen, school uniform), in order, each once."""
    return _found(text, _MINOR, _YOUNG_PERSON, _COSTUME)


def sexual_minor(text: str) -> bool:
    """True when ``text`` puts a minor word (a young-person word counts
    here) next to a sexual or nude one."""
    return bool(_EXPLICIT.search(text or "")) and bool(minor_words(text, sexual=True))


def refused_request(text: str) -> str:
    """Why a pack or draft request is refused outright, or "": its own
    words ask for a minor in a sexual context ("nsfw pack of underage
    girls", "sexy schoolgirls"). A costume request ("adult school uniform
    pack, nsfw") is not refused; the items are checked as they are
    built."""
    if not sexual_minor(text):
        return ""
    words = ", ".join(minor_words(text, sexual=True))
    return (f"This asks for a minor ({words}) in a sexual context. The assistant never "
            "writes that: an adult pack is for adults only.")


def with_youth_negative(negative: str, style: str) -> tuple[str, list[str]]:
    """``negative`` with the youth block's missing words appended, and the
    words added."""
    have = {w.strip().lower().replace("_", " ") for w in re.split(r"[,\n]", negative or "")}
    add = [w for w in YOUTH_NEGATIVE["sentences" if style == "sentences" else "tags"]
           if w not in have]
    if not add:
        return negative, []
    text = (negative or "").rstrip().rstrip(",").rstrip()
    return (f"{text}, " if text else "") + ", ".join(add), add
