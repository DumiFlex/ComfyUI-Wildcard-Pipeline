"""Adult packs: the safeguards the Pack builder enforces on nsfw packs.

Prompting alone doesn't hold with a weak model, so on a pack rated nsfw:

- options, values and rule text that name or imply a minor are left out
  (`youth_words`), with a warning saying which;
- the template's negative always carries the youth block for the pack's
  style (`with_youth_negative`), whatever the model wrote.

Everywhere else (chat, Draft with AI), an option that puts a youth word
next to a sexual one is left out (`sexual_minor`).

The words are whole-word matches (the engine's blocklist works the same
way), so "childhood home" is caught but "wild" or "kidney" are not. Words
like "petite" or "small" stay: on their own they describe adults too; the
guide asks for an adult anchor on every character instead.

See `/pr-drafts/prompt-writing-research.md` §7.5.
"""
from __future__ import annotations

import re

# School-age and youth words, singular and plural, Danbooru spellings too.
_YOUTH = re.compile(
    r"(?<![\w-])(?:"
    r"child(?:ren|ish|like|hood)?|kids?|kiddos?|toddlers?|infants?|babies|"
    r"loli(?:con|ta)?|shota(?:con)?|cub|"
    r"minors?|underage(?:d)?|under[\s_-]?aged?|preteens?|pre[\s_-]teens?|"
    r"tweens?|teens?|teenage(?:rs?|d)?|adolescen(?:ts?|ce)|juveniles?|jailbait|"
    r"school[\s_-]?(?:girls?|boys?|kids?|children|uniforms?|swimsuits?)|"
    r"(?:elementary|middle|junior[\s_-]high|primary)[\s_-]?school\w*|"
    r"(?:young|little)[\s_-](?:girls?|boys?)|"
    r"aged[\s_-]down|younger[\s_-]sister|younger[\s_-]brother|"
    r"\d{1,2}[\s_-]?(?:yo|y/o|years?[\s_-]old)"
    r")(?![\w-])",
    re.I,
)
# Sexual or nude words: an option that has one of these AND a youth word is
# never kept, in any pack or chat answer.
_EXPLICIT = re.compile(
    r"(?<![\w-])(?:nsfw|explicit|nude|nudity|naked|topless|bottomless|sex|sexual|"
    r"lewd|erotic|porn\w*|hentai|nipples?|areolae?|breasts? out|genitals?|penis|"
    r"vagina|pussy|cum|orgasm\w*|masturbat\w*|fellatio|cunnilingus|"
    r"(?:vaginal|anal|oral)[\s_-]sex|spread[\s_-]legs|undress\w*|lingerie|"
    r"panties|bondage|bdsm|seductive|aroused)(?![\w-])",
    re.I,
)
_AGE = re.compile(r"(\d{1,2})[\s_-]?(?:yo|y/o|years?[\s_-]old)", re.I)

#: Added to the standing negative of every nsfw template.
YOUTH_NEGATIVE = {
    "tags": ["child", "loli", "shota", "toddler", "aged down", "young", "underage"],
    "sentences": ["child", "minor", "teenager", "young girl", "young boy", "childlike"],
}


def youth_words(text: str) -> list[str]:
    """The youth words in ``text`` ("25 years old" is fine; "16 years old"
    is not), in order, each once."""
    out: list[str] = []
    for m in _YOUTH.finditer(text or ""):
        age = _AGE.fullmatch(m.group(0))
        if age and int(age.group(1)) >= 18:
            continue
        word = m.group(0).lower()
        if word not in out:
            out.append(word)
    return out


def sexual_minor(text: str) -> bool:
    """True when ``text`` puts a youth word next to a sexual or nude one."""
    return bool(youth_words(text)) and bool(_EXPLICIT.search(text or ""))


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
