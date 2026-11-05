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
way), so "child" is caught but "wild" or "kidney" are not. Adult body and
look words (petite, small breasts, flat chest, innocent look, cute) are
never dropped or flagged: they are everyday prompt words for adults, and
the guard draws a line, it doesn't censor (Dumi, 2026-10-27).

A negated word is not a request for it: "adult woman, no children, no
minors" names no minor (bench P13 lost exactly that option). Like NegEx, a
trigger (no, not, never, without, nothing, avoid, exclude) negates the words
after it up to the next comma, period, semicolon or "but", at most eight
words, so "no children or minors" is one scope; a comparative ("no older
than 15", "no more than 16 years old") is not a negation. Only the minor and
non-consent words are read through that mask: the sexual words are read as
written, since Danbooru's "no panties" means nude.

The other line is consent (`noncon_words`): rape, non-consensual, against
her will, without consent, unwilling, molest, sexual assault, violation,
drugged, unconscious, coerced. In a sexual context such text is left out
like a minor (bench Z17 kept "painful violation"); kink between adults
(bondage, rough, a "forced orgasm" play term) is not the line. `blocked`
gives the reason for either.

See `/pr-drafts/prompt-writing-research.md` §7.5 and
`/pr-drafts/safety-guard-2026-10-27.md`.
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
# The same tiers in the main other languages (de, es, fr, pt, it, ru,
# ja, zh, ko), hand-checked, so a request or an answer in German or Japanese
# meets the same line (bench research 2026-10-27: "NSFW-Paket mit
# minderjährigen Mädchen" was not refused). Only unambiguous words in the
# minor tier; a word that can name an adult ("Teenager", 少女, JK) goes in the
# young-person tier, which counts only in a sexual context. A word for "girl"
# alone (Mädchen, chica, 女の子) is in neither, like "girl" in English. CJK has
# no spaces, so those words are matched anywhere.
_MINOR_INTL = re.compile(
    r"(?<![\w-])(?:"
    r"(?-i:Kind)|kinder|kleinkind(?:er)?|minderjährig\w*|"                # de
    r"niñ[oa]s?|menor(?:es)?\s+de\s+edad|infantil(?:es)?|"                # es
    r"enfants?|mineur(?:e|es|s)?|fillettes?|"                             # fr
    r"crianças?|menor(?:es)?\s+de\s+idade|"                               # pt
    r"bambin[aoie]|minorenn[ei]|"                                         # it
    r"реб[её]н\w*|дет(?:и|ей|ям|ьми|ский|ская|ское)|несовершеннолетн\w*|"   # ru
    r"малолетн\w*|девочк\w*|подрост\w*"
    r")(?![\w-])",
    re.I,
)
_MINOR_CJK = re.compile(
    r"子供|子ども|こども|幼女|幼児|児童|未成年|ロリ|ショタ|小学生|中学生|女子中学生|"   # ja
    r"儿童|兒童|萝莉|蘿莉|正太|小學生|初中生|"                                      # zh
    r"아동|어린이|미성년|초등학생|중학생|로리"                                      # ko
)
_YOUNG_INTL = re.compile(
    r"(?<![\w-])(?:"
    r"teenager(?:in|innen)?|schulmädchen|junges?\s+mädchen|kleines?\s+mädchen|"  # de
    r"adolescentes?|colegialas?|"                                         # es, fr, pt
    r"écolières?|petites?\s+filles?|"                                     # fr
    r"школьниц\w*|школьник\w*"                                            # ru
    r")(?![\w-])",
    re.I,
)
_YOUNG_CJK = re.compile(r"少女|女子高生|女高中生|여고생|소녀|(?<![A-Za-z])JK(?![A-Za-z])")
_EXPLICIT_INTL = re.compile(
    r"(?<![\w-])(?:"
    r"nackt\w*|erotisch\w*|"                                              # de
    r"desnud[oa]s?|erótic[oa]s?|sexual(?:es)?|"                           # es, pt
    r"nue?s?|nues|sexe|érotiques?|"                                       # fr
    r"nu[ae]s?|sexo|"                                                     # pt
    r"nud[aoie]|sesso|erotic[aoi]|"                                       # it
    r"гол(?:ая|ый|ые|ой)|обнаж[её]нн\w*|секс\w*|эротич\w*|порн\w*"           # ru
    r")(?![\w-])",
    re.I,
)
_EXPLICIT_CJK = re.compile(
    r"全裸|裸|ヌード|エロ|セックス|性行為|"           # ja (裸 also zh)
    r"裸体|色情|性爱|做爱|性愛|"                      # zh
    r"나체|누드|섹스|야한|"                           # ko
    r"(?i:nsfw)"                                      # "NSFW-Paket", "NSFWパック"
)
_MINORS = (_MINOR, _MINOR_INTL, _MINOR_CJK)
_YOUNG = (_YOUNG_PERSON, _YOUNG_INTL, _YOUNG_CJK)
_SEXUAL = (_EXPLICIT, _EXPLICIT_INTL, _EXPLICIT_CJK)


def _is_sexual(text: str) -> bool:
    return any(p.search(text or "") for p in _SEXUAL)


_AGE = re.compile(r"(\d{1,2})[\s_-]?(?:yo|y/o|years?[\s_-]old)", re.I)
#: Sex without consent. Read through the negation mask, so "consensual,
#: never against her will" passes; "without consent" and "not consenting"
#: keep their own negation (the mask skips a trigger before "consent").
_NONCON = re.compile(
    r"(?<![\w-])(?:"
    r"rap(?:e|es|ed|ing|ist|ists)|non[\s_-]?con(?:sent(?:ual|ing)?|sensual)?|"
    r"against\s+(?:her|his|their|its|my|your)\s+will|"
    r"without\s+(?:(?:her|his|their|my|your|any)\s+)?consent|"
    r"not\s+consent(?:ing|ed)?|unwilling(?:ly)?|"
    r"molest\w*|sexual(?:ly)?[\s_-]assault\w*|sexual[\s_-]abuse|"
    r"violat(?:ion|ions|ed|ing|e)|drugged|unconscious|passed[\s_-]out|coerc\w*|"
    r"forced[\s_-](?:sex|penetration|into[\s_-]sex|to[\s_-]have[\s_-]sex)|forcibly"
    r")(?![\w-])",
    re.I,
)
#: A negation trigger and its scope (NegEx-style), up to the next comma,
#: period, semicolon, colon or "but", at most eight words. Not a
#: comparative ("no older than 15") and not "without consent" (its own
#: non-consent phrase).
_NEGATED = re.compile(
    r"(?<![\w-])(?:no|not|never|without|nothing|none|zero|avoid(?:s|ing)?|"
    r"exclud(?:e|es|ing)|free\s+of|"
    # de, es, fr, pt, it, ru
    r"kein(?:e|en|er|em|es)?|nicht|ohne|sin|nunca|sans|pas\s+de|jamais|sem|nem|senza|"
    r"mai|без|не|нет)"
    r"(?!\s+(?:more|older|over|longer|bigger|taller|less|younger|than)\b)"
    r"(?!\s+(?:(?:her|his|their|my|your|any)\s+)?consent)"
    r"(?:\s+(?!but\b)[^\s,.;:!?]+){1,8}",
    re.I,
)

#: Added to the standing negative of every nsfw template.
YOUTH_NEGATIVE = {
    "tags": ["child", "loli", "shota", "toddler", "aged down", "young", "underage"],
    "sentences": ["child", "minor", "teenager", "young girl", "young boy", "childlike"],
}


def unnegated(text: str) -> str:
    """``text`` with its negated phrases blanked ("no children, no minors"
    → spaces), same length so positions still match."""
    return _NEGATED.sub(lambda m: " " * len(m.group(0)), text or "")


def _found(text: str, *patterns: re.Pattern[str]) -> list[str]:
    text = unnegated(text)
    hits = sorted((m for p in patterns for m in p.finditer(text)),
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


def explicit_words(text: str) -> list[str]:
    """The sexual or nude words in ``text``, in order. Read as written:
    "no panties" is a nude tag, not a negation."""
    out: list[str] = []
    hits = sorted((m for p in _SEXUAL for m in p.finditer(text or "")),
                  key=lambda m: m.start())
    for m in hits:
        word = m.group(0).lower()
        if word not in out:
            out.append(word)
    return out


def noncon_words(text: str) -> list[str]:
    """The words in ``text`` that mean sex without consent ("rape",
    "against her will"), in order, each once; negated ones don't count."""
    return _found(text, _NONCON)


def minor_words(text: str, *, sexual: bool = False) -> list[str]:
    """The words in ``text`` that only mean a minor ("25 years old" is fine;
    "16 years old" is not), in order, each once. In a sexual context
    (``sexual``) the young-person words count too: "schoolgirl" next to
    "nude" names a minor, not a costume."""
    return _found(text, *_MINORS, *_YOUNG) if sexual else _found(text, *_MINORS)


def youth_words(text: str) -> list[str]:
    """``minor_words`` plus the words an adult can be described with too
    (teen, school uniform), in order, each once."""
    return _found(text, *_MINORS, *_YOUNG, _COSTUME)


def sexual_minor(text: str) -> bool:
    """True when ``text`` puts a minor word (a young-person word counts
    here) next to a sexual or nude one."""
    return _is_sexual(text) and bool(minor_words(text, sexual=True))


def blocked(text: str, *, sexual: bool = False) -> str:
    """Why an AI-written text is never kept, or "": it names a minor, or
    sex without consent, in a sexual context. ``sexual``: the text's place
    is one already (an item of a pack rated nsfw); otherwise a sexual or
    nude word in the text itself makes it one."""
    if not sexual and not _is_sexual(text):
        return ""
    if minor_words(text, sexual=True):
        return "it names a minor in a sexual context"
    if noncon_words(text):
        return "it shows sex without consent"
    return ""


def refused_request(text: str) -> str:
    """Why a pack or draft request is refused outright, or "": its own
    words ask for a minor in a sexual context ("nsfw pack of underage
    girls", "sexy schoolgirls") or for sex without consent. A costume
    request ("adult school uniform pack, nsfw") is not refused; the items
    are checked as they are built. A negated minor ("adult women, no
    minors") asks for no minor."""
    if sexual_minor(text):
        words = ", ".join(minor_words(text, sexual=True))
        return (f"This asks for a minor ({words}) in a sexual context. The assistant never "
                "writes that: an adult pack is for adults only.")
    if _is_sexual(text) and noncon_words(text):
        words = ", ".join(noncon_words(text))
        return (f"This asks for sex without consent ({words}). The assistant never writes "
                "that: everything in an adult pack is consensual.")
    return ""


#: A request that asks the negative to keep youth out ("a negative against
#: anything youthful", "no minors in the negative").
_YOUTH_NEGATIVE_ASK = re.compile(
    r"negative[^.;\n]{0,80}(?:youth\w*|young\w*|child\w*|minors?|teen\w*|underage|loli\w*)"
    r"|(?:youth\w*|young\w*|child\w*|minors?|teen\w*|underage|loli\w*)[^.;\n]{0,40}"
    r"(?:in|to|into)\s+(?:the\s+)?negative",
    re.I,
)


def asks_youth_negative(text: str) -> bool:
    """True when a request asks the negative to keep youth out."""
    return bool(_YOUTH_NEGATIVE_ASK.search(text or ""))


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
