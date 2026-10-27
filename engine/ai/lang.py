"""Requests in any language: what the code checks read when the user
doesn't write in English.

Many checks read the user's words with English patterns: whether a
message is a question or a change (`tools.catalog.message_kind`), how many
options it asks for (`asked.option_count`), which features its cards must
have (`request_check`), what a pack request needs (`pack.request_needs`)
and others. A German or Japanese ask reaches a model that understands it,
but these checks stay silent and some misfire: "Füge drei Wetteroptionen
hinzu" read as small talk, and the chat lost its change tools (research
note `pr-drafts/english-only-checks-and-card-design-2026-10-27.md`).

So a message that isn't plainly English (`looks_english`, free) gets one
small typed call first (`SYSTEM_PROMPT`, `SCHEMA`) that returns a
**request frame**: an English restatement of the ask (`english`, the
"translate-test" baseline of Liu et al., NAACL 2025, strongest for small
models) and a few fields the checks that matter most read directly
(`kind`, `count`, `weight`, `factor`, `wants`). The checks then read the
restatement instead of the raw text (`check_text`), and the fields where
a wrong read does damage. The model still gets the user's own words.

English messages cost nothing: the frame is only asked for when the gate
says the text isn't English, or Settings › AI assistant › Chat ›
"Language you write in" says Another language. A frame that fails or
comes back unusable leaves today's English checks on the raw text.
"""
from __future__ import annotations

import functools
import json
import re
from pathlib import Path
from typing import Any

#: Settings › AI assistant › Chat › "Language you write in".
LANGUAGES = ("auto", "english", "other")

#: English words that rarely mean anything in the languages users write
#: in: articles, pronouns, prepositions, auxiliaries and the verbs an ask
#: to the assistant uses. Words other languages share ("in", "so", "die",
#: "me", "a" as a Romance preposition) count too; the threshold leaves
#: room for them.
_ENGLISH = frozenset("""
a an the this that these those it its it's i i'm me my mine we our you your yours they them their
he she his her him who what which where when why how whose there here
is are was were be been being am do does did done doing have has had having
can could will would shall should may might must let lets let's
to of and or but not no nor if then than so as at by for from in into on onto off out over under
with without about after before between each every all any some more most less few fewer many
much very too also just only again once same other another such both either neither
up down please thanks thank ok okay yes yeah sure cool great nice perfect good bad
make makes made making add adds added adding create creates created build write writes wrote
give gives gave put puts set sets change changes changed edit fix rename remove removes
delete deletes replace swap move keep keeps drop turn switch show tell explain describe
open use uses used need needs want wants like likes look looks get gets got go goes going
try run test pick picks rewrite tag tags split merge draft fill apply undo redo
new old one two three four five six seven eight nine ten dozen first last next
rarer rare common commoner often never always sometimes half twice double
instead else otherwise because while though although still now later
""".split())

#: Common words of the other languages users write in (German, Spanish,
#: French, Italian, Portuguese, Dutch) that English never uses: a short
#: ask with one of them ("Mach Regen seltener") isn't English. Words that
#: are English too ("die", "per", "met", "den", "plus") are left out.
_OTHER = frozenset("""
der das und mit für ein eine einen einem einer nicht ist sind mach mache machen füge fügen
hinzu erstelle erstellen lösche löschen entferne ändere bitte noch oder aber auch nur nie
immer jede jeder jedes seltener häufiger mehr weniger halb wie dem des vom zum zur auf aus
bei nach von wenn dann sie ich wir ihr mein meine dein deine zwei drei vier fünf sechs
el la los las y con para una uno unos unas que por del como más menos haz crea añade
agrega borra elimina cambia quita pero también nunca siempre cada mitad veces opciones
le les et avec pour une des du au aux ajoute crée supprime enlève sans mais aussi seulement
jamais toujours chaque moins fois rends fais
il gli con della delle degli rendi aggiungi elimina più meno sempre mai ogni
os com uma um dos das da crie adicione remova nunca cada
het een en voor maak voeg verwijder niet nooit altijd elke
""".split()) - _ENGLISH

#: Words the app shares with any language ("wildcard", "negatives", item
#: names in English): they say nothing about the language of the ask.
_SHARED = frozenset("""
wildcard wildcards option options negative negatives fallback template templates bundle bundles
constraint constraints derivation derivations combine combines fixed values value rule rules
pack packs prompt prompts tag tags category categories rating nsfw sfw danbooru pony flux sdxl
lora loras seed seeds loop variable variables assembler context node nodes
""".split())

#: The built-in docs (`docs_index.json`, rendered from the manager's
#: English docs pages): their words are the English an ask to this app
#: uses ("outfit", "hair", "sandals", "victorian" aside).
_DOCS = Path(__file__).with_name("docs_index.json")


@functools.cache
def _vocabulary() -> frozenset[str]:
    try:
        pages = json.loads(_DOCS.read_text(encoding="utf-8")).get("pages") or []
    except (OSError, ValueError):
        return frozenset()
    text = " ".join(" ".join([str(p.get("title") or ""), str(p.get("blurb") or ""),
                              *(str(x.get("text") or "") for x in p.get("sections") or [])])
                    for p in pages if isinstance(p, dict))
    return frozenset(w.lower() for w in re.findall(r"[A-Za-z]{3,}", text)) - _OTHER


#: Letters outside the Latin script (Cyrillic, Greek, CJK, Arabic, …).
_NON_LATIN = re.compile(r"[^\W\d_a-zA-ZÀ-ɏḀ-ỿ]")
#: Latin letters English almost never uses: ä ö ü ß ñ ç ã õ å ø æ œ and
#: friends (é and è come in English loan words, so they don't count).
#: Matched on lower case without re.I: under re.I "i" matches dotless ı.
_FOREIGN_LATIN = re.compile(r"[äöüßñçãõåøæœąęłńśźżčřšžěůőűğşțăâêîôû¿¡]")
#: What isn't the user's own language: chips, references, variables,
#: code, quoted option text and Danbooru tags.
_NOT_PROSE = re.compile(
    r"\[\[[^\]]*\]\]|@\{[^}]*\}|@\w+|\$[\w.]+|`[^`]*`|\"[^\"]*\"|“[^”]*”|„[^“”]*[“”]"
    r"|\b\w+_\w+\b|https?://\S+")
_WORD = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)?")
#: Below this share of English words (function words and the docs'
#: words; the shared words left out) a longer message isn't English.
ENGLISH_SHARE = 0.45


def _prose(text: str) -> str:
    return _NOT_PROSE.sub(" ", text or "")


def _tag_list(text: str) -> bool:
    """A comma list of short pieces: prompt tags ("1woman, red hair,
    freckles"), which are English whatever the user speaks."""
    pieces = [p.strip() for p in re.split(r"[,\n]", text) if p.strip()]
    return len(pieces) >= 3 and sum(1 for p in pieces if len(p.split()) <= 3) >= 0.7 * len(pieces)


def looks_english(text: str, *, content: bool = False) -> bool:
    """Whether ``text`` reads as English, free and quiet when unsure the
    cheap way: no letters outside the Latin script, and enough English
    words among the ones that aren't shared app words. A message with no
    words of its own (only chips, tags or numbers) counts as English; so
    do a list of prompt tags and a single word, which every check reads
    the same either way. A short message needs one English word and no
    letters English doesn't use.

    ``content``: model-written text (a plan's names and options), read
    whole: quotes and tag lists are its words, not the user's asides."""
    if not isinstance(text, str) or not text.strip():
        return True
    prose = text if content else _prose(text)
    if _NON_LATIN.search(prose):
        return False
    words = [w.lower().replace("’", "'") for w in _WORD.findall(prose)]
    own = [w for w in words if w not in _SHARED]
    if not own:
        return True
    hits = sum(1 for w in own if w in _ENGLISH)
    other = sum(1 for w in own if w in _OTHER)
    foreign = len(_FOREIGN_LATIN.findall(prose.lower()))
    if not foreign and not other and not content and _tag_list(prose):
        return True
    if len(own) == 1:
        # One word reads the same to every check ("Danke!", "boots"): not
        # worth a model call.
        return not foreign
    if other and other >= hits:
        return False
    if len(own) <= 3:
        # "3 hair styles", "darker colours": short English asks often have
        # no English function word, so only another language's own words
        # or letters say it isn't English.
        return not foreign and not other
    vocab = _vocabulary()
    known = sum(1 for w in own if w in _ENGLISH or w in vocab)
    return known / len(own) >= ENGLISH_SHARE + 0.15 * min(foreign, 2)


def needs_frame(text: str, setting: str = "auto") -> bool:
    """Whether a message gets the request frame: the setting decides when
    it isn't Automatic."""
    if not isinstance(text, str) or not text.strip() or text == "(retry)":
        return False
    if setting == "english":
        return False
    if setting == "other":
        return True
    return not looks_english(text)


# ── The frame call ───────────────────────────────────────────────────────

#: What a request may ask its cards for (`request_check.FEATURES`, by key).
WANTS = ("constraint", "only_rule", "fallback", "negatives", "tag_ref")
KINDS = ("question", "change", "chat")
WEIGHTS = ("none", "rarer", "commoner")
MAX_ENGLISH = 1200

SYSTEM_PROMPT = """\
You read one message a user wrote to the assistant of an image-prompt tool \
(wildcards: lists of options picked at random; constraints and rules between \
them; templates; packs). The message can be in any language. You never \
answer it or do what it asks: you only fill in the form about it.

- english: the message in plain, literal English. Keep every item name, \
option text, tag, @name, [[chip]] and $variable exactly as written, and \
write numbers as digits. Don't add, explain or leave out anything.
- kind: "question" when it asks how something works or what something is; \
"change" when it asks to make, add, edit, delete, test or draft something; \
"chat" for thanks, greetings or small talk.
- count: how many options or items it asks for, as a number, or null when \
it names no count.
- weight: "rarer" when it asks to make options less likely, "commoner" for \
more likely, else "none". factor: the factor it names (half as likely 0.5, \
twice as common 2), or null.
- wants: the features it asks for by meaning, in any wording: "constraint" \
(one list's pick rules out, limits or goes with another's), "only_rule" \
(a pick gets ONLY certain options of another list), "fallback" (an option \
taken when nothing else is left, or "never empty"), "negatives" (words for \
the negative prompt), "tag_ref" (options drawn only from some tags of \
another list). Empty when it asks for none.
- language: the language it is written in, as a two-letter code ("de", \
"ja", "es"; "en" for English).
"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "language": {"type": "string"},
        "english": {"type": "string"},
        "kind": {"type": "string", "enum": list(KINDS)},
        "count": {"type": ["integer", "null"]},
        "weight": {"type": "string", "enum": list(WEIGHTS)},
        "factor": {"type": ["number", "null"]},
        "wants": {"type": "array", "items": {"type": "string", "enum": list(WANTS)}},
    },
    "required": ["language", "english", "kind", "count", "weight", "factor", "wants"],
    "additionalProperties": False,
}


def frame_prompt(text: str) -> str:
    return f"The message:\n<<<\n{text}\n>>>\n\nFill in the form."


def compile_frame(raw: Any, text: str) -> dict[str, Any] | None:
    """The model's form, checked, or None when it isn't usable. A field the
    model got wrong is dropped, not guessed: the checks fall back to the
    English restatement for it."""
    if not isinstance(raw, dict):
        return None
    english = raw.get("english")
    if not isinstance(english, str) or not english.strip():
        return None
    english = re.sub(r"\s+", " ", english).strip()[:MAX_ENGLISH]
    lang = raw.get("language")
    lang = lang.strip().lower()[:8] if isinstance(lang, str) else ""
    kind = raw.get("kind") if raw.get("kind") in KINDS else None
    count = raw.get("count")
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100:
        count = None
    weight = raw.get("weight") if raw.get("weight") in WEIGHTS else "none"
    factor = raw.get("factor")
    if isinstance(factor, bool) or not isinstance(factor, (int, float)) \
            or not 0 < float(factor) <= 100 or float(factor) == 1:
        factor = None
    else:
        factor = round(float(factor), 4)
        # "half as likely" with weight "commoner": the factor decides.
        weight = "rarer" if factor < 1 else "commoner"
    wants_raw = raw.get("wants")
    wants = [w for w in dict.fromkeys(wants_raw) if w in WANTS] \
        if isinstance(wants_raw, list) else []
    return {"language": lang, "english": english, "kind": kind, "count": count,
            "weight": weight, "factor": factor, "wants": wants, "text": text}


# ── What the checks read ─────────────────────────────────────────────────

def check_text(frame: dict[str, Any] | None, text: str) -> str:
    """The text the English checks read: the frame's restatement, else the
    message itself."""
    if frame and isinstance(frame.get("english"), str) and frame["english"]:
        return frame["english"]
    return text if isinstance(text, str) else ""


def message_kind(frame: dict[str, Any] | None, working: bool = False) -> str | None:
    """`tools.catalog.message_kind` from the frame: "question", "chat" or
    "task", or None without one. In a chat that already proposed cards
    (``working``) small talk carries on the work, as there."""
    kind = (frame or {}).get("kind")
    if kind == "question":
        return "question"
    if kind == "change":
        return "task"
    if kind == "chat":
        return "task" if working else "chat"
    return None


def count(frame: dict[str, Any] | None) -> int:
    """How many options or items the frame says the ask names, else 0."""
    got = (frame or {}).get("count")
    return got if isinstance(got, int) and not isinstance(got, bool) else 0


def weight_direction(frame: dict[str, Any] | None) -> int:
    """-1 rarer, 1 commoner, 0 neither (`asked.weight_direction`)."""
    return {"rarer": -1, "commoner": 1}.get(str((frame or {}).get("weight")), 0)


def weight_factor(frame: dict[str, Any] | None) -> float | None:
    got = (frame or {}).get("factor")
    return float(got) if isinstance(got, (int, float)) and not isinstance(got, bool) else None


def wants(frame: dict[str, Any] | None) -> list[str] | None:
    """The features the frame says the ask wants, or None without one."""
    if not frame:
        return None
    got = frame.get("wants")
    return list(got) if isinstance(got, list) else []


def _strings(value: Any, out: list[str], limit: int = 400) -> list[str]:
    if len(out) >= limit:
        return out
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for v in value.values():
            _strings(v, out, limit)
    elif isinstance(value, list):
        for v in value:
            _strings(v, out, limit)
    return out


def _stems(text: str) -> set[str]:
    return {w.lower()[:5] for w in _WORD.findall(text) if len(w) > 2} - _ENGLISH


def for_content(raw: str, english: str, content: Any) -> str:
    """Which of the user's own words (``raw``) and the restatement
    (``english``) a check compares with model-written ``content`` (a pack
    plan, a draft's options: its strings are read, not its keys): the one
    whose words the content shares more of, so "Wetter" is matched against
    "Wetter" and "weather" against "weather". A tie goes to the user's
    words unless the content reads as English."""
    if not english or english == raw:
        return raw
    text = ". ".join(_strings(content, [])) if not isinstance(content, str) else content
    have = _stems(text[:20000])
    in_raw, in_english = len(have & _stems(raw)), len(have & _stems(english))
    if in_raw != in_english:
        return english if in_english > in_raw else raw
    return english if looks_english(text[:8000], content=True) else raw
