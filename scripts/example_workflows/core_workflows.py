"""Examples 1-3: One image, Batches and grids, Pick and refine.

All three draw on the photo pack family (`photo.py`).
"""

from __future__ import annotations

import json

import build
import photo
from build import CLEANER, LINKS_FOOTER, MODEL_INFO, OUT, ctx, loop_config
from graph import BYPASS, Workflow, note_value, stable_uuid, view
from packs import Bundle, branch, derivation, eq, put, rule, uid_of
from photo import S

SUGGESTED = (
    ":pi-star:{#f59e0b} Made for realistic SDXL checkpoints: "
    "[Juggernaut XL](https://civitai.com/models/133005/juggernaut-xl){button pi-download #3b82f6} "
    "[RealVisXL](https://civitai.com/models/139562/realvisxl-v50){button pi-download #3b82f6} "
    "[epiCRealism XL](https://civitai.com/models/277058/epicrealism-xl){button pi-download #3b82f6}"
)
PACKS_TABLE = (
    "| Pack | What it picks |\n|---|---|\n"
    "| **Person** | age, heritage, gender, build, skin, hair, eyes, makeup |\n"
    "| **Location** | the place and the time of day |\n"
    "| **Wardrobe** | an outfit, its shoes, 0-2 accessories |\n"
    "| **Light** | a light setup that fits the place and time |\n"
    "| **Camera** | shot, angle, lens, film look |\n"
    "| **Direction** | pose and expression |\n"
    "| **Render** | the words your model family wants at the start and end |"
)


def _scene_bundles() -> list:
    return [photo.location(), photo.wardrobe(), photo.lighting(), photo.camera(), photo.direction()]


def _image_chain(wf: Workflow, x: float, y: float, ckpt: dict, cln: dict, *, mode: int = 0,
                 seed: int = 42, control: str = "randomize") -> dict:
    """Encode both prompts, sample, decode. Returns the VAE Decode node."""
    pos = wf.add("CLIPTextEncode", (x, y), (400, 160), title="Positive", mode=mode)
    neg = wf.add("CLIPTextEncode", (x, y + 200), (400, 160), title="Negative", mode=mode)
    for enc, out in ((pos, "prompt"), (neg, "negative")):
        wf.link(ckpt, "CLIP", enc, "clip")
        wf.link(cln, out, enc, "text")
    ks = wf.add("KSampler", (x + 460, y), (300, 280), mode=mode, widgets={
        "seed": seed, "control_after_generate": control, "steps": 30, "cfg": 4.5,
        "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1})
    dec = wf.add("VAEDecode", (x + 820, y), (200, 50), mode=mode)
    wf.link(ckpt, "MODEL", ks, "model")
    wf.link(pos, "CONDITIONING", ks, "positive")
    wf.link(neg, "CONDITIONING", ks, "negative")
    wf.link(ks, "LATENT", dec, "samples")
    wf.link(ckpt, "VAE", dec, "vae")
    wf._last = {"pos": pos, "neg": neg, "ks": ks}  # type: ignore[attr-defined]
    return dec


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
        eq("style_lora", "true"), put("film", ", $lora_style_words", mode="append"))])],
        desc="While the Style LoRA toggle is on: its words go after $film.", scope=S),
]


def one_image() -> None:
    wf = Workflow(stable_uuid("1 - One image"))
    wf.group("Prompt", -40, -60, 2600, 1280, "#3f789e")
    wf.group("Image", 2600, -60, 2440, 1280, "#2f6b4f")
    wf.group("LoRAs and switches (optional)", -40, 1260, 2600, 1100, "#7a4ea8")
    wf.group("Settings from the model (optional)", 2600, 1260, 2440, 1100, "#b06634")

    wf.add("WP_Note", (-760, 0), (620, 1080), title="Start here", widgets={"wp_note": note_value(
        "### One image, step by step\n\n"
        "Every run rolls a new photo: a person, what they wear, where they are, the light and "
        "the camera, all from the lists in the **WP Context** nodes. Nothing has to be in your "
        "library: the lists come with this workflow.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        + PACKS_TABLE + "\n\n"
        "| Key | Step |\n|---|---|\n| `Alt+1` | Who is in the picture |\n"
        "| `Alt+2` | Write the prompt |\n| `Alt+3` | Pick a checkpoint and run |\n"
        "| `Alt+4` | LoRAs and switches (optional) |\n"
        "| `Alt+5` | Settings from the model (optional) |\n| `Alt+6` | The image |\n\n"
        ":pi-bookmark: Jump with the keys or the **Bookmarks** dock (top bar).\n\n"
        ":pi-lightbulb:{#22c55e} New to ComfyUI? [ComfyUI's first-image guide]"
        "(https://docs.comfy.org/tutorials/basic/text-to-image){button pi-external-link #eab308}"
        + LINKS_FOOTER, tone="icon", icon="flag")})

    # Prompt group
    wf.add("WP_Note", (0, 0), (520, 270), title="Who is in the picture", widgets={
        "wp_note": note_value(
            "Each **WP Context** holds **bundles**: packs of lists that work together. Click a "
            "header to open it.\n\n"
            "- A **list** (wildcard) picks one option and writes a `$variable`.\n"
            "- **Sub-bundles** (*Identity*, *Look*) group lists inside a bundle.\n"
            "- **Shared lists** is off on purpose: *Hair* reads its colours through `@{}`.\n"
            "- **Render** writes the words your model wants first and last.\n\n"
            "[Bundles](docs:bundles){button pi-book} [WP Context](docs:wp-context)"
            "{button pi-sitemap}",
            step=1, bookmark=view(1260, 580, 0.42, "Alt+1", 1))})
    person = ctx(wf, (0, 300), "WP Context · Person", 1, photo.render(False), photo.person(),
                 salt="one", h=640)
    wf.add("WP_Note", (640, 0), (560, 270), title="Where, what and how", widgets={
        "wp_note": note_value(
            "| Row | What it does here |\n|---|---|\n"
            "| **constraint** | *Place → Outfit*: a beach brings swimwear, a forest a rain jacket. "
            "*Gender → Facial hair* has an **Only** rule |\n"
            "| **combine** | *Shoes line* prints `$outfit.SHOES`, the shoes rolled with the outfit |\n"
            "| **derivation** | *Framing hides details*: no shoes in a close-up, no makeup in a "
            "wide shot |\n\n"
            "[Constraints](docs:constraint){button pi-book} [Derivations](docs:derivation)"
            "{button pi-directions}", tone="icon", icon="sitemap", color="teal")})
    scene = ctx(wf, (640, 300), "WP Context · Scene", 2, *_scene_bundles(), salt="one", h=640)
    wf.link(person, "context", scene, "upstream")

    wf.add("WP_Note", (1280, 0), (520, 270), title="Write the prompt", widgets={
        "wp_note": note_value(
            "Type `$` in the **Assembler** to add a variable; the preview shows the last run.\n\n"
            "`$negatives` collects the negative words picked options bring (black-and-white film "
            "adds *colour, saturated*). The **Cleaner** tidies the commas a list with nothing to "
            "say leaves behind.\n\n"
            "[Prompt Assembler](docs:wp-prompt-assembler){button pi-book} "
            "[Negatives](docs:negatives){button pi-minus-circle}",
            step=2, bookmark=view(1260, 580, 0.42, "Alt+2", 2))})
    asm = wf.add("WP_PromptAssembler", (1280, 300), (500, 460),
                 widgets={"template": photo.PROMPT, "negative_template": photo.NEGATIVE})
    cln = wf.add("WP_PromptCleaner", (1840, 300), (500, 480), widgets={"wp_cleaner": CLEANER})
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")
    dbg = wf.add("WP_Debug", (1280, 820), (500, 380))
    wf.add("WP_Note", (1840, 0), (500, 240), title="See what was picked", widgets={
        "wp_note": note_value(
            "After a run, **WP Debug** lists every variable, which option each list picked and "
            "any warnings. Safe to delete.\n\n[WP Debug](docs:wp-debug){button pi-search}",
            tone="icon", icon="search", color="neutral")})
    wf.add("WP_Note", (1840, 840), (500, 240), title="Keep these lists", widgets={
        "wp_note": note_value(
            "They live in this workflow. Save them all in one step (you review the list first), "
            "or right-click a bundle header → **Push to library…**.\n\n"
            "[Add to my library](wp:library){button pi-download}",
            tone="icon", icon="lightbulb", color="tip")})

    # Image group
    wf.add("WP_Note", (2640, 0), (560, 270), title="Pick a checkpoint and run", widgets={
        "wp_note": note_value(
            "Choose your model in **Load Checkpoint**, then press **Run**. Every run rolls new "
            "picks; set a Context's seed to *fixed* to repeat one.\n\n" + SUGGESTED
            + "\n\n[Seeds & loops](docs:seeds-and-loops){button pi-refresh}",
            step=3, bookmark=view(3820, 580, 0.42, "Alt+3", 3))})
    ckpt = wf.add("CheckpointLoaderSimple", (2640, 320), (380, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    lat = wf.add("EmptyLatentImage", (2640, 760), (300, 110),
                 widgets={"width": 832, "height": 1216, "batch_size": 1})
    dec = _image_chain(wf, 3060, 320, ckpt, cln)
    ks = wf._last["ks"]  # type: ignore[attr-defined]
    pos_enc, neg_enc = wf._last["pos"], wf._last["neg"]  # type: ignore[attr-defined]
    wf.link(lat, "LATENT", ks, "latent_image")
    wf.add("WP_Bookmark", (4400, 0), (183, 30), title="The image", widgets={
        "wp_bookmark": json.dumps({"version": 1, "color": "", "icon": "image", "hidden": False,
                                   **view(4660, 640, 0.9, "Alt+6", 6)})})
    save = wf.add("SaveImage", (4400, 80), (600, 1080), widgets={"filename_prefix": "wp-examples/one"})
    wf.link(dec, "IMAGE", save, "images")

    # LoRA group
    wf.add("WP_Note", (0, 1320), (580, 520), title="LoRAs and switches (optional, all off)",
           widgets={"wp_note": note_value(
               "**WP Toggles** is the switchboard for this workflow:\n\n"
               "1. Pick a LoRA in a **Load LoRA** node and type its trigger words in the boxes.\n"
               "2. Switch it on. The switch un-bypasses its loader *and* tells the **LoRA swaps** "
               "bundle to use the words: a character's replace `$subject` (and, with *Use its own "
               "clothes*, `$outfit`), a style's go after `$film`.\n"
               "3. *Settings from the model* switches that whole group.\n\n"
               "> The toggles write `$lora_character`… as true / false; the **Injector** writes "
               "the words to their own variables (`$lora_hero_words`…), so a switch never "
               "prints.\n\n"
               "[WP Toggles](docs:wp-toggles){button pi-sliders-h} "
               "[Injector](docs:wp-context-injector){button pi-sign-in}\n\n"
               "[Find LoRAs on Civitai](https://civitai.com/models?types=LORA)"
               "{button pi-search #3b82f6}",
               tone="icon", icon="sliders-h", color="violet",
               bookmark=view(1260, 1800, 0.42, "Alt+4", 4))})
    words = []
    for i, name in enumerate(("Character trigger words", "Its clothes trigger words",
                              "Style trigger words")):
        words.append(wf.add("PrimitiveStringMultiline", (0, 1880 + i * 150), (560, 120),
                            title=name, widgets={"value": ("ohwx person", "ohwx outfit",
                                                           "film still style")[i]}))
    inj = wf.add("WP_ContextInjector", (620, 1320), (570, 320),
                 title="WP Context Injector · LoRA words", widgets={"wp_rows": json.dumps({
                     "version": 1, "rows": [
                         {"_uid": f"inj{i}0000000"[:12], "kind": "socket", "slot_name": f"input_{i}",
                          "binding": b, "enabled": True, "internal": True}
                         for i, b in enumerate(("lora_hero_words", "lora_outfit_words",
                                                "lora_style_words"))]})})
    wf.link(scene, "context", inj, "upstream")
    for i, w in enumerate(words):
        wf.link(w, "STRING", inj, f"input_{i}")
    tog = wf.add("WP_Toggles", (620, 1700), (560, 320), title="WP Toggles · workflow switches",
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
    swaps = ctx(wf, (1240, 1320), "WP Context · LoRA swaps", 4,
                Bundle("LoRA swaps", "#d0508a", lora_swaps, scope=S), salt="one", h=420)
    wf.link(tog, "context", swaps, "upstream")
    wf.link(swaps, "context", asm, "context")
    wf.link(swaps, "context", dbg, "context")
    lora_c = wf.add("LoraLoader", (1860, 1320), (340, 130), title="Character LoRA", mode=BYPASS)
    lora_s = wf.add("LoraLoader", (1860, 1500), (340, 130), title="Style LoRA", mode=BYPASS)
    wf.link(ckpt, "MODEL", lora_c, "model")
    wf.link(ckpt, "CLIP", lora_c, "clip")
    wf.link(lora_c, "MODEL", lora_s, "model")
    wf.link(lora_c, "CLIP", lora_s, "clip")
    # The sampler and encoders read the model through the (bypassed) LoRA loaders.
    for n, inp in ((ks, "model"),):
        _relink(wf, n, inp, lora_s, "MODEL")
    for enc in (pos_enc, neg_enc):
        _relink(wf, enc, "clip", lora_s, "CLIP")
    wf.link(lora_c, "MODEL", tog, "ctl_75b9b8f2")
    wf.link(lora_s, "MODEL", tog, "ctl_c86c6752")

    # Settings group
    wf.add("WP_Note", (2640, 1320), (560, 400), title="Settings from the model (optional)",
           widgets={"wp_note": note_value(
               "**Model Info** reads which model is loaded. It feeds the **Person** Context, so "
               "*Render* writes Pony's score tags or plain sentences for Flux, and the **Model "
               "settings** Context here, which turns `$model_family` into `$size` (like "
               "`832x1216`), `$sampler` and `$cfg`. Each **Var →** node reads one into a widget.\n\n"
               ":pi-sync: Switch it off in WP Toggles (or bypass **Model Info**): the **Mode "
               "Relay** tells the **Node Group**, which bypasses the rest of this group, and the "
               "latent and sampler use their own widgets again.\n\n"
               "[Model Info](docs:wp-model-info){button pi-microchip} "
               "[Mode Relay](docs:wp-mode-relay){button pi-share-alt} "
               "[Node Group](docs:wp-node-group){button pi-objects-column}",
               tone="icon", icon="microchip", color="warning",
               bookmark=view(3820, 1800, 0.42, "Alt+5", 5))})
    minfo = wf.add("WP_ModelInfo", (2640, 1780), (480, 300), widgets={"wp_model_info": MODEL_INFO})
    wf.link(ckpt, "MODEL", minfo, "model")
    wf.link(minfo, "context", person, "upstream")
    wf.link(minfo, "context", tog, "ctl_1a5c7a2d")
    render = ctx(wf, (3260, 1320), "WP Context · Model settings", 3,
                 Bundle("Model settings", "#6b7280", [photo.render_settings], scope=S),
                 salt="one", h=360)
    wf.link(minfo, "context", render, "upstream")
    var_nodes = []
    for i, (kind, title, var, extra) in enumerate((
        ("WP_VarToInt", "Width", "$size", {"index": 0, "default": 832}),
        ("WP_VarToInt", "Height", "$size", {"index": 1, "default": 1216}),
        ("WP_VarToFloat", "CFG", "$cfg", {"index": 0, "default": 4.5}),
        ("WP_VarToChoice", "Sampler", "$sampler", {"match": "loose", "fallback": "dpmpp_2m",
                                                   "if_no_match": "use fallback"}),
    )):
        n = wf.add(kind, (3860, 1320 + i * 250), (420, 220 if kind == "WP_VarToChoice" else 180),
                   title=title, props={"var_name": var}, widgets={"wp_var_name": var, **extra})
        wf.link(render, "context", n, "context")
        var_nodes.append(n)
    wf.link(var_nodes[0], "value", lat, "width")
    wf.link(var_nodes[1], "value", lat, "height")
    wf.link(var_nodes[2], "value", ks, "cfg")
    wf.link(var_nodes[3], "choice", ks, "sampler_name")
    relay = wf.add("WP_ModeRelay", (3260, 1760), (400, 180))
    wf.link(minfo, "context", relay, "node_1")
    group = wf.add("WP_NodeGroup", (4400, 1320), (420, 300), title="WP Node Group · model settings")
    wf.link(relay, "drives", group, "node_1")
    wf.save(OUT / "1 - One image.json", (0.23, 2456, 360))


def _relink(wf: Workflow, node: dict, inp: str, src: dict, out: str) -> None:
    """Point `node.inp` at `src.out`, dropping the link it had."""
    ii = next(i for i, x in enumerate(node["inputs"]) if x["name"] == inp)
    old = node["inputs"][ii]["link"]
    if old is not None:
        link = next(link for link in wf.links if link[0] == old)
        a = next(n for n in wf.nodes if n["id"] == link[1])
        a["outputs"][link[2]]["links"].remove(old)
        wf.links.remove(link)
        node["inputs"][ii]["link"] = None
    wf.link(src, out, node, inp)


# ── 2 - Batches and grids ────────────────────────────────────────────────

SWEEP_LENSES = ["24mm wide-angle lens at f/5.6", "50mm lens at f/1.8, shallow depth of field",
                "135mm lens at f/2, compressed background"]
SWEEP_LIGHTS = ["Rembrandt lighting", "soft window light", "backlit by the setting sun, lens flare"]


def batches_and_grids() -> None:
    wf = Workflow(stable_uuid("2 - Batches and grids"))
    wf.group("Prompt, once per frame", -40, -60, 3720, 1280, "#3f789e")
    wf.group("Quick preview", 3720, -60, 1240, 1280, "#b06634")
    wf.group("Image", -40, 1260, 1900, 1000, "#2f6b4f")
    wf.group("Grid", 1880, 1260, 1800, 1000, "#7a4ea8")
    wf.group("Optional · a new seed per frame", 3720, 1260, 1240, 1000, "#6b7280")

    wf.add("WP_Note", (-760, 0), (620, 760), title="Start here", widgets={"wp_note": note_value(
        "### Batches and grids\n\n"
        "One **Run** makes nine photos of the **same person in the same place**: three lenses "
        "against three kinds of light, laid out as a labelled XY plot. A quick way to see what "
        "the camera and the light do. The lists come with this workflow.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        "| Key | Step |\n|---|---|\n| `Alt+1` | Sweep every combination |\n"
        "| `Alt+2` | A prompt and a label per frame |\n| `Alt+3` | One click, nine images |\n"
        "| `Alt+4` | Quick preview |\n| `Alt+5` | The grid |\n\n"
        ":pi-bookmark: Jump with the keys or the **Bookmarks** dock (top bar).\n\n"
        ":pi-images: More ways to batch: [Make variations](docs:howto-variations)"
        "{button pi-images}" + LINKS_FOOTER, tone="icon", icon="flag")})

    lens = photo.lens
    light = photo.light
    salt = "grid"
    sweep = {"enabled": True, "limit": 64, "hold_others": True, "axes": [
        {"uid": uid_of(lens, salt), "label": "Lens",
         "option_ids": [lens.option_id(v) for v in SWEEP_LENSES]},
        {"uid": uid_of(light, salt), "label": "Light",
         "option_ids": [light.option_id(v) for v in SWEEP_LIGHTS]},
    ]}
    wf.add("WP_Note", (0, 0), (560, 250), title="Sweep every combination", widgets={
        "wp_note": note_value(
            "The **Context Loop** runs everything after it once per frame. Its **Sweep "
            "combinations** walks *Lens* (3 options) against *Light* (3): 9 frames, and **count** "
            "follows it.\n\n**Hold other picks** keeps the same person, outfit, place, pose and "
            "shot on every frame, so only the swept lists change.\n\n"
            "[Sweep combinations](docs:wp-context-loop#sweep-combinations){button pi-th-large}",
            step=1, bookmark=view(1820, 580, 0.4, "Alt+1", 1))})
    loop = wf.add("WP_ContextLoop", (0, 420), (400, 440), widgets={
        "seed": 7, "control_after_generate": "randomize", "count": 9,
        "wp_context_loop_config": loop_config(sweep=sweep)})
    wf.add("WP_Note", (620, 0), (560, 200), title="Packs, built in", widgets={
        "wp_note": note_value(
            "**Person**, **Location**, **Wardrobe**, **Light**, **Camera**… are packs of lists "
            "stored in this workflow (grey **EXAMPLE** chip). Right-click a header → **Push to "
            "library…** to keep one.\n\n[Bundles](docs:bundles){button pi-box}",
            tone="icon", icon="box", color="teal")})
    person = ctx(wf, (460, 300), "WP Context · Person", 1, photo.render(False), photo.person(),
                 salt=salt, h=620)
    scene = ctx(wf, (1100, 300), "WP Context · Scene", 2, photo.location(), photo.wardrobe(),
                Bundle("Light", "#d4b33a", [light], scope=S),
                Bundle("Camera", "#5a7fc9", [photo.shot, photo.angle, lens, photo.film,
                                             photo.framing_rule], scope=S),
                photo.direction(), salt=salt, h=620)
    wf.link(loop, "context", person, "upstream")
    wf.link(person, "context", scene, "upstream")
    wf.add("WP_Note", (1600, 0), (560, 200), title="A prompt and a label per frame", widgets={
        "wp_note": note_value(
            "The first **Assembler** writes the prompt. The second writes the label "
            "`$lens · $light`: **Label & Grid** reads its two parts as the grid's rows and "
            "columns.\n\n[Prompt Assembler](docs:wp-prompt-assembler){button pi-book}",
            step=2, bookmark=view(1820, 580, 0.4, "Alt+2", 2))})
    asm = wf.add("WP_PromptAssembler", (1760, 300), (480, 460),
                 widgets={"template": photo.PROMPT, "negative_template": photo.NEGATIVE})
    cln = wf.add("WP_PromptCleaner", (2300, 300), (480, 500), widgets={"wp_cleaner": CLEANER})
    lab = wf.add("WP_PromptAssembler", (2840, 300), (480, 360),
                 title="WP Prompt Assembler · grid labels",
                 widgets={"template": "$lens · $light", "negative_template": ""})
    wf.link(scene, "context", asm, "context")
    wf.link(scene, "context", lab, "context")
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")

    # Quick preview
    wf.add("WP_Note", (3760, 0), (560, 330), title="Quick preview", widgets={
        "wp_note": note_value(
            "**WP Toggles** in *Pick one* mode: pick **Quick** for a fast, rough pass of the whole "
            "grid, **Full** for the real thing.\n\n"
            "- The pick's value goes to `$steps`; **Var → Int** hands it to the sampler.\n"
            "- Each choice also writes its own true / false: **Var → Bool** reads "
            "`$quick_preview` and the **If/Else Switch** picks the smaller latent.\n\n"
            "[WP Toggles](docs:wp-toggles){button pi-sliders-h} "
            "[Var → Bool](docs:wp-var-to-bool){button pi-check-square}",
            tone="icon", icon="bolt", color="warning", bookmark=view(4340, 580, 0.53, "Alt+4", 4))})
    tog = wf.add("WP_Toggles", (3760, 420), (460, 150), title="WP Toggles · steps", widgets={
        "wp_toggles": json.dumps({"version": 1, "mode": "one", "group_var": "steps",
            "group_upstream": True, "rows": [
                {"id": "996c84f0", "kind": "toggle", "name": "Quick", "var": "quick_preview",
                 "on": False, "pin": False, "out": 0, "style": "chip", "value": "12"},
                {"id": "51ce16e1", "kind": "toggle", "name": "Full", "var": "full_render",
                 "on": True, "pin": False, "out": 0, "style": "chip", "value": "30"}]})})
    steps = wf.add("WP_VarToInt", (3760, 640), (420, 180), title="Steps",
                   props={"var_name": "$steps"},
                   widgets={"wp_var_name": "$steps", "index": 0, "default": 30})
    quick = wf.add("WP_VarToBool", (4380, 700), (420, 180), title="Quick preview?",
                   props={"var_name": "$quick_preview"},
                   widgets={"wp_var_name": "$quick_preview", "index": 0, "default": False})
    small = wf.add("EmptyLatentImage", (3760, 880), (300, 110), title="Quick size",
                   widgets={"width": 512, "height": 768, "batch_size": 1})
    full = wf.add("EmptyLatentImage", (3760, 1040), (300, 110), title="Full size",
                  widgets={"width": 832, "height": 1216, "batch_size": 1})
    switch = wf.add("ComfySwitchNode", (4380, 420), (270, 80), title="Latent")
    wf.link(tog, "context", steps, "context")
    wf.link(tog, "context", quick, "context")
    wf.link(full, "LATENT", switch, "on_false")
    wf.link(small, "LATENT", switch, "on_true")
    wf.link(quick, "value", switch, "switch")

    # Image
    wf.add("WP_Note", (0, 1320), (560, 230), title="One click, nine images", widgets={
        "wp_note": note_value(
            "Pick your model in **Load Checkpoint** and press **Run** once. The sampler seed is "
            "**fixed**, so only the prompt changes between cells: a fair comparison.\n\n"
            + SUGGESTED + "\n\n[Seeds & loops](docs:seeds-and-loops){button pi-refresh}",
            step=3, bookmark=view(900, 1760, 0.6, "Alt+3", 3))})
    ckpt = wf.add("CheckpointLoaderSimple", (0, 1620), (380, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    dec = _image_chain(wf, 620, 1320, ckpt, cln, seed=42, control="fixed")
    ks = wf._last["ks"]  # type: ignore[attr-defined]
    wf.link(switch, "output", ks, "latent_image")
    wf.link(steps, "value", ks, "steps")

    # Grid
    wf.add("WP_Note", (1920, 1320), (560, 230), title="The grid", widgets={
        "wp_note": note_value(
            "**Label & Grid** has two outputs: `images` (each one with its label) and `grid` "
            "(one sheet, saved here). Rows come from label part 1, columns from part 2.\n\n"
            ":pi-image: Want the images with no labels? Wire **VAE Decode** straight into a "
            "**Save Image**.\n\n[WP Label & Grid](docs:wp-label-grid){button pi-th-large}",
            tone="icon", icon="th-large", color="info", bookmark=view(2760, 1760, 0.6, "Alt+5", 5))})
    grid = wf.add("WP_LabelGrid", (1920, 1620), (520, 480), widgets={"wp_label_grid": json.dumps({
        "label": "", "position": "none", "align": "center", "font": "default", "font_size": 0,
        "text_color": "#ffffff", "label_color": "#000000", "grid": True, "arrange": "auto",
        "columns": 0, "rows_from": "part:1", "row_headers": "", "columns_from": "part:2",
        "column_headers": "", "title": "Same person and place: three lenses × three lights",
        "gap": 8, "margin": 16, "background": "#ffffff", "header_color": "#000000",
        "cell_width": 512})})
    save = wf.add("SaveImage", (2520, 1320), (1100, 900), widgets={"filename_prefix": "wp-examples/grid"})
    wf.link(dec, "IMAGE", grid, "images")
    wf.link(lab, "prompt", grid, "labels")
    wf.link(grid, "grid", save, "images")

    # Seed list
    wf.add("WP_Note", (3760, 1320), (560, 200), title="A new seed per frame (optional)", widgets={
        "wp_note": note_value(
            "Un-bypass the **Seed List** (select it, Ctrl+B) to give every frame its own sampler "
            "seed. It follows the Loop's frame count through `loop_config`. Bypassed, the "
            "sampler's fixed seed is used.\n\n[WP Seed List](docs:wp-seed-list){button pi-list}",
            tone="icon", icon="replay", color="neutral")})
    seeds = wf.add("WP_SeedList", (3760, 1600), (400, 340), mode=BYPASS, widgets={
        "base_seed": 42, "control_after_generate": "randomize", "count": 9})
    wf.link(loop, "loop_config", seeds, "loop_config")
    wf.link(seeds, "seed", ks, "seed")
    wf.save(OUT / "2 - Batches and grids.json", (0.22, 2540, 380))


# ── 3 - Pick and refine ──────────────────────────────────────────────────


def pick_and_refine() -> None:
    wf = Workflow(stable_uuid("3 - Pick and refine"))
    wf.group("Four looks", -40, -60, 3080, 1280, "#3f789e")
    wf.group("Drafts", 3080, -60, 2000, 1280, "#2f6b4f")
    wf.group("Pick", -40, 1260, 3080, 1000, "#7a4ea8")
    wf.group("Refine the picks", 3080, 1260, 2000, 1000, "#b06634")

    wf.add("WP_Note", (-760, 0), (620, 760), title="Start here", widgets={"wp_note": note_value(
        "### Pick and refine\n\n"
        "A fashion shoot: **one person** in four different looks and places. The run **pauses** "
        "so you can pick the keepers (and fix a prompt or paint a mask), then refines only "
        "those. The lists come with this workflow.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        "| Key | Step |\n|---|---|\n| `Alt+1` | Four looks |\n| `Alt+2` | Quick drafts |\n"
        "| `Alt+3` | Pick the keepers |\n| `Alt+4` | Refine only the picks |\n"
        "| `Alt+5` | The picks, refined |\n\n"
        ":pi-bookmark: Jump with the keys or the **Bookmarks** dock (top bar)." + LINKS_FOOTER,
        tone="icon", icon="flag")})
    salt = "pick"
    wf.add("WP_Note", (0, 0), (560, 280), title="Four looks", widgets={"wp_note": note_value(
        "The **Context Loop** runs everything after it 4 times. The **Person** rows have **Hold "
        "across run** on (the pin icon), so all four frames show the same person; outfit, place, "
        "light and camera roll per frame.\n\n"
        "Change **count** for more looks.\n\n"
        "[WP Context Loop](docs:wp-context-loop){button pi-book} "
        "[Keep something the same](docs:howto-keep-steady){button pi-lock}",
        step=1, bookmark=view(1500, 580, 0.42, "Alt+1", 1))})
    loop = wf.add("WP_ContextLoop", (0, 360), (400, 440), widgets={
        "seed": 5, "control_after_generate": "randomize", "count": 4,
        "wp_context_loop_config": loop_config()})
    person = ctx(wf, (460, 340), "WP Context · Person (held)", 1, photo.render(False),
                 photo.person(hold=True), salt=salt, h=620)
    scene = ctx(wf, (1100, 340), "WP Context · The look", 2, *_scene_bundles(), salt=salt, h=620)
    wf.link(loop, "context", person, "upstream")
    wf.link(person, "context", scene, "upstream")
    asm = wf.add("WP_PromptAssembler", (1760, 340), (480, 460),
                 widgets={"template": photo.PROMPT, "negative_template": photo.NEGATIVE})
    lab = wf.add("WP_PromptAssembler", (1760, 860), (480, 300),
                 title="WP Prompt Assembler · labels",
                 widgets={"template": "$outfit", "negative_template": ""})
    cln = wf.add("WP_PromptCleaner", (2300, 340), (480, 500), widgets={"wp_cleaner": CLEANER})
    wf.link(scene, "context", asm, "context")
    wf.link(scene, "context", lab, "context")
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")

    wf.add("WP_Note", (3120, 0), (560, 280), title="Quick drafts", widgets={"wp_note": note_value(
        "Pick your model in **Load Checkpoint** and press **Run**. The **Seed List** gives each "
        "frame its own sampler seed, following the Loop through `loop_config`.\n\n" + SUGGESTED
        + "\n\n[WP Seed List](docs:wp-seed-list){button pi-book}",
        step=2, bookmark=view(3960, 580, 0.42, "Alt+2", 2))})
    ckpt = wf.add("CheckpointLoaderSimple", (3120, 340), (380, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    seeds = wf.add("WP_SeedList", (3120, 500), (400, 340), widgets={
        "base_seed": 5, "control_after_generate": "randomize", "count": 4})
    wf.link(loop, "loop_config", seeds, "loop_config")
    lat = wf.add("EmptyLatentImage", (3120, 900), (300, 110),
                 widgets={"width": 832, "height": 1216, "batch_size": 1})
    dec = _image_chain(wf, 3560, 340, ckpt, cln)
    ks = wf._last["ks"]  # type: ignore[attr-defined]
    pos_enc, neg_enc = wf._last["pos"], wf._last["neg"]  # type: ignore[attr-defined]
    wf.set(ks, steps=20)
    wf.link(lat, "LATENT", ks, "latent_image")
    wf.link(seeds, "seed", ks, "seed")

    wf.add("WP_Note", (0, 1320), (560, 300), title="Pick the keepers", widgets={
        "wp_note": note_value(
            "The run **pauses** at the **Image Filter**: click the drafts you like, then "
            "**Continue**. Every output keeps only the picks: `latent` and `positive` / "
            "`negative` feed the refine pass, `labels` the contact sheet.\n\n"
            "You can fix a prompt or paint a mask there too. With `clip` wired, an edited prompt "
            "is encoded again.\n\n[WP Image Filter](docs:wp-image-filter){button pi-book}",
            step=3, color="violet", bookmark=view(1500, 1760, 0.5, "Alt+3", 3))})
    filt = wf.add("WP_ImageFilter", (620, 1320), (490, 430), widgets={"wp_image_filter": json.dumps(
        {"mode": "pause", "send_as": "same_shape", "timeout": 600, "on_timeout": "keep_all"},
        separators=(",", ":"))})
    wf.link(dec, "IMAGE", filt, "images")
    wf.link(ks, "LATENT", filt, "latent")
    wf.link(pos_enc, "CONDITIONING", filt, "positive")
    wf.link(neg_enc, "CONDITIONING", filt, "negative")
    wf.link(cln, "prompt", filt, "positive_text")
    wf.link(cln, "negative", filt, "negative_text")
    wf.link(scene, "context", filt, "context")
    wf.link(ckpt, "CLIP", filt, "clip")
    wf.add("WP_Note", (1340, 1320), (560, 230), title="A contact sheet of the picks", widgets={
        "wp_note": note_value(
            "**Label & Grid** reads the filter's `labels` (`#1`, `#3`…) and shows one sheet on "
            "the node. For the picks without labels, wire the filter's `images` straight into a "
            "**Save Image**.\n\n[WP Label & Grid](docs:wp-label-grid){button pi-book}",
            tone="icon", icon="th-large", color="info")})
    grid = wf.add("WP_LabelGrid", (1340, 1620), (520, 490), widgets={"wp_label_grid": json.dumps({
        "label": "{label}", "position": "top", "align": "center", "font": "default",
        "font_size": 0, "text_color": "#ffffff", "label_color": "#000000", "grid": True,
        "arrange": "auto", "columns": 0, "rows_from": "none", "row_headers": "",
        "columns_from": "none", "column_headers": "", "title": "", "gap": 8, "margin": 0,
        "background": "#ffffff", "header_color": "#000000", "cell_width": 0},
        separators=(",", ":"))})
    wf.link(filt, "images", grid, "images")
    wf.link(filt, "labels", grid, "labels")

    wf.add("WP_Note", (3120, 1320), (560, 200), title="Refine only the picks", widgets={
        "wp_note": note_value(
            "A second pass upscales the picked latents by 1.5 and samples them again at half "
            "denoise. The drafts you skipped never reach it.",
            step=4, color="tip", bookmark=view(3960, 1760, 0.5, "Alt+4", 4))})
    up = wf.add("LatentUpscaleBy", (3120, 1580), (300, 90),
                widgets={"upscale_method": "nearest-exact", "scale_by": 1.5})
    ks2 = wf.add("KSampler", (3720, 1320), (300, 280), title="KSampler · refine", widgets={
        "seed": 5, "control_after_generate": "fixed", "steps": 20, "cfg": 4.5,
        "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 0.5})
    dec2 = wf.add("VAEDecode", (4080, 1320), (200, 50))
    wf.link(filt, "latent", up, "samples")
    wf.link(ckpt, "MODEL", ks2, "model")
    wf.link(filt, "positive", ks2, "positive")
    wf.link(filt, "negative", ks2, "negative")
    wf.link(up, "LATENT", ks2, "latent_image")
    wf.link(ks2, "LATENT", dec2, "samples")
    wf.link(ckpt, "VAE", dec2, "vae")
    wf.add("WP_Bookmark", (4340, 1320), (183, 30), title="The picks, refined", widgets={
        "wp_bookmark": json.dumps({"version": 1, "color": "", "icon": "image", "hidden": False,
                                   **view(4700, 1760, 0.6, "Alt+5", 5)})})
    save = wf.add("SaveImage", (4340, 1400), (700, 820), widgets={"filename_prefix": "wp-examples/picked"})
    wf.link(dec2, "IMAGE", save, "images")
    wf.save(OUT / "3 - Pick and refine.json", (0.24, 2200, 360))


def build_all() -> None:
    one_image()
    batches_and_grids()
    pick_and_refine()
    build.sets_and_stories()
