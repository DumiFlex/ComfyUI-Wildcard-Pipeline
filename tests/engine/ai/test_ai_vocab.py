"""engine/ai/vocab.py — the user's tags, LoRAs and embeddings for the AI."""
from __future__ import annotations

from engine.ai import chat, pack, vocab
from engine.ai import tools as ai_tools

TAGS = {"long_hair": 900, "long_sleeves": 500, "red_hair": 400, "1girl": 5000,
        "smile": 3000, "school_uniform": 800}
LORAS = ["styles/ink_wash.safetensors", "characters/aria_v2.safetensors"]


def fake(kind, query, limit):
    if kind == "tags":
        q = query.strip().lower().replace(" ", "_")
        if not q:
            return []
        hits = sorted((t for t in TAGS if t.startswith(q)), key=lambda t: -TAGS[t])
        return [{"name": t, "matched": t, "count": TAGS[t], "category": "general"}
                for t in hits[:limit]]
    names = [p for p in LORAS if query.lower() in p.lower()] if query else LORAS
    return [{"name": p.rsplit("/", 1)[-1].split(".")[0], "path": p} for p in names[:limit]]


def test_flags_and_tag_splitting():
    assert vocab.flags({"tags": True, "loras": False, "embeddings": "yes"}) == {"tags"}
    assert vocab.flags(None) == set()
    assert vocab.split_tags("1girl, (long hair:1.2), <lora:x:0.8>, $hair, score_9, "
                            "embedding:bad, [smile], 2.5") == ["1girl", "long_hair", "smile"]


def test_answer_lists_and_checks_tags():
    out = vocab.answer(fake, "tags", "long")
    assert "long_hair (900 posts, general)" in out and out.index("long_hair") < out.index(
        "long_sleeves")
    checked = vocab.answer(fake, "tags", "long hair, sparkly gown, smile")
    assert "2 of 3 are Danbooru tags" in checked
    assert "- sparkly_gown: NOT in the tag list" in checked
    assert "- long_hair: long_hair (900 posts" in checked
    assert "No Danbooru tags start" in vocab.answer(fake, "tags", "zzz")
    loras = vocab.answer(fake, "loras", "ink")
    assert "ink_wash · path styles/ink_wash.safetensors" in loras and "<lora:PATH:0.8>" in loras


def test_notes_for_the_pack_builder():
    assert vocab.unknown_tags(fake, {"tags"}, ["long hair, sparkly gown", "smile"]) == [
        "sparkly_gown"]
    assert vocab.unknown_tags(fake, set(), ["sparkly gown"]) == []
    assert "red_hair" in vocab.vocab_note(fake, {"tags"}, ["red", "hair"])
    assert vocab.vocab_note(None, {"tags"}, ["red"]) == ""
    note = vocab.loras_note(fake, {"loras"}, ["aria"])
    assert "characters/aria_v2.safetensors" in note and "styles/ink_wash" in note
    assert vocab.loras_note(fake, set(), ["aria"]) == ""


def test_pack_checks_tag_style_items():
    plan = pack.compile_plan({"title": "x", "style": "tags", "items": [
        {"kind": "wildcard", "name": "Hair", "var": "hair", "about": "long or red hair"}]})
    payload = {"options": [{"value": "long hair"}, {"value": "sparkly hair"}]}
    note = pack.tag_check_note(plan, "wildcard", payload, fake, {"tags"})
    assert note == "Not in your Danbooru tag list: sparkly_hair"
    # Never a repair: the build doesn't rebuild on its own for it.
    assert pack.repair_note([note]) == ""
    assert pack.tag_check_note({**plan, "style": "sentences"}, "wildcard", payload, fake,
                               {"tags"}) == ""
    assert "long_hair" in pack.item_vocab_note(plan, plan["items"][0]["key"], fake, {"tags"})


def test_the_chat_offers_lookup_only_when_on():
    assert "lookup" not in ai_tools.toolset(None, scoped=False)
    assert "lookup" in ai_tools.toolset(None, scoped=False, vocab=True)
    assert "lookup" in ai_tools.toolset("wildcards", scoped=True, vocab=True)
    lib = chat.Library([], [], [])
    assert "Tag autocomplete" in lib.run("lookup", {"kind": "tags", "query": "long"})
    lib.vocab, lib.vocab_kinds = fake, {"tags", "loras"}
    assert "long_hair" in lib.run("lookup", {"kind": "tag", "query": "long"})
    assert "aria_v2" in lib.run("lookup", {"kind": "loras", "query": "aria"})
    assert "Embedding autocomplete" in lib.run("lookup", {"kind": "embeddings", "query": "x"})
