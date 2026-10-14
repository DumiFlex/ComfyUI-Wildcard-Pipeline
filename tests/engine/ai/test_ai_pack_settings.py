"""engine/ai/pack.py — the run style, LoRA, model and input settings: what
they ask of the plan, what the review flags, and the story check over the
Loop's frames."""
from __future__ import annotations

from engine.ai import pack


def _item(**kw):
    base = {"kind": "wildcard", "name": "", "var": "", "about": "", "count": 6, "tags": [],
            "source": "", "target": "", "use": ""}
    return {**base, **kw}


def _plan(settings, items, inputs=None, run=None):
    raw = {"title": "Walk", "summary": "", "style": "tags", "anchor": "", "items": items,
           "inputs": inputs or [], "run": run}
    return pack.compile_plan(raw, settings=settings)


def test_settings_hold_only_pack_wide_preferences():
    cfg = pack.parse_settings({"model": "family", "run": "story", "loras": "both",
                               "inputs": "subject", "frames": 5})
    assert cfg["model"] == "family"
    # What the pack is about is the planner's: read from the request or asked.
    for gone in ("run", "loras", "inputs", "frames"):
        assert gone not in cfg
    assert set(pack.SETTINGS) == {"library", "negatives", "structure", "style", "rating",
                                  "model"}
    for asked in ('ask (header "Subject")', 'Ask (header "Run")', "outfit_lora"):
        assert asked in pack.PLAN_SYSTEM


def test_run_is_read_from_the_plan_and_kept_across_refines():
    assert pack.parse_run({"mode": "story", "frames": 40}) == {"mode": "story", "frames": 12}
    assert pack.parse_run({"mode": "story", "frames": 0}) == {"mode": "story", "frames": 4}
    assert pack.parse_run({"mode": "sweep", "frames": 3}) == {"mode": "sweep", "frames": 0}
    assert pack.parse_run({"mode": "comic"}) == {"mode": "single", "frames": 0}
    plan = _plan({}, [_item(name="Place", var="place", about="places"),
                      _item(kind="template", name="T", about="$place")],
                 run={"mode": "story", "frames": 5})
    assert plan["run"] == {"mode": "story", "frames": 5}
    assert pack.plan_answer(plan)["run"] == {"mode": "story", "frames": 5}
    # A follow-up answer without a run keeps the one the plan had.
    again = pack.compile_plan({"title": "Walk", "items": [
        {"kind": "wildcard", "name": "Place", "var": "place", "about": "places"},
        {"kind": "template", "name": "T", "about": "$place"}]}, previous=plan)
    assert again["run"] == {"mode": "story", "frames": 5}
    assert "story over a WP Context Loop of 5 frames" in "\n".join(pack._plan_lines(plan))


def test_settings_note_says_what_the_model_setting_needs():
    note = pack.settings_note({"model": "family"})
    assert "$model_variant" in note and "score_9" in note
    plain = pack.settings_note({})
    assert "Loop" not in plain and "LoRA" not in plain and "model_variant" not in plain


def test_review_asks_for_what_the_run_and_loras_need():
    plan = _plan({"model": "family"}, [
        _item(name="Character", var="character", about="random anime girls"),
        _item(name="Outfit", var="outfit", about="outfits"),
        _item(kind="template", name="T", about="$character, $outfit, $style_lora"),
    ], inputs=[{"var": "outfit_lora", "about": "an outfit LoRA", "example": "<lora:x:0.8>"},
               {"var": "style_lora", "about": "a style LoRA", "example": "<lora:s:0.8>"},
               {"var": "pose_lora", "about": "a pose LoRA", "example": "<lora:p:0.8>"}],
        run={"mode": "story", "frames": 4})
    found = pack.review_plan(plan)
    texts = " | ".join(f["text"] for f in found)
    assert "Story over a Loop needs a derivation" in texts
    assert "Nothing is held" in texts
    assert "Per model family" in texts
    beat = next(f for f in found if f["text"].startswith("Story over"))
    assert beat["patch"]["op"] == "add" and beat["patch"]["item"]["var"] == "beat"
    assert "frame 1 to 4" in beat["patch"]["item"]["about"]
    # Any kind of LoRA: one standing in for a rolled pick gets a swap rule…
    outfit = next(f for f in found if "$outfit_lora should replace" in f["text"])
    assert outfit["patch"]["item"]["var"] == "outfit"
    assert outfit["patch"]["item"]["name"] == "Outfit LoRA"
    # …one the template reads is fine, one nothing reads is flagged.
    assert "style_lora" not in texts
    assert "Nothing reads the input $pose_lora" in texts

    done = _plan({"model": "family"}, [
        _item(name="Character", var="character", about="random anime girls", use="hold"),
        _item(name="Outfit", var="outfit", about="outfits", use="hold"),
        _item(kind="derivation", name="Story beat", var="beat",
              about="$beat from $iteration: 1 arrives, 2 looks around"),
        _item(kind="derivation", name="Outfit LoRA", var="outfit",
              about="when $outfit_lora is set, replace $outfit with it"),
        _item(kind="derivation", name="Model quality", var="quality",
              about="from $model_variant"),
        _item(kind="template", name="T", about="$quality, $character, $outfit, $beat"),
    ], inputs=[{"var": "outfit_lora", "about": "LoRA", "example": "<lora:x:0.8>"}],
        run={"mode": "story", "frames": 4})
    texts = " | ".join(f["text"] for f in pack.review_plan(done))
    for gone in ("Story over", "Nothing is held", "outfit_lora", "Per model family",
                 "isn't set", "nothing in the pack sets"):
        assert gone not in texts


def test_sweep_axes_stay_short():
    plan = _plan({}, [
        _item(name="Pose", var="pose", about="sweep axis: poses", count=20),
        _item(kind="template", name="T", about="$pose"),
    ], run={"mode": "sweep"})
    [f] = [f for f in pack.review_plan(plan) if "sweep axis" in f["text"]]
    assert f["patch"] == {"op": "edit", "key": plan["items"][0]["key"],
                          "set": {"count": pack.MAX_SWEEP_OPTIONS}}
    plain = _plan({}, [_item(name="Pose", var="pose", about="poses"),
                       _item(kind="template", name="T", about="$pose")], run={"mode": "sweep"})
    assert any("No wildcard is marked as a sweep axis" in f["text"]
               for f in pack.review_plan(plain))


def test_story_check_plays_every_frame():
    plan = _plan({}, [
        _item(name="Place", var="place", about="places", use="hold"),
        _item(kind="derivation", name="Story beat", var="beat", about="$beat from $iteration"),
        _item(kind="template", name="T", about="$beat"),
    ], run={"mode": "story", "frames": 3})
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
