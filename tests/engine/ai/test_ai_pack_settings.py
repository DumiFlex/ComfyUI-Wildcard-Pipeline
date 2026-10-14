"""engine/ai/pack.py — the run style, LoRA, model and input settings: what
they ask of the plan, what the review flags, and the story check over the
Loop's frames."""
from __future__ import annotations

from engine.ai import pack


def _item(**kw):
    base = {"kind": "wildcard", "name": "", "var": "", "about": "", "count": 6, "tags": [],
            "source": "", "target": "", "use": ""}
    return {**base, **kw}


def _plan(settings, items, inputs=None):
    raw = {"title": "Walk", "summary": "", "style": "tags", "anchor": "", "items": items,
           "inputs": inputs or []}
    return pack.compile_plan(raw, settings=settings)


def test_settings_parse_with_defaults_and_bounds():
    cfg = pack.parse_settings({"run": "story", "frames": 40, "loras": "both",
                               "model": "family", "inputs": "subject"})
    assert (cfg["run"], cfg["frames"], cfg["loras"], cfg["model"], cfg["inputs"]) == (
        "story", pack.MAX_FRAMES, "both", "family", "subject")
    cfg = pack.parse_settings({"run": "comic", "frames": 1, "loras": True})
    assert (cfg["run"], cfg["frames"], cfg["loras"], cfg["model"], cfg["inputs"]) == (
        "single", pack.MIN_FRAMES, "none", "any", "auto")


def test_settings_note_says_what_each_choice_needs():
    note = pack.settings_note({"run": "story", "frames": 5, "loras": "character",
                               "model": "family", "inputs": "subject"})
    assert "story over a WP Context Loop of 5 frames" in note and "$iteration" in note
    assert "use \"hold\"" in note and "$beat" in note
    assert "character LoRA that can replace the random character" in note
    assert "$model_variant" in note and "score_9" in note
    assert "input subject" in note
    sweep = pack.settings_note({"run": "sweep", "loras": "style"})
    assert "sweep axes" in sweep and f"at most {pack.MAX_SWEEP_OPTIONS}" in sweep
    assert "style_lora" in sweep
    plain = pack.settings_note({})
    assert "Loop" not in plain and "LoRA" not in plain


def test_review_asks_for_what_the_settings_need():
    plan = _plan({"run": "story", "frames": 4, "loras": "character", "model": "family"}, [
        _item(name="Character", var="character", about="random anime girls"),
        _item(name="Outfit", var="outfit", about="outfits"),
        _item(kind="template", name="T", about="$character, $outfit"),
    ])
    found = pack.review_plan(plan)
    texts = " | ".join(f["text"] for f in found)
    assert "Story over a Loop needs a derivation" in texts
    assert "Nothing is held" in texts
    assert "input $character_lora" in texts
    assert "replace the random character" in texts
    assert "Per model family" in texts
    beat = next(f for f in found if f["text"].startswith("Story over"))
    assert beat["patch"]["op"] == "add" and beat["patch"]["item"]["var"] == "beat"
    assert "frame 1 to 4" in beat["patch"]["item"]["about"]
    lora_in = next(f for f in found if "input $character_lora" in f["text"])
    assert lora_in["patch"]["op"] == "plan" and lora_in["patch"]["label"] == "Add $character_lora"
    assert lora_in["patch"]["set"]["inputs"][-1]["var"] == "character_lora"
    char = next(f for f in found if "replace the random character" in f["text"])
    assert char["patch"]["item"]["var"] == "character"

    # With what they need, the settings say nothing.
    done = _plan({"run": "story", "frames": 4, "loras": "character", "model": "family"}, [
        _item(name="Character", var="character", about="random anime girls", use="hold"),
        _item(kind="derivation", name="Story beat", var="beat",
              about="$beat from $iteration: 1 arrives, 2 looks around"),
        _item(kind="derivation", name="Character LoRA", var="character",
              about="when $character_lora is set, replace $character with it"),
        _item(kind="derivation", name="Model quality", var="quality",
              about="from $model_variant"),
        _item(kind="template", name="T", about="$quality, $character, $beat"),
    ], inputs=[{"var": "character_lora", "about": "LoRA", "example": "<lora:x:0.8>"}])
    texts = " | ".join(f["text"] for f in pack.review_plan(done))
    for gone in ("Story over", "Nothing is held", "character_lora", "Per model family",
                 "isn't set", "nothing in the pack sets"):
        assert gone not in texts


def test_sweep_axes_stay_short():
    plan = _plan({"run": "sweep"}, [
        _item(name="Pose", var="pose", about="sweep axis: poses", count=20),
        _item(kind="template", name="T", about="$pose"),
    ])
    [f] = [f for f in pack.review_plan(plan) if "sweep axis" in f["text"]]
    assert f["patch"] == {"op": "edit", "key": plan["items"][0]["key"],
                          "set": {"count": pack.MAX_SWEEP_OPTIONS}}
    plain = _plan({"run": "sweep"}, [_item(name="Pose", var="pose", about="poses"),
                                     _item(kind="template", name="T", about="$pose")])
    assert any("No wildcard is marked as a sweep axis" in f["text"]
               for f in pack.review_plan(plain))


def test_story_check_plays_every_frame():
    plan = _plan({"run": "story", "frames": 3}, [
        _item(name="Place", var="place", about="places", use="hold"),
        _item(kind="derivation", name="Story beat", var="beat", about="$beat from $iteration"),
        _item(kind="template", name="T", about="$beat"),
    ])
    deriv = next(i for i in plan["items"] if i["kind"] == "derivation")
    tpl = next(i for i in plan["items"] if i["kind"] == "template")
    d = pack.compile_item(plan, deriv["key"], {}, {"rules": [{"summary": "beats", "branches": [
        {"match": "all", "conditions": [{"var": "iteration", "op": "equals", "value": "1"}],
         "actions": [{"target_var": "beat", "mode": "replace", "value": "arrives"}]},
        {"match": "all", "conditions": [{"var": "iteration", "op": "equals", "value": "2"}],
         "actions": [{"target_var": "beat", "mode": "replace", "value": "looks around"}]}],
        "else_actions": [{"target_var": "beat", "mode": "replace", "value": "leaves"}]}]})
    built = {deriv["key"]: {"id": d["id"], "payload": d["payload"]}}
    t = pack.compile_item(plan, tpl["key"], built, {"template": "$beat", "negative": ""})
    built[tpl["key"]] = {"id": t["id"], "payload": t["payload"]}
    report = pack.check_pack(plan, built, seeds=9)
    assert report["runs"] == 9 and report["failed"] == 0
    [beat] = [v for v in report["variables"] if v["var"] == "beat"]
    assert beat["distinct"] == 3
    assert [p["text"] for p in report["prompts"]] == ["arrives", "looks around", "leaves"]
    assert not report["problems"]
    assert any("WP Context Loop before the Context, count 3" in n
               for n in pack.wiring_notes(plan))
