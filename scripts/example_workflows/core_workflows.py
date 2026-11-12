"""Examples 1-3: One image, Batches and grids, Pick and refine.

All three draw on the people pack family (`photo.py`).
"""

from __future__ import annotations

import json

import build
import photo
from build import (
    CLEANER,
    HELP_TIP,
    JUMP_TIP,
    LINKS_FOOTER,
    MODEL_INFO,
    OUT,
    ctx,
    loop_config,
    start_view,
)
from graph import BYPASS, Workflow, note_value, stable_uuid, view
from packs import Bundle, branch, derivation, eq, put, rule, uid_of
from photo import S

SUGGESTED = (
    ":pi-star:{#f59e0b} The lists describe people in plain words and name no style, so they "
    "work with any model. **Render** writes quality tags for Illustrious and NoobAI by default "
    "and adapts for Pony or Flux; add your style (anime, photo, painting) to the template. "
    "[Illustrious checkpoints](https://civitai.com/models?baseModels=Illustrious)"
    "{button pi-search #3b82f6}"
)
PACKS_TABLE = (
    "| Pack | What it picks |\n|---|---|\n"
    "| **Person** | age, heritage, gender, build, skin, hair, eyes, makeup |\n"
    "| **Location** | the place and the time of day |\n"
    "| **Wardrobe** | an outfit, its shoes, 0-2 accessories |\n"
    "| **Light** | a light setup that fits the place and time |\n"
    "| **Camera** | shot, angle, focus, colour palette |\n"
    "| **Direction** | pose and expression |\n"
    "| **Render** | the words your model family wants at the start and end |"
)


def _scene_bundles() -> list:
    return [photo.location(), photo.wardrobe(), photo.lighting(), photo.camera(), photo.direction()]


# ── 1 - One image ────────────────────────────────────────────────────────

lora_swaps = [
    derivation("Character LoRA", [rule("lora-char", [branch(
        eq("lora_character", "true"),
        put("subject", "$lora_hero_words"), put("hair", ""), put("facial_hair", ""),
        put("eyes", ""))])],
        desc="While the LoRA character toggle is on: its words replace $subject, and the rolled "
             "hair and eyes step aside.", scope=S),
    derivation("Its own clothes", [rule("lora-clothes", [branch(
        eq("lora_clothes", "true"),
        put("outfit", "$lora_outfit_words"), put("shoes_line", ""), put("accessories", ""))])],
        desc="While 'Use its own clothes' is on: the LoRA's outfit words replace $outfit.",
        scope=S),
    derivation("Style LoRA", [rule("lora-style", [branch(
        eq("style_lora", "true"), put("palette", ", $lora_style_words", mode="append"))])],
        desc="While the Style LoRA toggle is on: its words go after $palette.", scope=S),
]


def one_image() -> None:
    """One lane, left to right: model, who, LoRAs, prompt, image. Settings below.

    Long wires (the LoRA'd model and clip, the VAE, the four settings) run in one
    bus between the two rows, on native reroutes, then climb into the Image group.
    """
    wf = Workflow(stable_uuid("1 - One image"))
    top, low = -60, 1540  # group tops of the two rows
    ny = 360  # nodes start under the note band
    lane = 1414  # the bus between the rows (12 px a wire)
    wf.group("Model", -40, top, 640, 1460, "#4b5563")
    wf.group("Who is in the picture", 640, top, 1340, 1460, "#3f789e")
    wf.group("LoRAs and switches (optional)", 2020, top, 1900, 1460, "#7a4ea8")
    wf.group("Prompt", 3960, top, 1160, 1460, "#2f6b8f")
    wf.group("Image", 5160, top, 2120, 2320, "#2f6b4f")
    wf.group("Settings from the model (optional)", -40, low, 3580, 720, "#b06634")

    wf.add("WP_Note", (-760, 0), (620, 1040), title="Start here", widgets={"wp_note": note_value(
        "### One image, step by step\n\n"
        "Every run rolls a new picture: a person, what they wear, where they are, the light and "
        "the camera, all from the lists in the **WP Context** nodes. Nothing has to be in your "
        "library: the lists come with this workflow. Read it left to right.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        + PACKS_TABLE + "\n\n"
        "| Key | Step |\n|---|---|\n| `1` | Pick a checkpoint |\n"
        "| `2` | Who is in the picture |\n| `3` | LoRAs and switches (optional) |\n"
        "| `4` | Write the prompt |\n| `5` | Run |\n"
        "| `6` | Settings from the model (optional) |\n| `7` | The image |\n\n"
        + JUMP_TIP + "\n\n" + HELP_TIP + "\n\n"
        ":pi-lightbulb:{#22c55e} New to ComfyUI? [ComfyUI's first-image guide]"
        "(https://docs.comfy.org/tutorials/basic/text-to-image){button pi-external-link #eab308}"
        + LINKS_FOOTER, tone="icon", icon="flag",
        bookmark=start_view(-760, 620, 1040))})

    # 1 · Model
    wf.add("WP_Note", (0, 0), (560, 270), title="Pick a checkpoint", widgets={
        "wp_note": note_value(
            "Choose your model in **Load Checkpoint**. The two **LoRA** loaders under it stay "
            "bypassed (purple) until you switch them on in step 3.\n\n" + SUGGESTED,
            step=1, bookmark=view(280, 640, 0.55, "1", 1))})
    ckpt = wf.add("CheckpointLoaderSimple", (0, ny), (560, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    lora_c = wf.add("LoraLoader", (0, ny + 180), (560, 130), title="Character LoRA", mode=BYPASS)
    lora_s = wf.add("LoraLoader", (0, ny + 380), (560, 130), title="Style LoRA", mode=BYPASS)
    # Each loader reads the one above it: the wires go round, under the node above.
    for a, b, y in ((ckpt, lora_c, ny + 140), (lora_c, lora_s, ny + 340)):
        for k, (out, inp) in enumerate((("MODEL", "model"), ("CLIP", "clip"))):
            wf.link(a, out, b, inp, via=wf.route((572 + k * 12, y - 10 + k * 12),
                                                 (-12 - k * 12, y - 10 + k * 12)))

    # 2 · Who is in the picture
    wf.add("WP_Note", (680, 0), (600, 270), title="Who is in the picture", widgets={
        "wp_note": note_value(
            "Each **WP Context** holds **bundles**: packs of lists that work together. Click a "
            "header to open it.\n\n"
            "- A **list** (wildcard) picks one option and writes a `$variable`.\n"
            "- **Sub-bundles** (*Identity*, *Look*) group lists inside a bundle.\n"
            "- **Shared lists** is off on purpose: *Hair* reads its colours through `@{}`.\n"
            "- **Render** writes the words your model wants first and last.\n\n"
            "[Bundles](docs:bundles){button pi-book} [WP Context](docs:wp-context)"
            "{button pi-sitemap}",
            step=2, bookmark=view(1310, 640, 0.55, "2", 2))})
    person = ctx(wf, (680, ny), "WP Context · Person", 1, photo.render(False), photo.person(),
                 salt="one", h=420)
    wf.add("WP_Note", (1340, 0), (600, 270), title="Where, what and how", widgets={
        "wp_note": note_value(
            "| Row | What it does here |\n|---|---|\n"
            "| **constraint** | *Place → Outfit*: a beach brings swimwear, a forest a rain jacket. "
            "*Gender → Facial hair* has an **Only** rule |\n"
            "| **combine** | *Shoes line* prints `$outfit.SHOES`, the shoes rolled with the outfit |\n"
            "| **derivation** | *Framing hides details*: no shoes in a close-up, no makeup in a "
            "wide shot |\n\n"
            "[Constraints](docs:constraint){button pi-book} [Derivations](docs:derivation)"
            "{button pi-directions}", tone="icon", icon="sitemap", color="teal")})
    scene = ctx(wf, (1340, ny), "WP Context · Scene", 2, *_scene_bundles(), salt="one", h=420)
    wf.link(person, "context", scene, "upstream")

    # 3 · LoRAs and switches
    wf.add("WP_Note", (2060, 0), (600, 300), title="LoRAs and switches (optional, all off)",
           widgets={"wp_note": note_value(
               "**WP Toggles** is the switchboard for this workflow:\n\n"
               "1. Pick a LoRA in a **Load LoRA** node (step 1) and type its trigger words in "
               "the boxes below.\n"
               "2. Switch it on. The switch un-bypasses its loader *and* tells **LoRA swaps** to "
               "use the words: a character's replace `$subject` (with *Use its own clothes*, "
               "`$outfit` too), a style's go after `$palette`.\n"
               "3. *Settings from the model* switches that whole group.\n\n"
               "[WP Toggles](docs:wp-toggles){button pi-sliders-h} "
               "[Find LoRAs on Civitai](https://civitai.com/models?types=LORA)"
               "{button pi-search #3b82f6}",
               step=3, color="violet", bookmark=view(2970, 640, 0.55, "3", 3))})
    wf.add("WP_Note", (2700, 0), (560, 270), title="Words stay out of the prompt",
           widgets={"wp_note": note_value(
               "The toggles write `$lora_character`… as true / false, and the **Injector** "
               "writes the trigger words to their own variables (`$lora_hero_words`…). Neither "
               "prints by itself: only **LoRA swaps** puts the words in, while its switch is "
               "on.\n\n[Injector](docs:wp-context-injector){button pi-sign-in}",
               tone="icon", icon="sign-in", color="neutral")})
    inj = wf.add("WP_ContextInjector", (2060, ny), (600, 370),
                 title="WP Context Injector · LoRA words", widgets={"wp_rows": json.dumps({
                     "version": 1, "rows": [
                         {"_uid": f"inj{i}0000000"[:12], "kind": "socket", "slot_name": f"input_{i}",
                          "binding": b, "enabled": True, "internal": True}
                         for i, b in enumerate(("lora_hero_words", "lora_outfit_words",
                                                "lora_style_words"))]})})
    wf.link(scene, "context", inj, "upstream")
    for i, name in enumerate(("Character trigger words", "Its clothes trigger words",
                              "Style trigger words")):
        w = wf.add("PrimitiveStringMultiline", (2060, ny + 420 + i * 150), (600, 120),
                   title=name, widgets={"value": ("ohwx person", "ohwx outfit",
                                                  "watercolor style")[i]})
        wf.link(w, "STRING", inj, f"input_{i}")
    tog = wf.add("WP_Toggles", (2700, ny), (560, 300), title="WP Toggles · workflow switches",
                 widgets={"wp_toggles": json.dumps({"version": 1, "mode": "any", "group_var": "",
                     "rows": [
                         {"id": "c248fdcf", "kind": "label", "name": "LoRAs", "color": 5},
                         {"id": "75b9b8f2", "kind": "toggle", "name": "LoRA character",
                          "var": "lora_character", "on": False, "pin": False, "out": 0,
                          "style": "switch", "control": "bypass"},
                         {"id": "218efd65", "kind": "toggle", "name": "Use its own clothes",
                          "var": "lora_clothes", "on": False, "pin": False, "out": 0,
                          "style": "switch", "needs": "75b9b8f2"},
                         {"id": "c86c6752", "kind": "toggle", "name": "Style LoRA",
                          "var": "style_lora", "on": False, "pin": False, "out": 0,
                          "style": "switch", "control": "bypass"},
                         {"id": "2db72368", "kind": "label", "name": "Extras", "color": 3},
                         {"id": "1a5c7a2d", "kind": "toggle", "name": "Settings from the model",
                          "var": "model_settings", "on": True, "pin": False, "out": 0,
                          "style": "switch", "control": "bypass", "hide_var": True}]})})
    wf.link(inj, "context", tog, "upstream")
    swaps = ctx(wf, (3300, ny), "WP Context · LoRA swaps", 4,
                Bundle("LoRA swaps", "#d0508a", lora_swaps, scope=S), salt="one", h=300)
    wf.link(tog, "context", swaps, "upstream")
    # The switches' control dots read the loaders over a reroute above the lane.
    for lora, row, dy in ((lora_c, "75b9b8f2", 0), (lora_s, "c86c6752", 12)):
        wf.link(lora, "MODEL", tog, f"ctl_{row}",
                via=wf.route((600, lane + dy), (2680, lane + dy), (2680, ny + 120 + dy)))

    # 4 · Write the prompt
    wf.add("WP_Note", (4000, 0), (560, 270), title="Write the prompt", widgets={
        "wp_note": note_value(
            "Type `$` in the **Assembler** to add a variable; the preview shows the last run.\n\n"
            "`$negatives` collects the negative words picked options bring (a monochrome "
            "palette adds *colourful, saturated*). The **Cleaner** tidies the commas a list with "
            "nothing to say leaves behind.\n\n"
            "[Prompt Assembler](docs:wp-prompt-assembler){button pi-book} "
            "[Negatives](docs:negatives){button pi-minus-circle}",
            step=4, bookmark=view(4540, 640, 0.55, "4", 4))})
    asm = wf.add("WP_PromptAssembler", (4000, ny), (500, 640),
                 widgets={"template": photo.PROMPT, "negative_template": photo.NEGATIVE})
    cln = wf.add("WP_PromptCleaner", (4560, ny), (520, 520), widgets={"wp_cleaner": CLEANER})
    wf.link(swaps, "context", asm, "context")
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")
    wf.add("WP_Note", (4560, 0), (520, 270), title="See what was picked", widgets={
        "wp_note": note_value(
            "After a run, **WP Debug** (below) lists every variable, which option "
            "each list picked and any warnings. Safe to delete.\n\n"
            "[WP Debug](docs:wp-debug){button pi-search}",
            tone="icon", icon="search", color="neutral")})
    dbg = wf.add("WP_Debug", (4000, ny + 700), (1080, 320))
    wf.link(swaps, "context", dbg, "context", via=wf.route((3940, ny + 40), (3940, ny + 740)))
    wf.add("WP_Note", (680, ny + 480), (600, 160), title="Keep these lists", widgets={
        "wp_note": note_value(
            "They live in this workflow. Save them all in one step, or right-click a bundle "
            "header → **Push to library…**.\n\n"
            "[Add to my library](wp:library){button pi-download}",
            tone="icon", icon="lightbulb", color="tip")})

    # 5 · Image
    wf.add("WP_Note", (5200, 0), (560, 270), title="Run", widgets={
        "wp_note": note_value(
            "Press **Run**. Every run rolls new picks; set a Context's seed to *fixed* to "
            "repeat one, or the sampler's to keep the same noise.\n\n"
            "[Seeds & loops](docs:seeds-and-loops){button pi-refresh}",
            step=5, color="tip", bookmark=view(6220, 1100, 0.36, "5", 5))})
    pos_enc = wf.add("CLIPTextEncode", (5200, ny), (400, 160), title="Positive")
    neg_enc = wf.add("CLIPTextEncode", (5200, ny + 200), (400, 160), title="Negative")
    lat = wf.add("EmptyLatentImage", (5200, ny + 400), (400, 110),
                 widgets={"width": 832, "height": 1216, "batch_size": 1})
    ks = wf.add("KSampler", (5660, ny), (320, 280), widgets={
        "seed": 42, "control_after_generate": "randomize", "steps": 28, "cfg": 5.5,
        "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1})
    dec = wf.add("VAEDecode", (5660, ny + 320), (320, 50))
    for enc, out in ((pos_enc, "prompt"), (neg_enc, "negative")):
        wf.link(cln, out, enc, "text")
    # The model reaches the image through the (bypassed) LoRA loaders, along the lane.
    clip_bus = wf.route((620, lane + 24), (5140, lane + 24), (5140, ny + 60))
    wf.link(lora_s, "CLIP", pos_enc, "clip", via=clip_bus)
    wf.link(lora_s, "CLIP", neg_enc, "clip", via=clip_bus)
    wf.link(lora_s, "MODEL", ks, "model", via=wf.route((640, lane + 36), (5624, lane + 36),
                                                        (5624, ny + 60)))
    wf.link(ckpt, "VAE", dec, "vae", via=wf.route((600, lane + 48), (5612, lane + 48),
                                                  (5612, ny + 340)))
    wf.link(pos_enc, "CONDITIONING", ks, "positive")
    wf.link(neg_enc, "CONDITIONING", ks, "negative")
    wf.link(lat, "LATENT", ks, "latent_image")
    wf.link(ks, "LATENT", dec, "samples", via=wf.route(
        (5996, ny + 30), (5996, ny + 290), (5654, ny + 290), (5654, ny + 350)))
    wf.add("WP_Bookmark", (6040, 0), (183, 30), title="The image", widgets={
        "wp_bookmark": json.dumps({"version": 1, "color": "", "icon": "image", "hidden": False,
                                   **view(6640, 1100, 0.55, "7", 7)})})
    save = wf.add("SaveImage", (6040, 60), (1200, 2140),
                  widgets={"filename_prefix": "wp-examples/one"})
    wf.link(dec, "IMAGE", save, "images")

    # 6 · Settings from the model
    sy = low + 60
    wf.add("WP_Note", (0, sy), (560, 400), title="Settings from the model (optional)",
           widgets={"wp_note": note_value(
               "**Model Info** reads which model is loaded. It feeds the **Person** Context, so "
               "*Render* writes Pony's score tags or plain sentences for Flux, and the **Model "
               "settings** Context, which turns `$model_family` into `$size` (like "
               "`832x1216`), `$sampler` and `$cfg`. Each **Var →** node reads one into a widget "
               "of the image.\n\n"
               ":pi-sync: Switch it off in WP Toggles (or bypass **Model Info**): the **Mode "
               "Relay** tells the **Node Group**, which bypasses the rest of this group, and the "
               "latent and sampler use their own widgets again.\n\n"
               "[Model Info](docs:wp-model-info){button pi-microchip} "
               "[Mode Relay](docs:wp-mode-relay){button pi-share-alt} "
               "[Node Group](docs:wp-node-group){button pi-objects-column}",
               step=6, color="warning", bookmark=view(1740, 1920, 0.5, "6", 6))})
    minfo = wf.add("WP_ModelInfo", (680, sy), (520, 320), widgets={"wp_model_info": MODEL_INFO})
    wf.link(ckpt, "MODEL", minfo, "model", via=wf.route((620, ny + 40), (620, sy + 40)))
    out_bus = wf.route((1240, sy - 40))
    wf.link(minfo, "context", person, "upstream",
            via=wf.route((660, sy - 40), (660, ny + 40), after=out_bus))
    wf.link(minfo, "context", tog, "ctl_1a5c7a2d",
            via=wf.route((2690, sy - 40), (2690, ny + 220), after=out_bus))
    relay = wf.add("WP_ModeRelay", (680, sy + 380), (520, 180))
    wf.link(minfo, "context", relay, "node_1")
    render = ctx(wf, (1260, sy), "WP Context · Model settings", 3,
                 Bundle("Model settings", "#6b7280", [photo.render_settings], scope=S),
                 salt="one", h=260)
    wf.link(minfo, "context", render, "upstream")
    group = wf.add("WP_NodeGroup", (1260, sy + 320), (600, 280),
                   title="WP Node Group · model settings")
    wf.link(relay, "drives", group, "node_1")
    targets = (("width", lat), ("height", lat), ("cfg", ks), ("sampler_name", ks))
    for i, (kind, title, var, extra) in enumerate((
        ("WP_VarToInt", "Width", "$size", {"index": 0, "default": 832}),
        ("WP_VarToInt", "Height", "$size", {"index": 1, "default": 1216}),
        ("WP_VarToFloat", "CFG", "$cfg", {"index": 0, "default": 4.5}),
        ("WP_VarToChoice", "Sampler", "$sampler", {"match": "loose", "fallback": "euler_ancestral",
                                                   "if_no_match": "use fallback"}),
    )):
        x, y = 1920 + (i % 2) * 780, sy + (i // 2) * 300
        n = wf.add(kind, (x, y), (720, 220 if kind == "WP_VarToChoice" else 180),
                   title=title, props={"var_name": var}, widgets={"wp_var_name": var, **extra})
        wf.link(render, "context", n, "context")
        inp, tgt = targets[i]
        ly = lane + 60 + i * 12
        tx = 5172 + i * 8 if tgt is lat else 5636 + (i - 2) * 12
        ty = ny + 470 if tgt is lat else ny + 180
        wf.link(n, "choice" if kind == "WP_VarToChoice" else "value", tgt, inp,
                via=wf.route((x + 740, y + 40), (x + 740, ly), (tx, ly), (tx, ty)))
    wf.save(OUT / "1 - One image.json", (0.23, 2456, 360))


# ── 2 - Batches and grids ────────────────────────────────────────────────

SWEEP_SHOTS = ["full body", "cowboy shot", "portrait"]
SWEEP_LIGHTS = ["Rembrandt lighting", "soft window light", "backlit by the setting sun, lens flare"]


def batches_and_grids() -> None:
    """One lane: prompt per frame, quick preview, image, grid. Seed list below."""
    wf = Workflow(stable_uuid("2 - Batches and grids"))
    top, low, ny = -60, 1540, 360
    lane = 1414
    wf.group("Prompt, once per frame", -40, top, 2920, 1460, "#3f789e")
    wf.group("Quick preview", 2920, top, 1020, 1460, "#b06634")
    wf.group("Image", 3980, top, 1360, 1460, "#2f6b4f")
    wf.group("Grid", 5380, top, 1660, 1460, "#7a4ea8")
    wf.group("Optional · a new seed per frame", 3980, low, 1060, 720, "#6b7280")

    wf.add("WP_Note", (-760, 0), (620, 760), title="Start here", widgets={"wp_note": note_value(
        "### Batches and grids\n\n"
        "One **Run** makes nine images of the **same person in the same place**: three shots "
        "against three kinds of light, laid out as a labelled XY plot. A quick way to see what "
        "the framing and the light do. The lists come with this workflow. Read it left to "
        "right.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        "| Key | Step |\n|---|---|\n| `1` | Sweep every combination |\n"
        "| `2` | A prompt and a label per frame |\n| `3` | Quick preview |\n"
        "| `4` | One click, nine images |\n| `5` | The grid |\n"
        "| `6` | A new seed per frame (optional) |\n\n"
        + JUMP_TIP + "\n\n" + HELP_TIP + "\n\n"
        ":pi-images: More ways to batch: [Make variations](docs:howto-variations)"
        "{button pi-images}" + LINKS_FOOTER, tone="icon", icon="flag",
        bookmark=start_view(-760, 620, 760))})

    shot = photo.shot
    light = photo.light
    salt = "grid"
    sweep = {"enabled": True, "limit": 64, "hold_others": True, "axes": [
        {"uid": uid_of(shot, salt), "label": "Shot",
         "option_ids": [shot.option_id(v) for v in SWEEP_SHOTS]},
        {"uid": uid_of(light, salt), "label": "Light",
         "option_ids": [light.option_id(v) for v in SWEEP_LIGHTS]},
    ]}
    # 1 · Sweep
    wf.add("WP_Note", (0, 0), (1000, 250), title="Sweep every combination", widgets={
        "wp_note": note_value(
            "The **Context Loop** runs everything after it once per frame. Its **Sweep "
            "combinations** walks *Shot* (3 options) against *Light* (3): 9 frames, and **count** "
            "follows it.\n\n**Hold other picks** keeps the same person, outfit, place, pose and "
            "angle on every frame, so only the swept lists change.\n\n"
            "[Sweep combinations](docs:wp-context-loop#sweep-combinations){button pi-th-large}",
            step=1, bookmark=view(1400, 640, 0.45, "1", 1))})
    loop = wf.add("WP_ContextLoop", (0, ny), (400, 460), widgets={
        "seed": 7, "control_after_generate": "randomize", "count": 9,
        "wp_context_loop_config": loop_config(sweep=sweep)})
    wf.add("WP_Note", (1060, 0), (600, 200), title="Packs, built in", widgets={
        "wp_note": note_value(
            "**Person**, **Location**, **Wardrobe**, **Light**, **Camera**… are packs of lists "
            "stored in this workflow (grey **EXAMPLE** chip). Right-click a header → **Push to "
            "library…** to keep one.\n\n[Bundles](docs:bundles){button pi-box}",
            tone="icon", icon="box", color="teal")})
    person = ctx(wf, (460, ny), "WP Context · Person", 1, photo.render(False), photo.person(),
                 salt=salt, h=420)
    scene = ctx(wf, (1120, ny), "WP Context · Scene", 2, photo.location(), photo.wardrobe(),
                Bundle("Light", "#d4b33a", [light], scope=S),
                Bundle("Camera", "#5a7fc9", [photo.shot, photo.angle, photo.shot_lens_rule,
                                             photo.lens, photo.film, photo.framing_rule],
                       scope=S),
                photo.direction(), salt=salt, h=420)
    wf.link(loop, "context", person, "upstream")
    wf.link(person, "context", scene, "upstream")
    # 2 · Prompt and label
    wf.add("WP_Note", (1780, 0), (1060, 200), title="A prompt and a label per frame", widgets={
        "wp_note": note_value(
            "The **Assembler** writes the prompt and the **Cleaner** tidies it. The second "
            "Assembler, under the Cleaner, writes the label `$shot · $light`: **Label & Grid** "
            "reads its two parts as the grid's rows and columns.\n\n"
            "[Prompt Assembler](docs:wp-prompt-assembler){button pi-book}",
            step=2, bookmark=view(2300, 640, 0.6, "2", 2))})
    asm = wf.add("WP_PromptAssembler", (1780, ny), (500, 640),
                 widgets={"template": photo.PROMPT, "negative_template": photo.NEGATIVE})
    cln = wf.add("WP_PromptCleaner", (2340, ny), (500, 520), widgets={"wp_cleaner": CLEANER})
    lab = wf.add("WP_PromptAssembler", (2340, ny + 560), (500, 470),
                 title="WP Prompt Assembler · grid labels",
                 widgets={"template": "$shot · $light", "negative_template": ""})
    wf.link(scene, "context", asm, "context")
    wf.link(scene, "context", lab, "context", via=wf.route((1740, ny + 40), (1740, ny + 600)))
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")

    # 3 · Quick preview
    wf.add("WP_Note", (2960, 0), (940, 330), title="Quick preview", widgets={
        "wp_note": note_value(
            "**WP Toggles** in *Pick one* mode: pick **Quick** for a fast, rough pass of the whole "
            "grid, **Full** for the real thing.\n\n"
            "- The pick's value goes to `$steps`; **Var → Int** hands it to the sampler.\n"
            "- Each choice also has its own switch: **Var → Bool** reads "
            "`$quick_preview.bool` (on or off; `$quick_preview` itself holds the value) and "
            "the **If/Else Switch** picks the smaller latent.\n\n"
            "[WP Toggles](docs:wp-toggles){button pi-sliders-h} "
            "[Var → Bool](docs:wp-var-to-bool){button pi-check-square}",
            step=3, color="warning", bookmark=view(3440, 640, 0.6, "3", 3))})
    tog = wf.add("WP_Toggles", (2960, ny), (460, 150), title="WP Toggles · steps", widgets={
        "wp_toggles": json.dumps({"version": 1, "mode": "one", "group_var": "steps",
            "group_upstream": True, "rows": [
                {"id": "996c84f0", "kind": "toggle", "name": "Quick", "var": "quick_preview",
                 "on": False, "pin": False, "out": 0, "style": "chip", "value": "12"},
                {"id": "51ce16e1", "kind": "toggle", "name": "Full", "var": "full_render",
                 "on": True, "pin": False, "out": 0, "style": "chip", "value": "30"}]})})
    steps = wf.add("WP_VarToInt", (2960, ny + 220), (460, 180), title="Steps",
                   props={"var_name": "$steps"},
                   widgets={"wp_var_name": "$steps", "index": 0, "default": 30})
    quick = wf.add("WP_VarToBool", (2960, ny + 460), (460, 180), title="Quick preview?",
                   props={"var_name": "$quick_preview.bool"},
                   widgets={"wp_var_name": "$quick_preview.bool", "index": 0, "default": False})
    small = wf.add("EmptyLatentImage", (3480, ny), (420, 110), title="Quick size",
                   widgets={"width": 512, "height": 768, "batch_size": 1})
    full = wf.add("EmptyLatentImage", (3480, ny + 170), (420, 110), title="Full size",
                  widgets={"width": 832, "height": 1216, "batch_size": 1})
    switch = wf.add("ComfySwitchNode", (3480, ny + 460), (420, 80), title="Latent")
    wf.link(tog, "context", steps, "context")
    wf.link(tog, "context", quick, "context", via=wf.route((2940, ny + 40), (2940, ny + 500)))
    wf.link(full, "LATENT", switch, "on_false")
    wf.link(small, "LATENT", switch, "on_true")
    wf.link(quick, "value", switch, "switch")

    # 4 · Image
    wf.add("WP_Note", (4020, 0), (1280, 230), title="One click, nine images", widgets={
        "wp_note": note_value(
            "Pick your model in **Load Checkpoint** and press **Run** once. The sampler seed is "
            "**fixed**, so only the prompt changes between cells: a fair comparison.\n\n"
            + SUGGESTED + "\n\n[Seeds & loops](docs:seeds-and-loops){button pi-refresh}",
            step=4, bookmark=view(4660, 640, 0.6, "4", 4))})
    ckpt = wf.add("CheckpointLoaderSimple", (4020, ny), (420, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    pos_enc = wf.add("CLIPTextEncode", (4500, ny), (400, 160), title="Positive")
    neg_enc = wf.add("CLIPTextEncode", (4500, ny + 200), (400, 160), title="Negative")
    ks = wf.add("KSampler", (4960, ny), (320, 280), widgets={
        "seed": 42, "control_after_generate": "fixed", "steps": 28, "cfg": 5.5,
        "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1})
    dec = wf.add("VAEDecode", (4960, ny + 340), (320, 50))
    for enc, out, dy in ((pos_enc, "prompt", 0), (neg_enc, "negative", 12)):
        wf.link(ckpt, "CLIP", enc, "clip", via=wf.route((4460, ny + 30), (4460, ny + 60 + dy)))
        k = 36 + dy
        wf.link(cln, out, enc, "text", via=wf.route(
            (2894 + dy, ny + 40 + dy), (2894 + dy, lane + k), (4476 + dy, lane + k),
            (4476 + dy, ny + 100 + dy)))
    wf.link(ckpt, "MODEL", ks, "model", via=wf.route((4470, ny - 24), (4908, ny - 24),
                                                     (4908, ny + 40)))
    wf.link(ckpt, "VAE", dec, "vae", via=wf.route((4480, ny - 36), (4918, ny - 36),
                                                  (4918, ny + 370)))
    wf.link(pos_enc, "CONDITIONING", ks, "positive")
    wf.link(neg_enc, "CONDITIONING", ks, "negative")
    wf.link(ks, "LATENT", dec, "samples", via=wf.route(
        (5296, ny + 30), (5296, ny + 310), (4954, ny + 310), (4954, ny + 370)))
    wf.link(switch, "output", ks, "latent_image", via=wf.route((3940, ny + 680), (4928, ny + 680),
                                                               (4928, ny + 80)))
    wf.link(steps, "value", ks, "steps", via=wf.route((3440, ny + 700), (4938, ny + 700),
                                                      (4938, ny + 150)))

    # 5 · Grid
    wf.add("WP_Note", (5420, 0), (1580, 230), title="The grid", widgets={
        "wp_note": note_value(
            "**Label & Grid** has two outputs: `images` (each one with its label) and `grid` "
            "(one sheet, saved here). Rows come from label part 1, columns from part 2.\n\n"
            ":pi-image: Want the images with no labels? Wire **VAE Decode** straight into a "
            "**Save Image**.\n\n[WP Label & Grid](docs:wp-label-grid){button pi-th-large}",
            tone="icon", icon="th-large", color="info", bookmark=view(6220, 760, 0.5, "5", 5))})
    grid = wf.add("WP_LabelGrid", (5420, ny), (520, 490), widgets={"wp_label_grid": json.dumps({
        "label": "", "position": "none", "align": "center", "font": "default", "font_size": 0,
        "text_color": "#ffffff", "label_color": "#000000", "grid": True, "arrange": "auto",
        "columns": 0, "rows_from": "part:1", "row_headers": "", "columns_from": "part:2",
        "column_headers": "", "title": "Same person and place: three shots × three lights",
        "gap": 8, "margin": 16, "background": "#ffffff", "header_color": "#000000",
        "cell_width": 512})})
    save = wf.add("SaveImage", (6000, ny), (1000, 1040),
                  widgets={"filename_prefix": "wp-examples/grid"})
    wf.link(dec, "IMAGE", grid, "images", via=wf.route((5320, ny + 380), (5380, ny + 380),
                                                       (5380, ny + 40)))
    wf.link(lab, "prompt", grid, "labels", via=wf.route((2880, ny + 590), (2880, lane),
                                                        (5392, lane), (5392, ny + 60)))
    wf.link(grid, "grid", save, "images")

    # 6 · Seed list
    sy = low + 60
    wf.add("WP_Note", (4020, sy), (980, 160), title="A new seed per frame (optional)", widgets={
        "wp_note": note_value(
            "Un-bypass the **Seed List** (select it, Ctrl+B) to give every frame its own sampler "
            "seed. It follows the Loop's frame count through `loop_config`. Bypassed, the "
            "sampler's fixed seed is used.\n\n[WP Seed List](docs:wp-seed-list){button pi-list}",
            step=6, color="neutral", bookmark=view(4510, 1900, 0.6, "6", 6))})
    seeds = wf.add("WP_SeedList", (4020, sy + 240), (460, 370), mode=BYPASS, widgets={
        "base_seed": 42, "control_after_generate": "randomize", "count": 9})
    wf.link(loop, "loop_config", seeds, "loop_config",
            via=wf.route((430, ny + 60), (430, lane + 12), (3990, lane + 12), (3990, sy + 280)))
    wf.link(seeds, "seed", ks, "seed", via=wf.route((4520, sy + 280), (4520, lane + 24),
                                                    (4948, lane + 24), (4948, ny + 120)))
    wf.save(OUT / "2 - Batches and grids.json", (0.22, 2540, 380))


# ── 3 - Pick and refine ──────────────────────────────────────────────────


def pick_and_refine() -> None:
    """One lane: four looks, drafts, pick, refine."""
    wf = Workflow(stable_uuid("3 - Pick and refine"))
    top, ny, lane = -60, 360, 1414
    wf.group("Four looks", -40, top, 2920, 1460, "#3f789e")
    wf.group("Drafts", 2920, top, 1340, 1460, "#2f6b4f")
    wf.group("Pick", 4340, top, 1160, 1460, "#7a4ea8")
    wf.group("Refine the picks", 5540, top, 1980, 1460, "#b06634")

    wf.add("WP_Note", (-760, 0), (620, 760), title="Start here", widgets={"wp_note": note_value(
        "### Pick and refine\n\n"
        "A fashion shoot: **one person** in four different looks and places. The run **pauses** "
        "so you can pick the keepers (and fix a prompt or paint a mask), then refines only "
        "those. The lists come with this workflow. Read it left to right.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        "| Key | Step |\n|---|---|\n| `1` | Four looks |\n| `2` | Quick drafts |\n"
        "| `3` | Pick the keepers |\n| `4` | Refine only the picks |\n"
        "| `5` | The picks, refined |\n\n"
        + JUMP_TIP + "\n\n" + HELP_TIP + LINKS_FOOTER,
        tone="icon", icon="flag", bookmark=start_view(-760, 620, 760))})
    salt = "pick"
    # 1 · Four looks
    wf.add("WP_Note", (0, 0), (1720, 280), title="Four looks", widgets={"wp_note": note_value(
        "The **Context Loop** runs everything after it 4 times. The **Person** rows have **Hold "
        "across run** on (the pin icon), so all four frames show the same person; outfit, place, "
        "light and camera roll per frame. Change **count** for more looks.\n\n"
        "[WP Context Loop](docs:wp-context-loop){button pi-book} "
        "[Keep something the same](docs:howto-keep-steady){button pi-lock}",
        step=1, bookmark=view(1400, 640, 0.45, "1", 1))})
    loop = wf.add("WP_ContextLoop", (0, ny), (400, 460), widgets={
        "seed": 5, "control_after_generate": "randomize", "count": 4,
        "wp_context_loop_config": loop_config()})
    person = ctx(wf, (460, ny), "WP Context · Person (held)", 1, photo.render(False),
                 photo.person(hold=True), salt=salt, h=420)
    scene = ctx(wf, (1120, ny), "WP Context · The look", 2, *_scene_bundles(), salt=salt, h=420)
    wf.link(loop, "context", person, "upstream")
    wf.link(person, "context", scene, "upstream")
    wf.add("WP_Note", (1780, 0), (1060, 200), title="A prompt and a label per look", widgets={
        "wp_note": note_value(
            "The **Assembler** writes the prompt, the **Cleaner** tidies it. The labels "
            "Assembler under it writes `$outfit`: it rides through the Image Filter on "
            "`extra_1`, so the contact sheet names each pick's look.\n\n"
            "[Prompt Assembler](docs:wp-prompt-assembler){button pi-book}",
            tone="icon", icon="pencil", color="teal")})
    asm = wf.add("WP_PromptAssembler", (1780, ny), (500, 640),
                 widgets={"template": photo.PROMPT, "negative_template": photo.NEGATIVE})
    cln = wf.add("WP_PromptCleaner", (2340, ny), (500, 520), widgets={"wp_cleaner": CLEANER})
    lab = wf.add("WP_PromptAssembler", (2340, ny + 560), (500, 470),
                 title="WP Prompt Assembler · labels",
                 widgets={"template": "$outfit", "negative_template": ""})
    wf.link(scene, "context", asm, "context")
    wf.link(scene, "context", lab, "context", via=wf.route((1740, ny + 40), (1740, ny + 600)))
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")

    # 2 · Drafts
    wf.add("WP_Note", (2960, 0), (1260, 280), title="Quick drafts", widgets={"wp_note": note_value(
        "Pick your model in **Load Checkpoint** and press **Run**. The **Seed List** gives each "
        "frame its own sampler seed, following the Loop through `loop_config`.\n\n" + SUGGESTED
        + "\n\n[WP Seed List](docs:wp-seed-list){button pi-book}",
        step=2, bookmark=view(3600, 640, 0.6, "2", 2))})
    ckpt = wf.add("CheckpointLoaderSimple", (2960, ny), (420, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    seeds = wf.add("WP_SeedList", (2960, ny + 160), (420, 390), widgets={
        "base_seed": 5, "control_after_generate": "randomize", "count": 4})
    wf.link(loop, "loop_config", seeds, "loop_config",
            via=wf.route((430, ny + 60), (430, lane), (2940, lane), (2940, ny + 200)))
    pos_enc = wf.add("CLIPTextEncode", (3440, ny), (400, 160), title="Positive")
    neg_enc = wf.add("CLIPTextEncode", (3440, ny + 200), (400, 160), title="Negative")
    lat = wf.add("EmptyLatentImage", (3440, ny + 400), (400, 110),
                 widgets={"width": 832, "height": 1216, "batch_size": 1})
    ks = wf.add("KSampler", (3900, ny), (320, 280), widgets={
        "seed": 5, "control_after_generate": "randomize", "steps": 20, "cfg": 5.5,
        "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1})
    dec = wf.add("VAEDecode", (3900, ny + 340), (320, 50))
    for enc, out, dy in ((pos_enc, "prompt", 0), (neg_enc, "negative", 12)):
        wf.link(ckpt, "CLIP", enc, "clip", via=wf.route((3404, ny + 30), (3404, ny + 60 + dy)))
        wf.link(cln, out, enc, "text", via=wf.route(
            (2884 + dy, ny + 40 + dy), (2884 + dy, lane + 12 + dy), (3416 + dy, lane + 12 + dy),
            (3416 + dy, ny + 100 + dy)))
    model_bus = wf.route((3410, ny - 24))
    vae_bus = wf.route((3420, ny - 36))
    wf.link(ckpt, "MODEL", ks, "model", via=wf.route((3864, ny - 24), (3864, ny + 40),
                                                     after=model_bus))
    wf.link(ckpt, "VAE", dec, "vae", via=wf.route((3876, ny - 36), (3876, ny + 370),
                                                  after=vae_bus))
    wf.link(pos_enc, "CONDITIONING", ks, "positive")
    wf.link(neg_enc, "CONDITIONING", ks, "negative")
    wf.link(lat, "LATENT", ks, "latent_image")
    wf.link(seeds, "seed", ks, "seed", via=wf.route((3400, ny + 200), (3400, ny + 580),
                                                    (3888, ny + 580), (3888, ny + 150)))
    wf.link(ks, "LATENT", dec, "samples", via=wf.route(
        (4236, ny + 30), (4236, ny + 310), (3894, ny + 310), (3894, ny + 370)))

    # 3 · Pick
    wf.add("WP_Note", (4380, 0), (520, 300), title="Pick the keepers", widgets={
        "wp_note": note_value(
            "The run **pauses** at the **Image Filter**: click the drafts you like, then "
            "**Continue**. Every output keeps only the picks: `latent` and `positive` / "
            "`negative` feed the refine pass, `extra_1` the labels.\n\n"
            "You can fix a prompt or paint a mask there too. With `clip` wired, an edited prompt "
            "is encoded again.\n\n[WP Image Filter](docs:wp-image-filter){button pi-book}",
            step=3, color="violet", bookmark=view(4920, 640, 0.6, "3", 3))})
    filt = wf.add("WP_ImageFilter", (4380, ny), (500, 430), widgets={"wp_image_filter": json.dumps(
        {"mode": "pause", "send_as": "same_shape", "timeout": 600, "on_timeout": "keep_all"},
        separators=(",", ":"))})
    wf.link(dec, "IMAGE", filt, "images", via=wf.route((4250, ny + 370), (4250, ny + 30)))
    wf.link(ks, "LATENT", filt, "latent", via=wf.route((4262, ny + 30), (4262, ny + 44)))
    # The conditioning goes over the sampler, the text and context along the lane.
    for i, (src, out, inp) in enumerate(((pos_enc, "CONDITIONING", "positive"),
                                         (neg_enc, "CONDITIONING", "negative"))):
        y = ny - 60 - i * 12
        wf.link(src, out, filt, inp, via=wf.route((3852 + i * 8, ny + 30 + i * 200),
                                                  (3852 + i * 8, y), (4274 + i * 12, y),
                                                  (4274 + i * 12, ny + 60 + i * 12)))
    for i, (src, out, inp) in enumerate(((cln, "prompt", "positive_text"),
                                         (cln, "negative", "negative_text"),
                                         (scene, "context", "context"),
                                         (lab, "prompt", "extra_1"))):
        x0 = (2848, 2860, 1752, 2872)[i]
        y0 = (ny + 30, ny + 50, ny + 40, ny + 580)[i]
        y = lane + 36 + i * 12
        wf.link(src, out, filt, inp, via=wf.route((x0, y0), (x0, y), (4298 + i * 12, y),
                                                  (4298 + i * 12, ny + 90 + i * 30)))
    wf.link(ckpt, "CLIP", filt, "clip", via=wf.route((4346, ny - 48), (4346, ny + 360),
                                                     after=wf.route((3430, ny - 48))))
    wf.add("WP_Note", (4940, 0), (520, 230), title="A contact sheet of the picks", widgets={
        "wp_note": note_value(
            "**Label & Grid** shows the picks on one sheet, each under its look (the labels "
            "Assembler's `$outfit`, kept to the picks by the filter's `extra_1`). For the picks "
            "without labels, wire the filter's `images` straight into a **Save Image**.\n\n"
            "[WP Label & Grid](docs:wp-label-grid){button pi-book}",
            tone="icon", icon="th-large", color="info")})
    grid = wf.add("WP_LabelGrid", (4940, ny), (520, 490), widgets={"wp_label_grid": json.dumps({
        "label": "{label}", "position": "top", "align": "center", "font": "default",
        "font_size": 0, "text_color": "#ffffff", "label_color": "#000000", "grid": True,
        "arrange": "auto", "columns": 0, "rows_from": "none", "row_headers": "",
        "columns_from": "none", "column_headers": "", "title": "", "gap": 8, "margin": 0,
        "background": "#ffffff", "header_color": "#000000", "cell_width": 0},
        separators=(",", ":"))})
    wf.link(filt, "images", grid, "images")
    wf.link(filt, "extra_1", grid, "labels")

    # 4 · Refine
    wf.add("WP_Note", (5580, 0), (920, 200), title="Refine only the picks", widgets={
        "wp_note": note_value(
            "A second pass upscales the picked latents by 1.5 and samples them again at half "
            "denoise. The drafts you skipped never reach it.",
            step=4, color="tip", bookmark=view(6540, 640, 0.45, "4", 4))})
    up = wf.add("LatentUpscaleBy", (5580, ny + 120), (320, 90),
                widgets={"upscale_method": "nearest-exact", "scale_by": 1.5})
    ks2 = wf.add("KSampler", (5960, ny), (320, 280), title="KSampler · refine", widgets={
        "seed": 5, "control_after_generate": "fixed", "steps": 20, "cfg": 5.5,
        "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 0.5})
    dec2 = wf.add("VAEDecode", (6340, ny), (220, 50))
    wf.link(filt, "latent", up, "samples",
            via=wf.route((4904, ny + 44), (4904, ny - 108), (5550, ny - 108), (5550, ny + 160)))
    wf.link(ckpt, "MODEL", ks2, "model", via=wf.route((5930, ny - 24), (5930, ny + 40),
                                                      after=model_bus))
    for i, k in enumerate(("positive", "negative")):
        wf.link(filt, k, ks2, k, via=wf.route((4912 + i * 8, ny + 60 + i * 12),
                                              (4912 + i * 8, ny - 84 - i * 12),
                                              (5918 + i * 8, ny - 84 - i * 12),
                                              (5918 + i * 8, ny + 60 + i * 12)))
    wf.link(up, "LATENT", ks2, "latent_image")
    wf.link(ks2, "LATENT", dec2, "samples")
    wf.link(ckpt, "VAE", dec2, "vae", via=wf.route((6310, ny - 36), (6310, ny + 50),
                                                   after=vae_bus))
    wf.add("WP_Bookmark", (6620, 0), (183, 30), title="The picks, refined", widgets={
        "wp_bookmark": json.dumps({"version": 1, "color": "", "icon": "image", "hidden": False,
                                   **view(7060, 700, 0.6, "5", 5)})})
    save = wf.add("SaveImage", (6620, 60), (860, 1300),
                  widgets={"filename_prefix": "wp-examples/picked"})
    wf.link(dec2, "IMAGE", save, "images")
    wf.save(OUT / "3 - Pick and refine.json", (0.24, 2200, 360))


def build_all() -> None:
    one_image()
    batches_and_grids()
    pick_and_refine()
    build.sets_and_stories()
