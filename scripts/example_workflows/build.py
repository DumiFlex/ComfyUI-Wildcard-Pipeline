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
    "\n\n![The node toolbar, with the indigo ? help button](wp:asset/toolbar-help){width=70%}"
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
ROW_H = 1760
GROUPS = [
    ("Every frame different", "#3f789e"),
    ("Photo shoot", "#a1309b"),
    ("Storyboard", "#b06634"),
]
# Inner groups of a mode row: (title, x, width). The toggle mutes the outer group.
PARTS = [("Lists", -20, 2500), ("Prompt", 2520, 1140), ("Image", 3680, 860),
         ("Pick and grid", 4560, 2220)]
# The checkpoint's wires run down one trunk each, left of the rows.
TRUNK = {"MODEL": -300, "CLIP": -312, "VAE": -324, "BOOL": -336}


def bus(wf: Workflow, src: dict, outs: dict[str, tuple[str, float]]) -> dict[str, tuple]:
    """Trunk roots for `src`'s outputs: {kind: (src, output, root reroute)}."""
    return {k: (src, out, wf.route((TRUNK[k], y))) for k, (out, y) in outs.items()}


def tap(wf: Workflow, trunk: tuple, node: dict, inp: str, *points: tuple[float, float]) -> None:
    """Link a trunk into `node.inp`, along `points` (the first one on the trunk)."""
    src, out, root = trunk
    wf.link(src, out, node, inp, via=wf.route(*points, after=root))


def mode_row(wf: Workflow, gi: int, *, title: str, color: str, muted: int, trunks: dict,
             loop_values: dict, contexts: list[tuple[str, int, list]], salt: str, prompt: str,
             negative: str, label: str, cleaner: str, grid: str, text: str, prompt_note: str,
             image_note: str, ks_seed: int, seeds: int | None, prefix: str,
             injector: dict | None = None) -> dict[str, dict]:
    """One mode of a Sets and stories workflow, laid out left to right in four parts.

    Lists (loop, Model Info, contexts) → Prompt → Image → Pick and grid. The
    checkpoint comes in from the trunks along a lane under the row.
    """
    y0 = gi * ROW_H
    n = y0 + 380  # nodes
    lane = y0 + 1516
    wf.group(title, -40, y0 - 70, 6840, 1660, color)
    for part, x, w in PARTS:
        wf.group(part, x, y0, w, 1490, color)

    def add(kind: str, pos: tuple[float, float], size: tuple[float, float], **kw) -> dict:
        return wf.add(kind, pos, size, mode=muted, **kw)

    loop = add("WP_ContextLoop", (0, n), (400, 460))
    wf.set(loop, **loop_values)
    minfo = add("WP_ModelInfo", (0, n + 500), (400, 320), widgets={"wp_model_info": MODEL_INFO})
    head = [loop, minfo]
    if injector:
        head.append(add("WP_ContextInjector", (0, n + 880), (460, 210), **injector))
    # Each head node feeds the one under it: out on the right, round, in on the left.
    for k, (a, b) in enumerate(zip(head, head[1:], strict=False)):
        top = b["pos"][1]
        wf.link(a, "context", b, "upstream", via=wf.route(
            (472 + k * 12, a["pos"][1] + 30), (472 + k * 12, top - 30), (-8, top - 30),
            (-8, top + 30)))
    tap(wf, trunks["MODEL"], minfo, "model", (TRUNK["MODEL"], n + 556), (-20, n + 556))
    if injector and "BOOL" in trunks:
        tap(wf, trunks["BOOL"], head[-1], "input_0", (TRUNK["BOOL"], n + 936), (-20, n + 936))
    cs = []
    for i, (ctitle, seed, items) in enumerate(contexts):
        cs.append(ctx(wf, (520 + i * 660, n), ctitle, seed, *items, salt=salt, h=420,
                      mode=muted))
    wf.link(head[-1], "context", cs[0], "upstream",
            via=wf.route((500, head[-1]["pos"][1] + 30), (500, n + 30)))
    for a, b in zip(cs, cs[1:], strict=False):
        wf.link(a, "context", b, "upstream")
    wf.add("WP_Note", (0, y0 + 50), (1000, 290), title=title, widgets={
        "wp_note": note_value(text, tone="step", step=gi + 1, bookmark=view(
            3370, y0 + 735, 0.24, f"{gi + 1}", gi + 1))})

    # Prompt
    wf.add("WP_Note", (2560, y0 + 50), (1060, 200), title=f"{title} · prompt", widgets={
        "wp_note": note_value(prompt_note, tone="icon", icon="pencil", color="teal")})
    asm = add("WP_PromptAssembler", (2560, n), (500, 640),
              widgets={"template": prompt, "negative_template": negative})
    cln = add("WP_PromptCleaner", (3120, n), (500, 520), widgets={"wp_cleaner": cleaner})
    lab = add("WP_PromptAssembler", (3120, n + 580), (500, 470),
              title="WP Prompt Assembler · labels",
              widgets={"template": label, "negative_template": ""})
    wf.link(cs[-1], "context", asm, "context")
    wf.link(cs[-1], "context", lab, "context", via=wf.route(
        (2500, n + 30), (2500, n + 680), (3090, n + 680), (3090, n + 610)))
    wf.link(asm, "prompt", cln, "prompt")
    wf.link(asm, "negative", cln, "negative")

    # Image
    wf.add("WP_Note", (3720, y0 + 50), (780, 200), title=f"{title} · image", widgets={
        "wp_note": note_value(image_note, tone="icon", icon="image", color="neutral")})
    pos = add("CLIPTextEncode", (3720, n), (400, 160), title="Positive")
    neg = add("CLIPTextEncode", (3720, n + 200), (400, 160), title="Negative")
    lat = add("EmptyLatentImage", (3720, n + 400), (400, 110),
              widgets={"width": 832, "height": 1216, "batch_size": 1})
    ks = add("KSampler", (4180, n), (320, 280), widgets={
        "seed": ks_seed, "control_after_generate": "fixed", "steps": 28, "cfg": 5.5,
        "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1})
    dec = add("VAEDecode", (4180, n + 340), (320, 50))
    clip_row = wf.route((TRUNK["CLIP"], lane), (3692, lane), after=trunks["CLIP"][2])
    for enc, src, dy in ((pos, "prompt", 0), (neg, "negative", 200)):
        wf.link(trunks["CLIP"][0], trunks["CLIP"][1], enc, "clip",
                via=wf.route((3692, n + 40 + dy), after=clip_row))
        wf.link(cln, src, enc, "text")
    tap(wf, trunks["MODEL"], ks, "model", (TRUNK["MODEL"], lane + 12), (4152, lane + 12),
        (4152, n + 40))
    tap(wf, trunks["VAE"], dec, "vae", (TRUNK["VAE"], lane + 24), (4164, lane + 24),
        (4164, n + 372))
    wf.link(pos, "CONDITIONING", ks, "positive")
    wf.link(neg, "CONDITIONING", ks, "negative")
    wf.link(lat, "LATENT", ks, "latent_image")
    wf.link(ks, "LATENT", dec, "samples", via=wf.route(
        (4516, n + 30), (4516, n + 310), (4176, n + 310), (4176, n + 370)))
    if seeds:
        sl = add("WP_SeedList", (4180, n + 460), (320, 390), widgets={
            "base_seed": ks_seed, "control_after_generate": "randomize", "count": seeds})
        wf.link(loop, "loop_config", sl, "loop_config", via=wf.route(
            (508, n + 60), (508, lane + 48), (4140, lane + 48), (4140, n + 490)))
        wf.link(sl, "seed", ks, "seed", via=wf.route(
            (4532, n + 490), (4532, n + 420), (4172, n + 420), (4172, n + 150)))

    # Pick and grid
    wf.add("WP_Note", (4600, y0 + 50), (1080, 200), title=f"{title} · pick the frames", widgets={
        "wp_note": note_value(
            "The run **pauses** here. Click the frames you want on the sheet, then "
            "**Continue** (or **Keep all**). Each keeps its label for the grid. Press **?** "
            "above the node for its keys and modes.\n\n"
            "[WP Image Filter](docs:wp-image-filter){button pi-filter}",
            tone="icon", icon="filter", color="tip",
            bookmark=view(5420, y0 + 760, 0.5, "", 10 + gi))})
    filt = add("WP_ImageFilter", (4600, n), (500, 430), widgets={"wp_image_filter": FILTER})
    grid_n = add("WP_LabelGrid", (5160, n), (520, 490), widgets={"wp_label_grid": grid})
    save = add("SaveImage", (5740, n), (1000, 1040), widgets={"filename_prefix": prefix})
    # The run pauses at the Image Filter: the picks (and their labels, carried
    # on extra_1) go on to the sheet.
    wf.link(dec, "IMAGE", filt, "images", via=wf.route((4550, n + 370), (4550, n + 40)))
    wf.link(lab, "prompt", filt, "extra_1", via=wf.route(
        (3640, n + 610), (3640, lane + 36), (4570, lane + 36), (4570, n + 200)))
    wf.link(filt, "images", grid_n, "images")
    wf.link(filt, "extra_1", grid_n, "labels")
    wf.link(grid_n, "grid", save, "images")
    return {"loop": loop, "minfo": minfo, "head": head[-1], "asm": asm, "lab": lab,
            "cln": cln, "ks": ks}


def left_column(wf: Workflow, start: str, start_h: float, *, mode_y: float) -> None:
    """Start here, the Pick a mode note and the mode switch, top to bottom."""
    wf.add("WP_Note", (-1260, 0), (620, start_h), title="Start here", widgets={
        "wp_note": note_value(start, tone="icon", icon="flag",
                              bookmark=start_view(-1260, 620, start_h))})
    wf.add("WP_Note", (-1260, mode_y), (620, 190), title="Pick a mode", widgets={
        "wp_note": note_value(
            "**Pick one**: switching a mode on switches the others off, and each row mutes its "
            "own canvas group, so only the picked group runs. The checkpoint below feeds "
            "all three rows along the lines on the left.\n\n"
            "[WP Toggles](docs:wp-toggles){button pi-sliders-h}",
            tone="icon", icon="sliders-h", color="violet",
            bookmark=view(-950, mode_y + 360, 0.7, "", 4))})


def sets_and_stories() -> None:
    wf = Workflow(stable_uuid("4 - Sets and stories"))
    start = (
        "### Sets and stories\n\n"
        "One **Run** makes a set of images from one loop. Three ways to run it, one row each; "
        "**WP Toggles · pick a mode** (below) switches the other two off. Each row reads "
        "left to right: **Lists**, **Prompt**, **Image**, **Pick and grid**.\n\n"
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
        "Info** in each row sets the quality words: Illustrious / NoobAI by default, Pony's "
        "score tags, none for Flux. Add your style to the template.\n\n"
        ":pi-lock: Want this for your own lists? [Keep something the same](docs:howto-keep-steady)"
        "{button pi-lock} explains **Hold across run**, the switch the photo shoot and the "
        "storyboard lean on." + LINKS_FOOTER)
    left_column(wf, start, 1140, mode_y=1240)
    wf.add("WP_Toggles", (-1260, 1460), (560, 230), title="WP Toggles · pick a mode",
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
    ckpt = wf.add("CheckpointLoaderSimple", (-1260, 1760), (560, 100),
                  widgets={"ckpt_name": "sd_xl_base_1.0.safetensors"})
    trunks = bus(wf, ckpt, {"MODEL": ("MODEL", 1786), "CLIP": ("CLIP", 1798),
                            "VAE": ("VAE", 1810)})

    for gi, (gtitle, gcolor) in enumerate(GROUPS):
        salt = f"sets-{gi}"
        if gi == 0:
            contexts = [
                ("WP Context · Person", 1, [photo.render(False), photo.person()]),
                ("WP Context · Wardrobe and place", 2, [photo.location(), photo.wardrobe()]),
                ("WP Context · Light and camera", 3,
                 [photo.lighting(), photo.camera(), photo.direction()]),
            ]
            kw = dict(loop_values={"seed": 11, "count": 8, "wp_context_loop_config": loop_config()},
                      prompt=photo.PROMPT, label="$age $gender · $place",
                      grid=grid_config("Every frame different", label=True, columns=4),
                      text=("A **Context Loop** of 8 frames. Nothing is held, so every frame "
                            "rolls the whole chain again: a new person, outfit, place, light "
                            "and shot.\n\n"
                            "[WP Context Loop](docs:wp-context-loop){button pi-replay}"),
                      prompt_note=("One prompt per frame. The labels Assembler under the "
                                   "Cleaner writes `$age $gender · $place` for the sheet."),
                      image_note=("**WP Seed List** gives each frame its own sampler seed, "
                                  "following the loop."),
                      seeds=8)
        elif gi == 1:
            cam = photo.camera(hold_film=True)
            shot = cam.children[0]
            assert isinstance(shot, Module) and shot.name == "Shot"
            order = ["wide shot", "full body", "cowboy shot", "upper body",
                     "portrait", "close-up"]
            shot.iteration_overrides = {
                str(i): {"enabled_options": [shot.option_id(v)]} for i, v in enumerate(order)
            }
            contexts = [
                ("WP Context · Person (held)", 4, [photo.render(False), photo.person(hold=True)]),
                ("WP Context · Wardrobe and place (held)", 5,
                 [photo.location(hold=True), photo.wardrobe(hold=True),
                  photo.lighting(hold=True)]),
                ("WP Context · Shot list", 6, [cam, photo.direction()]),
            ]
            kw = dict(loop_values={"seed": 21, "count": 6, "wp_context_loop_config": loop_config()},
                      prompt=photo.PROMPT, label="$shot",
                      grid=grid_config("Photo shoot: one person, six shots", label=True,
                                       columns=3),
                      text=("Every row in the first two Contexts has **Hold across run** on "
                            "(the pin icon): one person, outfit, place and light for the whole "
                            "set.\n\nThe *Shot* row has a pick **per frame** (Edit frame chips "
                            "#1 to #6 in the Shot list Context): wide, full body, three "
                            "quarter, waist up, head and shoulders, close-up. Pose and "
                            "expression still roll each frame.\n\n"
                            "[Per-iteration overrides](docs:iteration-overrides){button pi-images}"),
                      prompt_note="The labels Assembler writes `$shot`, so the sheet names "
                                  "each frame's framing.",
                      image_note="The sampler seed is **fixed**, so the face drifts less "
                                 "between shots.",
                      seeds=None)
        else:
            film = photo.held(photo.film)
            contexts = [
                ("WP Context · Person (held)", 7, [photo.render(False), photo.person(hold=True)]),
                ("WP Context · Story and wardrobe", 8, [
                    Bundle("Story", "#b06634", [stories.story, stories.story_outfit_rule],
                           scope=photo.S),
                    photo.held_all(Bundle("Wardrobe", "#c08a3e",
                                          [photo.gender_outfit_rule, photo.outfit,
                                           photo.accessories, photo.shoes],
                                          scope=photo.S))]),
                ("WP Context · Beats", 9, [
                    Bundle("Beats", "#b06634", [stories.beats()], scope=photo.S),
                    Bundle("Camera", "#5a7fc9", [photo.lens_from_shot, film, photo.framing_rule],
                           scope=photo.S)]),
            ]
            kw = dict(loop_values={"seed": 31, "count": 6, "wp_context_loop_config": loop_config()},
                      prompt=stories.STORY_PROMPT, label="$beat_title",
                      grid=grid_config("Storyboard", label=True, columns=3),
                      text=("A held **Story** picks one of four scripts for the run. **Beats** "
                            "is a derivation: *IF $story is … AND $iteration is 3* it writes "
                            "that frame's action, place, light, shot and expression. The gala "
                            "story changes outfit at the first beat.\n\n"
                            "[Derivation](docs:derivation){button pi-share-alt} "
                            "[Seeds & loops](docs:seeds-and-loops){button pi-refresh}"),
                      prompt_note="The labels Assembler writes `$beat_title`, so the sheet "
                                  "reads as the story, in order.",
                      image_note="Person and wardrobe are held and the sampler seed is "
                                 "**fixed**, so the same people carry the story.",
                      seeds=None)
        mode_row(wf, gi, title=gtitle, color=gcolor, muted=MUTE if gi != 2 else 0,
                 trunks=trunks, contexts=contexts, salt=salt, negative=photo.NEGATIVE,
                 cleaner=CLEANER, ks_seed=42 + gi,
                 prefix=f"wp-examples/{gtitle.lower().replace(' ', '-')}", **kw)

    wf.save(OUT / "4 - Sets and stories.json", (0.16, 1500, 500))


if __name__ == "__main__":
    import core_workflows

    core_workflows.build_all()
    print("wrote", OUT)
