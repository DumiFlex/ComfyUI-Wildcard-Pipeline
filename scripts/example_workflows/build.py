"""Write the example workflows in `example_workflows/` from the packs here.

    python scripts/example_workflows/build.py

The output is committed; `tests/test_example_workflows.py` runs every file on
an empty library.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import photo  # noqa: E402
import stories  # noqa: E402
from graph import MUTE, Workflow, note_value, stable_uuid, view  # noqa: E402
from packs import Bundle, Module, context_value  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "example_workflows"

CLEANER = json.dumps({"mode": "tags", "intensity": "balanced", "rules_override": {},
                      "blocklist": {"kind": "list", "entries": []}}, separators=(",", ":"))
LINKS_FOOTER = (
    "\n\n---\n\n**Questions, ideas, packs to share:**\n\n"
    "[Discord](https://discord.gg/BFYR9WQdVR){button pi-discord #5865f2} "
    "[Community packs](https://wp.dumiflex.dev){button pi-globe #22c55e} "
    "[Wiki](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki){button pi-github #8b949e} "
    "[About these examples](docs:howto-examples){button pi-th-large}"
)
MODEL_INFO = json.dumps({"version": 1, "rules": [
    {"variant": "noobai", "pattern": "noob"}, {"variant": "pony", "pattern": "pony|pdxl"},
    {"variant": "illustrious", "pattern": "illustrious|ilxl"},
    {"variant": "animagine", "pattern": "animagine"}],
    "family": "", "variant": "", "name": "",
    "internal": {"family": True, "variant": True, "name": True}}, separators=(",", ":"))


HELP_TIP = (
    ":pi-question-circle:{#6366f1} **Help for any node:** select it and press the indigo **?** "
    "in the toolbar above it. Its help page opens over the canvas, with what every socket and "
    "control does. On WP Toggles, Note and Bookmark the **pencil** next to it opens the editor."
)
JUMP_TIP = (
    ":pi-bookmark: Press a step's number key with the canvas focused, or click it in the "
    "**Bookmarks** dock (top bar). **Start here** is a bookmark too, so the dock always brings "
    "you back to this note."
)


def start_view(x: float, w: float, h: float) -> dict:
    """The Start here note's own bookmark: first in the dock, no key."""
    return view(x + w / 2, h / 2, 0.7, "", 0)


def loop_config(**over: object) -> str:
    cfg: dict[str, object] = {
        "strategy": "hash_index", "override_seed": False, "iteration_var_name": "iteration",
        "bypass": False, "iteration_internal": True, "total_internal": True, "seed_locks": {},
        "bypass_frames": [],
        "sweep": {"enabled": False, "limit": 64, "hold_others": True, "axes": []},
    }
    cfg.update(over)
    return json.dumps(cfg)


def grid_config(title: str, *, label: bool, columns: int = 0) -> str:
    return json.dumps({
        "label": "", "position": "below" if label else "none", "align": "center",
        "font": "default", "font_size": 0, "text_color": "#ffffff", "label_color": "#000000",
        "grid": True, "arrange": "columns" if columns else "auto", "columns": columns,
        "rows_from": "none", "row_headers": "", "columns_from": "none", "column_headers": "",
        "title": title, "gap": 8, "margin": 16, "background": "#ffffff",
        "header_color": "#000000", "cell_width": 512,
    })


def ctx(wf: Workflow, pos: tuple[float, float], title: str, seed: int, *items: Module | Bundle,
        salt: str, h: float = 560, mode: int = 0) -> dict:
    return wf.add("WP_Context", pos, (600, h), title=title, mode=mode, widgets={
        "seed": seed, "control_after_generate": "randomize",
        "wp_modules": context_value(*items, salt=salt),
    })


# ── 4 - Sets and stories ─────────────────────────────────────────────────

FILTER = json.dumps({"mode": "pause", "send_as": "same_shape", "timeout": 600,
                     "on_timeout": "keep_all"}, separators=(",", ":"))
ROW_H = 1500
GROUPS = [
    ("Every frame different", "#3f789e"),
    ("Photo shoot", "#a1309b"),
    ("Storyboard", "#b06634"),
]


def sets_and_stories() -> None:
    wf = Workflow(stable_uuid("4 - Sets and stories"))
    ckpt = wf.add("CheckpointLoaderSimple", (-1260, 1600), (380, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})

    wf.add("WP_Toggles", (-1260, 1300), (480, 230), title="WP Toggles · pick a mode",
                     widgets={"wp_toggles": json.dumps({
                         "version": 1, "mode": "one", "group_var": "pack_mode",
                         "rows": [
                             {"id": "a1f0c001", "kind": "toggle", "name": GROUPS[0][0],
                              "var": "mode_random", "on": False, "pin": False, "out": 0,
                              "style": "switch", "control": "mute", "groups": [GROUPS[0][0]],
                              "value": "random"},
                             {"id": "a1f0c002", "kind": "toggle", "name": GROUPS[1][0],
                              "var": "mode_shoot", "on": False, "pin": False, "out": 0,
                              "style": "switch", "control": "mute", "groups": [GROUPS[1][0]],
                              "value": "shoot"},
                             {"id": "a1f0c003", "kind": "toggle", "name": GROUPS[2][0],
                              "var": "mode_story", "on": True, "pin": False, "out": 0,
                              "style": "switch", "control": "mute", "groups": [GROUPS[2][0]],
                              "value": "story"},
                         ]})})

    wf.add("WP_Note", (-1260, 1080), (620, 190), title="Pick a mode", widgets={
        "wp_note": note_value(
            "**Pick one**: switching a mode on switches the others off, and each row mutes its "
            "own canvas group, so only the picked group runs. Use the indigo **?** above the "
            "node for what each part does.\n\n[WP Toggles](docs:wp-toggles){button pi-sliders-h}",
            tone="icon", icon="sliders-h", color="violet",
            bookmark=view(-950, 1080 + 260, 0.8, "", 4))})
    wf.add("WP_Note", (-1260, 0), (620, 1040), title="Start here", widgets={"wp_note": note_value(
        "### Sets and stories\n\n"
        "One **Run** makes a set of images from one loop. Three ways to run it, one group each; "
        "**WP Toggles · pick a mode** (below) switches the other two off.\n\n"
        "| Mode | What changes from frame to frame |\n|---|---|\n"
        "| **Every frame different** | everything: a new person, outfit, place and light |\n"
        "| **Photo shoot** | pose, expression and the camera. Same person, outfit, place, light |\n"
        "| **Storyboard** | the story's next beat: what happens, where, the light, the shot |\n\n"
        ":pi-images: Each run **pauses** at **WP Image Filter**: look the frames over, click "
        "the ones you want, then **Continue**. Only the picks go on the Label & Grid sheet "
        "(Keep all, or wait 10 minutes, keeps them all). [WP Image Filter](docs:wp-image-filter)"
        "{button pi-filter}\n\n"
        "All the lists come with this workflow, in packs (bundles) on the **WP Context** nodes.\n\n"
        "[Add this workflow's lists to my library](wp:library){button pi-download}\n\n"
        "| Key | Jump to |\n|---|---|\n| `1` | Every frame different |\n"
        "| `2` | Photo shoot |\n| `3` | Storyboard |\n\n"
        + JUMP_TIP + "\n\n" + HELP_TIP + "\n\n"
        ":pi-lightbulb:{#22c55e} The lists name no style, so they suit any model. **WP Model "
        "Info** in each group sets the quality words: Illustrious / NoobAI by default, Pony's "
        "score tags, none for Flux. Add your style to the template.\n\n"
        ":pi-lock: Want this for your own lists? [Keep something the same](docs:howto-keep-steady)"
        "{button pi-lock} explains **Hold across run**, the switch the photo shoot and the "
        "storyboard lean on." + LINKS_FOOTER,
        tone="icon", icon="flag", bookmark=start_view(-1260, 620, 1040))})

    for gi, (gtitle, gcolor) in enumerate(GROUPS):
        y = gi * ROW_H
        salt = f"sets-{gi}"
        muted = MUTE if gi != 2 else 0
        wf.group(gtitle, -40, y - 60, 6800, ROW_H - 100, gcolor)

        loop = wf.add("WP_ContextLoop", (0, y + 380), (400, 440), mode=muted)
        minfo = wf.add("WP_ModelInfo", (0, y + 880), (400, 300), mode=muted,
                       widgets={"wp_model_info": MODEL_INFO})
        wf.link(loop, "context", minfo, "upstream")
        wf.link(ckpt, "MODEL", minfo, "model")

        if gi == 0:
            wf.set(loop, seed=11, count=8, wp_context_loop_config=loop_config())
            c1 = ctx(wf, (460, y + 320), "WP Context · Person", 1, photo.render(False),
                     photo.person(), salt=salt, mode=muted)
            c2 = ctx(wf, (1100, y + 320), "WP Context · Wardrobe and place", 2,
                     photo.location(), photo.wardrobe(), salt=salt, mode=muted)
            c3 = ctx(wf, (1740, y + 320), "WP Context · Light and camera", 3,
                     photo.lighting(), photo.camera(), photo.direction(), salt=salt, mode=muted)
            prompt, label = photo.PROMPT, "$age $gender · $place"
            grid = grid_config("Every frame different", label=True, columns=4)
            text = ("A **Context Loop** of 8 frames. Nothing is held, so every frame rolls the "
                    "whole chain again: a new person, outfit, place, light and shot.\n\n"
                    "**WP Seed List** gives each frame its own sampler seed too.\n\n"
                    "[WP Context Loop](docs:wp-context-loop){button pi-replay}")
        elif gi == 1:
            wf.set(loop, seed=21, count=6, wp_context_loop_config=loop_config())
            cam = photo.camera(hold_film=True)
            shot = cam.children[0]
            assert isinstance(shot, Module) and shot.name == "Shot"
            order = ["wide shot", "full body", "cowboy shot", "upper body",
                     "portrait", "close-up"]
            shot.iteration_overrides = {
                str(i): {"enabled_options": [shot.option_id(v)]} for i, v in enumerate(order)
            }
            c1 = ctx(wf, (460, y + 320), "WP Context · Person (held)", 4, photo.render(False),
                     photo.person(hold=True), salt=salt, mode=muted)
            c2 = ctx(wf, (1100, y + 320), "WP Context · Wardrobe and place (held)", 5,
                     photo.location(hold=True), photo.wardrobe(hold=True),
                     photo.lighting(hold=True), salt=salt, mode=muted)
            c3 = ctx(wf, (1740, y + 320), "WP Context · Shot list", 6, cam, photo.direction(),
                     salt=salt, mode=muted)
            prompt, label = photo.PROMPT, "$shot"
            grid = grid_config("Photo shoot: one person, six shots", label=True, columns=3)
            text = ("Every row in the first two Contexts has **Hold across run** on (the pin "
                    "icon): one person, outfit, place and light for the whole set.\n\n"
                    "The *Shot* row has a pick **per frame** (Edit frame chips #1 to #6 in the "
                    "Shot list Context): wide, full body, three quarter, waist up, head and "
                    "shoulders, close-up. Pose and expression still roll each frame.\n\n"
                    "The sampler seed is **fixed**, so the face drifts less between shots.\n\n"
                    "[Per-iteration overrides](docs:iteration-overrides){button pi-images}")
        else:
            wf.set(loop, seed=31, count=6, wp_context_loop_config=loop_config())
            film = photo.held(photo.film)
            c1 = ctx(wf, (460, y + 320), "WP Context · Person (held)", 7, photo.render(False),
                     photo.person(hold=True), salt=salt, mode=muted)
            c2 = ctx(wf, (1100, y + 320), "WP Context · Story and wardrobe", 8,
                     Bundle("Story", "#b06634", [stories.story, stories.story_outfit_rule],
                            scope=photo.S),
                     photo.held_all(Bundle("Wardrobe", "#c08a3e",
                                           [photo.gender_outfit_rule, photo.outfit,
                                            photo.accessories, photo.shoes],
                                           scope=photo.S)),
                     salt=salt, mode=muted)
            c3 = ctx(wf, (1740, y + 320), "WP Context · Beats", 9,
                     Bundle("Beats", "#b06634", [stories.beats()], scope=photo.S),
                     Bundle("Camera", "#5a7fc9", [photo.lens_from_shot, film, photo.framing_rule],
                            scope=photo.S),
                     salt=salt, mode=muted)
            prompt, label = stories.STORY_PROMPT, "$beat_title"
            grid = grid_config("Storyboard", label=True, columns=3)
            text = ("A held **Story** picks one of four scripts for the run. **Beats** is a "
                    "derivation: *IF $story is … AND $iteration is 3* it writes that frame's "
                    "action, place, light, shot and expression. The gala story changes outfit "
                    "at the first beat.\n\n"
                    "Person and wardrobe are held, the sampler seed is fixed, and the grid "
                    "reads in story order.\n\n"
                    "[Derivation](docs:derivation){button pi-share-alt} "
                    "[Seeds & loops](docs:seeds-and-loops){button pi-refresh}")

        wf.add("WP_Note", (0, y), (900, 280), title=gtitle, mode=0, widgets={
            "wp_note": note_value(text, tone="step", step=gi + 1, bookmark=view(
                3360, y + 700, 0.24, f"{gi + 1}", gi + 1))})

        wf.link(minfo, "context", c1, "upstream")
        wf.link(c1, "context", c2, "upstream")
        wf.link(c2, "context", c3, "upstream")

        asm = wf.add("WP_PromptAssembler", (2380, y + 320), (460, 420), mode=muted,
                     widgets={"template": prompt, "negative_template": photo.NEGATIVE})
        lab = wf.add("WP_PromptAssembler", (1740, y + 800), (480, 480), mode=muted,
                     title="WP Prompt Assembler · labels",
                     widgets={"template": label, "negative_template": ""})
        cln = wf.add("WP_PromptCleaner", (2900, y + 320), (460, 480), mode=muted,
                     widgets={"wp_cleaner": CLEANER})
        for c in (asm, lab):
            wf.link(c3, "context", c, "context")
        wf.link(asm, "prompt", cln, "prompt")
        wf.link(asm, "negative", cln, "negative")

        pos = wf.add("CLIPTextEncode", (3420, y + 320), (400, 160), title="Positive", mode=muted)
        neg = wf.add("CLIPTextEncode", (3420, y + 520), (400, 160), title="Negative", mode=muted)
        lat = wf.add("EmptyLatentImage", (3420, y + 720), (300, 110), mode=muted,
                     widgets={"width": 832, "height": 1216, "batch_size": 1})
        ks = wf.add("KSampler", (3880, y + 320), (300, 280), mode=muted, widgets={
            "seed": 42 + gi, "control_after_generate": "fixed", "steps": 28, "cfg": 5.5,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1})
        dec = wf.add("VAEDecode", (4240, y + 320), (200, 50), mode=muted)
        wf.add("WP_Note", (4500, y), (490, 280), title=f"{gtitle} · pick the frames", widgets={
            "wp_note": note_value(
                "The run **pauses** here. Click the frames you want on the sheet, then "
                "**Continue** (or **Keep all**). Each keeps its label for the grid. Press **?** "
                "above the node for its keys and modes.\n\n"
                "[WP Image Filter](docs:wp-image-filter){button pi-filter}",
                tone="icon", icon="filter", color="tip",
                bookmark=view(5000, y + 500, 0.6, "", 10 + gi))})
        filt = wf.add("WP_ImageFilter", (4500, y + 320), (490, 430), mode=muted,
                      widgets={"wp_image_filter": FILTER})
        grid_n = wf.add("WP_LabelGrid", (5060, y + 320), (520, 480), mode=muted,
                        widgets={"wp_label_grid": grid})
        save = wf.add("SaveImage", (5640, y + 320), (1080, 1000), mode=muted,
                      widgets={"filename_prefix": f"wp-examples/{gtitle.lower().replace(' ', '-')}"})
        for enc, src in ((pos, "prompt"), (neg, "negative")):
            wf.link(ckpt, "CLIP", enc, "clip")
            wf.link(cln, src, enc, "text")
        wf.link(ckpt, "MODEL", ks, "model")
        wf.link(pos, "CONDITIONING", ks, "positive")
        wf.link(neg, "CONDITIONING", ks, "negative")
        wf.link(lat, "LATENT", ks, "latent_image")
        wf.link(ks, "LATENT", dec, "samples")
        wf.link(ckpt, "VAE", dec, "vae")
        # The run pauses at the Image Filter: the picks (and their labels,
        # carried on extra_1) go on to the sheet.
        wf.link(dec, "IMAGE", filt, "images")
        wf.link(lab, "prompt", filt, "extra_1")
        wf.link(filt, "images", grid_n, "images")
        wf.link(filt, "extra_1", grid_n, "labels")
        wf.link(grid_n, "grid", save, "images")
        if gi == 0:
            seeds = wf.add("WP_SeedList", (3880, y + 660), (300, 300), mode=muted, widgets={
                "base_seed": 42, "control_after_generate": "randomize", "count": 8})
            wf.link(loop, "loop_config", seeds, "loop_config")
            wf.link(seeds, "seed", ks, "seed")

    wf.save(OUT / "4 - Sets and stories.json", (0.16, 1500, 500))


if __name__ == "__main__":
    import core_workflows

    core_workflows.build_all()
    print("wrote", OUT)
