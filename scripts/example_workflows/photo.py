"""The people pack family shared by every example workflow.

One coherent set of lists for people, in plain words any model style reads
(anime, illustration or photo): who (Person), what they
wear and where (Wardrobe, Location), how it is lit and shot (Light, Camera),
what they do (Direction), and how the prompt is written for the model in use
(Render). Each workflow embeds the bundles it needs.

Everyone in these lists is an adult and is described as one.
"""

from __future__ import annotations

from dataclasses import replace

from packs import (
    NULL,
    Bundle,
    Module,
    O,
    any_of,
    branch,
    combine,
    constraint,
    derivation,
    eq,
    has,
    opts,
    put,
    rule,
    wildcard,
)

S = "photo"  # id scope: the same row has the same id in every workflow


def held(m: Module) -> Module:
    """The row with Hold across run on: one pick for every frame of a run."""
    return replace(m, instance={**m.instance, "seed_scope": "hold"})


def held_all(item: Module | Bundle) -> Module | Bundle:
    if isinstance(item, Module):
        return held(item) if item.kind in ("wildcard", "combine", "fixed_values") else item
    return replace(item, children=[held_all(c) for c in item.children])


# ── Person ───────────────────────────────────────────────────────────────

hair_colours = wildcard(
    "Hair colours", "hair_colour",
    opts("jet black", "dark brown", "chestnut", "honey blonde", "platinum blonde",
         "copper red", "auburn", "ash brown", "salt-and-pepper")
    + [O("silver-grey", w=0.5), O("pastel pink", w=0.3)],
    desc="A shared list the Hair options read through @{}. Switched off: it never writes a variable itself.",
    enabled=False, scope=S,
)

gender = wildcard(
    "Gender", "gender",
    [O("woman", w=1, tags=["woman"]), O("man", w=1, tags=["man"])],
    desc="Drives Facial hair, Makeup and Outfit through constraints.", scope=S,
)
age = wildcard(
    "Age", "age",
    opts("23-year-old", "26-year-old", "29-year-old", "32-year-old", "35-year-old",
         "38-year-old", "42-year-old", "46-year-old")
    + opts("53-year-old", "61-year-old", w=0.5),
    desc="Adults only, written as a number.", scope=S,
)
heritage = wildcard(
    "Heritage", "heritage",
    opts("Korean", "Japanese", "Chinese", "Vietnamese", "Indian", "Pakistani", "Nigerian",
         "Ethiopian", "Kenyan", "Brazilian", "Mexican", "Colombian", "Italian", "Spanish",
         "Irish", "Swedish", "Polish", "Greek", "Turkish", "Lebanese", "Egyptian", "Filipino",
         "Indonesian", "Native American")
    + [NULL(w=4)],
    desc="Has a null option, so sometimes nothing is said.", scope=S,
)
build = wildcard(
    "Build", "build",
    opts("slim build", "athletic build", "lean and tall", "average build", "muscular build",
         "soft, rounded figure")
    + opts("curvy figure", "petite frame", tags=["femme"])
    + opts("broad-shouldered", "stocky build", tags=["masc"]),
    scope=S,
)
skin = wildcard(
    "Skin", "skin",
    opts("light freckles across the nose", "sun-kissed skin", "a small beauty mark on the cheek",
         "rosy cheeks", "a light dusting of freckles on the shoulders",
         "a small scar through one eyebrow", "a tattoo sleeve on one arm")
    + [NULL(w=4)],
    desc="One small detail, or nothing (null option).", scope=S,
)
hair = wildcard(
    "Hair", "hair",
    [O(f"short {hair_colours.ref()} pixie cut"), O(f"shoulder-length wavy {hair_colours.ref()} hair"),
     O(f"long straight {hair_colours.ref()} hair"), O(f"a messy {hair_colours.ref()} bun"),
     O(f"curly {hair_colours.ref()} hair"), O(f"a sleek {hair_colours.ref()} bob"),
     O(f"braided {hair_colours.ref()} hair"), O(f"a high {hair_colours.ref()} ponytail"),
     O(f"short cropped {hair_colours.ref()} hair"), O(f"{hair_colours.ref()} hair in a side part"),
     O("a natural afro"), O("box braids"), O("a buzz cut"), O("a shaved head", w=0.4)],
    desc="Reads Hair colours through @{} references.", scope=S,
)
facial_hair = wildcard(
    "Facial hair", "facial_hair",
    [O("light stubble", tags=["masc"]), O("a short beard", tags=["masc"]),
     O("a full beard", tags=["masc"]), O("a neat moustache", w=0.5, tags=["masc"]),
     NULL(w=3)],
    desc="Only a man gets one (constraint with an Only exception).", scope=S,
)
eyes = wildcard(
    "Eyes", "eyes",
    opts("hazel eyes", "deep brown eyes", "grey-green eyes", "blue eyes", "amber eyes",
         "dark eyes", "light green eyes") + [NULL(w=3)],
    scope=S,
)
makeup = wildcard(
    "Makeup", "makeup",
    [O("natural makeup", tags=["natural"]), O("no makeup", tags=["natural"]),
     O("soft rosy blush", tags=["natural"]), O("red lipstick", tags=["bold"]),
     O("winged eyeliner", tags=["bold"]), O("smoky eye makeup", tags=["bold"]),
     O("glossy lips", tags=["natural"]), NULL(w=2)],
    desc="A man gets the null option (Only row). Wide shots drop it: too small to see.", scope=S,
)
facial_hair_rule = constraint(
    "Gender → Facial hair", gender, facial_hair,
    {}, exceptions=[("woman", "", "only", 1)],
    desc="An Only exception: a woman gets only the null option.", scope=S,
)
makeup_rule = constraint(
    "Gender → Makeup", gender, makeup,
    {}, exceptions=[("man", "", "only", 1)], scope=S,
)
build_rule = constraint(
    "Gender → Build", gender, build,
    {"man": {"femme": ("reduce", 0.1)}, "woman": {"masc": ("reduce", 0.3)}}, scope=S,
)
subject = combine(
    "Subject", "subject", "a $age $heritage $gender",
    desc="Builds the person's opening words from three picks.", scope=S,
)


def person(hold: bool = False) -> Bundle:
    b = Bundle("Person", "#c9637a", [
        Bundle("Identity", "#c9637a", [gender, age, heritage, build_rule, build, skin, subject], scope=S),
        Bundle("Look", "#c9637a", [facial_hair_rule, makeup_rule, hair, facial_hair, eyes, makeup], scope=S),
        Bundle("Shared lists", "#8b8b8b", [hair_colours], scope=S),
    ], scope=S)
    return held_all(b) if hold else b  # type: ignore[return-value]


# ── Location ─────────────────────────────────────────────────────────────

place = wildcard(
    "Place", "place",
    [O("in a studio against a plain grey backdrop", tags=["studio"]),
     O("in a studio with a warm beige paper backdrop", tags=["studio"]),
     O("in front of a textured plaster wall in a studio", tags=["studio"]),
     O("in a sunlit loft apartment", tags=["home"]),
     O("in a cosy living room with plants", tags=["home"]),
     O("in a minimalist kitchen", tags=["home"]),
     O("on a rumpled bed in a bright bedroom", tags=["home"]),
     O("on a busy city sidewalk", tags=["urban"]),
     O("in a narrow cobblestone alley", tags=["urban"]),
     O("on a rooftop terrace overlooking the city", tags=["urban"]),
     O("in a retro diner booth", tags=["urban"]),
     O("on a subway platform", tags=["urban"]),
     O("in a quiet café by the window", tags=["urban"]),
     O("in a wildflower meadow", tags=["nature"]),
     O("on a forest trail", tags=["nature"]),
     O("by a mountain lake", tags=["nature"]),
     O("in a desert canyon", tags=["nature"]),
     O("on a sandy beach", tags=["coast"]),
     O("on a wooden pier", tags=["coast"]),
     O("on rocky sea cliffs", tags=["coast"])],
    desc="Tagged studio, home, urban, nature, coast: the tags drive Time and Outfit.", scope=S,
)
time = wildcard(
    "Time of day", "time",
    [O("in the morning", tags=["day"]), O("at midday", tags=["day"]),
     O("on an overcast afternoon", tags=["day"]), O("at golden hour", w=1.5, tags=["golden"]),
     O("at blue hour", tags=["night"]), O("at night", tags=["night"]),
     O("under studio lights", tags=["studio"])],
    desc="A studio has no time of day, so it has an option of its own.", scope=S,
)
place_time_rule = constraint(
    "Place → Time", place, time,
    {"studio": {"studio": ("only", 1)},
     "home": {"studio": ("exclude", 0)},
     "urban": {"studio": ("exclude", 0)},
     "nature": {"studio": ("exclude", 0), "night": ("reduce", 0.3)},
     "coast": {"studio": ("exclude", 0)}},
    desc="A studio only takes the studio option; everywhere else never does.", scope=S,
)

# ── Wardrobe ─────────────────────────────────────────────────────────────

SHOES = ["sneakers", "boots", "heels", "loafers", "sandals", "barefoot",
         "trainers", "ankle-boots"]
outfit = wildcard(
    "Outfit", "outfit",
    [O("a white t-shirt and light-wash jeans", tags=["casual", "sneakers", "boots"]),
     O("an oversized knit sweater and black jeans", tags=["casual", "ankle-boots", "sneakers"]),
     O("a linen shirt and chinos", tags=["casual", "loafers", "sneakers"]),
     O("a denim jacket over a hoodie", tags=["street", "sneakers"]),
     O("a black leather jacket and dark jeans", tags=["street", "boots"]),
     O("cargo pants and a cropped bomber jacket", tags=["street", "sneakers"]),
     O("a tailored charcoal suit", tags=["formal", "loafers"]),
     O("a black slip dress", tags=["formal", "femme", "heels", "sandals"]),
     O("an emerald satin evening gown", w=0.6, tags=["formal", "femme", "heels"]),
     O("a crisp white button-up and pleated trousers", tags=["formal", "loafers", "heels"]),
     O("a floral sundress", tags=["summer", "femme", "sandals", "sneakers"]),
     O("linen shorts and a short-sleeved shirt", tags=["summer", "sandals", "sneakers"]),
     O("a ribbed tank top and a midi skirt", tags=["summer", "femme", "sandals"]),
     O("a black one-piece swimsuit", w=0.6, tags=["swim", "femme", "barefoot"],
       neg="jeans, jacket"),
     O("swim shorts and an open shirt", w=0.6, tags=["swim", "masc", "barefoot"],
       neg="jeans, jacket"),
     O("leggings and a sports bra", tags=["sport", "femme", "trainers"]),
     O("a track jacket and joggers", tags=["sport", "trainers"]),
     O("a long camel wool coat over a turtleneck", tags=["outerwear", "ankle-boots", "loafers"]),
     O("a waxed rain jacket and hiking trousers", tags=["outerwear", "boots"]),
     O("a cosy oversized hoodie and sweatpants", tags=["lounge", "barefoot", "sneakers"]),
     O("a silk robe over pyjamas", w=0.6, tags=["lounge", "barefoot"]),
     O("a plain grey crew-neck sweater and jeans", fb=True,
       tags=["casual", "sneakers", "ankle-boots"])],
    desc="Tags say what each outfit is; the SHOES tags are choices (accepts), printed as $outfit.SHOES. "
         "The grey sweater is the fallback when the rules leave nothing.",
    accepts={"SHOES": SHOES}, scope=S,
)
accessories = wildcard(
    "Accessories", "accessories",
    opts("thin gold hoop earrings", "a silver chain necklace", "round tortoiseshell glasses",
         "a leather watch", "a wide-brim hat", "a silk scarf", "a canvas tote bag",
         "small stud earrings", "aviator sunglasses"),
    desc="Picks 0 to 2 (multi-pick range on this row).",
    pick=(0, 2), scope=S,
)
place_outfit_rule = constraint(
    "Place → Outfit", place, outfit,
    {"coast": {"swim": ("boost", 5), "summer": ("boost", 2), "outerwear": ("exclude", 0),
               "formal": ("reduce", 0.3)},
     "nature": {"sport": ("boost", 2), "outerwear": ("boost", 3), "formal": ("reduce", 0.2),
                "swim": ("exclude", 0)},
     "urban": {"street": ("boost", 2), "swim": ("exclude", 0), "lounge": ("exclude", 0)},
     "home": {"lounge": ("boost", 4), "swim": ("exclude", 0), "outerwear": ("reduce", 0.2)},
     "studio": {"swim": ("reduce", 0.3)}},
    scope=S,
)
gender_outfit_rule = constraint(
    "Gender → Outfit", gender, outfit,
    {"man": {"femme": ("reduce", 0.1)}, "woman": {"masc": ("reduce", 0.2)}},
    desc="Reads Gender from the first Context: a constraint works across nodes.", scope=S,
)
shoes = combine(
    "Shoes line", "shoes_line", "and $outfit.SHOES",
    desc="Reads the shoes rolled with the outfit. Framing hides details empties it in tight shots.",
    scope=S,
)


def location(hold: bool = False) -> Bundle:
    b = Bundle("Location", "#4f9d69", [place, place_time_rule, time], scope=S)
    return held_all(b) if hold else b  # type: ignore[return-value]


def wardrobe(hold: bool = False) -> Bundle:
    b = Bundle("Wardrobe", "#c08a3e",
               [place_outfit_rule, gender_outfit_rule, outfit, accessories, shoes], scope=S)
    return held_all(b) if hold else b  # type: ignore[return-value]


# ── Light ────────────────────────────────────────────────────────────────

light = wildcard(
    "Light", "light",
    [O("soft key light from a large softbox", tags=["studio"]),
     O("Rembrandt lighting", tags=["studio"]),
     O("butterfly lighting", tags=["studio"]),
     O("dramatic rim light on a dark background", tags=["studio"]),
     O("a single hard spotlight with deep shadows", w=0.6, tags=["studio"]),
     O("soft window light", tags=["day", "indoor"]),
     O("open shade, even soft light", tags=["day"]),
     O("dappled sunlight through leaves", tags=["day"]),
     O("bright midday sun with crisp shadows", w=0.6, tags=["day"]),
     O("warm low sun, long shadows", tags=["golden"]),
     O("backlit by the setting sun, lens flare", tags=["golden"]),
     O("glowing golden rim light", tags=["golden"]),
     O("neon signs reflecting on wet pavement", tags=["night", "street"]),
     O("warm street lamps", tags=["night", "street"]),
     O("candlelight and warm practical lamps", tags=["night", "indoor"]),
     O("moonlight and a clear starry sky", tags=["night", "outdoor"]),
     O("cool blue ambient light", tags=["night"])],
    desc="Tagged by when it can happen; Time → Light keeps it believable.", scope=S,
)
time_light_rule = constraint(
    "Time → Light", time, light,
    {"studio": {"studio": ("only", 1)}, "day": {"day": ("only", 1)},
     "golden": {"golden": ("only", 1), "day": ("allow", 1)},
     "night": {"night": ("only", 1)}},
    desc="Only rows: each time of day keeps only the light that fits it.", scope=S,
)


place_light_rule = constraint(
    "Place → Light", place, light,
    {"home": {"street": ("exclude", 0), "outdoor": ("exclude", 0)},
     "nature": {"street": ("exclude", 0), "indoor": ("exclude", 0)},
     "coast": {"street": ("exclude", 0), "indoor": ("exclude", 0)},
     "urban": {"outdoor": ("reduce", 0.3)}},
    desc="A second constraint on the same list: both apply, multiplied.", scope=S,
)


def lighting(hold: bool = False) -> Bundle:
    b = Bundle("Light", "#d4b33a", [time_light_rule, place_light_rule, light], scope=S)
    return held_all(b) if hold else b  # type: ignore[return-value]


# ── Camera ───────────────────────────────────────────────────────────────

SHOTS = [
    ("full body", "full"), ("wide shot", "full"), ("cowboy shot", "half"),
    ("upper body", "half"), ("portrait", "close"), ("close-up", "close"),
]
shot = wildcard(
    "Shot", "shot",
    [O(name, tags=[tag]) for name, tag in SHOTS],
    desc="Framing comes first in the prompt. Tagged full, half, close.", scope=S,
)
angle = wildcard(
    "Angle", "angle",
    opts("eye-level", "slightly low angle", "slightly high angle", "candid, from the side",
         "over-the-shoulder")
    + [NULL(w=3)],
    scope=S,
)
lens = wildcard(
    "Focus", "focus",
    [O("depth of field, blurry background", tags=["tele"]),
     O("bokeh", tags=["tele"]),
     O("sharp focus", tags=["normal"]),
     O("soft focus", tags=["normal"]),
     O("detailed background", tags=["wide"]),
     O("scenery", w=0.5, tags=["wide"])],
    desc="How much of the background shows: tight shots blur it, wide ones show it.", scope=S,
)
shot_lens_rule = constraint(
    "Shot → Focus", shot, lens,
    {"close": {"tele": ("boost", 4), "wide": ("exclude", 0)},
     "half": {"normal": ("boost", 3)},
     "full": {"wide": ("boost", 3), "tele": ("reduce", 0.3)}},
    desc="A blurred background for tight shots, the scenery for the full body.", scope=S,
)
film = wildcard(
    "Palette", "palette",
    [O("warm colours"), O("muted colours"), O("vibrant colours"), O("soft pastel colours"),
     O("high contrast"), O("cool tones"),
     O("monochrome", w=0.5, neg="colourful, saturated"),
     O("natural colours", w=2, neg="oversaturated")],
    desc="Some palettes carry a negative of their own (option negatives).", scope=S,
)
framing_rule = derivation(
    "Framing hides details", [
        rule("framing", [
            branch(any_of(has("shot", "full body"), has("shot", "wide")),
                   put("makeup", ""), put("skin", "")),
        ], put("shoes_line", "")),
    ],
    desc="Wide shots drop makeup and skin detail, tight shots drop the shoes: the camera can't see them.",
    scope=S,
)


lens_from_shot = derivation(
    "Focus from shot", [
        rule("focus", [
            branch(any_of(has("shot", "close-up"), has("shot", "portrait")),
                   put("focus", "depth of field, blurry background")),
            branch(any_of(has("shot", "full body"), has("shot", "wide")),
                   put("focus", "detailed background")),
        ], put("focus", "sharp focus")),
    ],
    desc="When the shot is written by a rule (the storyboard), the focus follows it here.",
    scope=S,
)


def camera(hold_film: bool = False) -> Bundle:
    return Bundle("Camera", "#5a7fc9", [
        shot, angle, shot_lens_rule, lens, held(film) if hold_film else film, framing_rule,
    ], scope=S)


# ── Direction ────────────────────────────────────────────────────────────

pose = wildcard(
    "Pose", "pose",
    [O("standing with hands in pockets", tags=["body"]), O("leaning against a wall", tags=["body"]),
     O("walking towards the camera", tags=["body"]), O("sitting cross-legged", tags=["body"]),
     O("sitting on the ground, knees drawn up", tags=["body"]), O("crouching down", w=0.5, tags=["body"]),
     O("arms crossed", tags=["any"]), O("one hand in their hair", tags=["any"]),
     O("looking back over the shoulder", tags=["any"]), O("chin resting on a hand", tags=["any"]),
     O("adjusting a sleeve", tags=["any"]), O("laughing mid-movement", tags=["any"]),
     O("head tilted slightly", tags=["any"])],
    desc="Body poses need the legs in frame (Shot → Pose).", scope=S,
)
shot_pose_rule = constraint(
    "Shot → Pose", shot, pose,
    {"close": {"body": ("exclude", 0)}, "half": {"body": ("reduce", 0.4)}},
    scope=S,
)
expression = wildcard(
    "Expression", "expression",
    opts("a soft smile", "a wide, genuine laugh", "a calm, neutral look", "a confident gaze",
         "a playful smirk", "a thoughtful, distant look", "eyes closed, relaxed",
         "a shy half-smile", "a serious, intense stare", "raised eyebrows, amused"),
    scope=S,
)


def direction() -> Bundle:
    return Bundle("Direction", "#8d6cc4", [shot_pose_rule, pose, expression], scope=S)


# ── Render (prompt style + settings per model) ───────────────────────────

QUALITY_NEG = "worst quality, low quality, bad anatomy, bad hands, extra digits, watermark, text"
render_style = derivation(
    "Prompt style per model", [
        rule("style", [
            branch(eq("model_variant", "pony"),
                   put("head", "score_9, score_8_up, score_7_up,"), put("tail", ""),
                   put("neg_base", "score_4, score_5, score_6, " + QUALITY_NEG)),
            branch(any_of(eq("model_family", "flux"), eq("model_family", "zimage"),
                          eq("model_family", "qwen_image"), eq("model_family", "hidream"),
                          eq("model_family", "chroma")),
                   put("head", ""), put("tail", ""), put("neg_base", "")),
            branch(eq("model_family", "sd15"),
                   put("head", "best quality,"), put("tail", ""),
                   put("neg_base", QUALITY_NEG)),
        ], put("head", "masterpiece, best quality, amazing quality,"), put("tail", ""),
           put("neg_base", QUALITY_NEG)),
    ],
    desc="Reads $model_variant / $model_family from WP Model Info and writes only quality words, "
         "never a style: Illustrious / NoobAI tags by default, Pony's score tags, nothing for "
         "sentence models (Flux, Z-Image, Qwen). Add your style (anime, photo, painting) to "
         "$head here or in the template.",
    scope=S,
)
render_settings = derivation(
    "Settings per model", [
        rule("settings", [
            branch(eq("model_family", "sd15"),
                   put("size", "512x768"), put("sampler", "dpmpp 2m"), put("cfg", "6")),
            branch(any_of(eq("model_family", "flux"), eq("model_family", "zimage"),
                          eq("model_family", "qwen_image")),
                   put("size", "896x1152"), put("sampler", "euler"), put("cfg", "1")),
            branch(eq("model_variant", "pony"),
                   put("size", "832x1216"), put("sampler", "euler ancestral"), put("cfg", "6")),
        ], put("size", "832x1216"), put("sampler", "euler ancestral"), put("cfg", "5.5")),
    ],
    desc="$size, $sampler and $cfg for the Var nodes. The default suits Illustrious and NoobAI.",
    scope=S,
)


def render(settings: bool = True) -> Bundle:
    kids: list[Module | Bundle] = [render_style]
    if settings:
        kids.append(render_settings)
    return Bundle("Render", "#6b7280", kids, scope=S)


# ── Templates ────────────────────────────────────────────────────────────

LOOK = "$subject, $build, $skin, $hair, $facial_hair, $eyes, $makeup"
PROMPT = (
    "$head $shot, " + LOOK
    + ", wearing $outfit $shoes_line, $accessories, $pose, $expression, $place $time, "
    "$light, $angle, $focus, $palette$tail"
)
NEGATIVE = "$neg_base, $negatives"
