"""The Story pack: four short photo stories of six beats each.

A held `$story` picks the script for the run; the Beats derivation reads
`$story` AND `$iteration` (the Context Loop's frame number) and writes the
frame's beat, place, light, shot and expression. Outfit changes only at a
scene break, as a storyboard would.
"""

from __future__ import annotations

from packs import Module, O, all_of, branch, constraint, derivation, eq, put, rule, wildcard
from photo import S, outfit

# (title, beat, place, light, shot, expression, outfit or "")
Beat = tuple[str, str, str, str, str, str, str]

STORIES: dict[str, tuple[str, list[Beat]]] = {
    "A day in the city": ("city", [
        ("Morning coffee", "holding a coffee cup with both hands",
         "by the window of a quiet corner café", "soft morning window light",
         "wide environmental", "a sleepy smile", ""),
        ("Crossing", "walking across a busy crosswalk", "on a busy city street",
         "bright midday sun with crisp shadows", "full-body", "a confident gaze", ""),
        ("Record shop", "flipping through vinyl records", "in a cramped record shop",
         "warm tungsten shop light", "waist-up", "a delighted grin", ""),
        ("Rooftop", "leaning on a railing, the skyline behind", "on a rooftop terrace",
         "warm low sun, long shadows", "three-quarter length", "a thoughtful, distant look", ""),
        ("Night market", "eating street food from a paper tray", "at a crowded night market",
         "neon signs and string lights", "waist-up", "a wide, genuine laugh", ""),
        ("Last train", "resting their head against the window", "on an empty late-night train",
         "cool fluorescent light", "close-up portrait", "eyes half closed, content", ""),
    ]),
    "Weekend in the mountains": ("mountain", [
        ("Arrival", "carrying a backpack up to a wooden cabin", "outside a cabin in a pine forest",
         "soft overcast light", "wide environmental", "a relieved smile", ""),
        ("The trail", "hiking up a rocky trail", "on a steep mountain trail",
         "dappled sunlight through pines", "full-body", "focused, slightly out of breath", ""),
        ("Summit", "arms raised at the summit", "on a mountain summit above the clouds",
         "bright high-altitude sun", "full-body", "a triumphant laugh", ""),
        ("Lake", "sitting on a rock with bare feet in the water", "by a still alpine lake",
         "warm low sun, long shadows", "three-quarter length", "a calm, neutral look", ""),
        ("Campfire", "warming their hands over a campfire", "at a campfire under the pines",
         "flickering firelight on the face", "waist-up", "a soft smile", ""),
        ("Morning mist", "wrapped in a blanket with a steaming mug", "on the cabin porch",
         "pale blue morning mist", "head-and-shoulders", "a peaceful look", ""),
    ]),
    "A rainy Sunday": ("home", [
        ("Waking up", "stretching in bed under white sheets", "in a bright bedroom",
         "grey rainy-day window light", "wide environmental", "a lazy yawn", ""),
        ("Reading", "curled up with a book on the window seat", "by a rain-streaked window",
         "soft window light", "three-quarter length", "absorbed, a slight frown", ""),
        ("Cooking", "stirring a pot on the stove", "in a cosy kitchen",
         "warm practical kitchen lights", "waist-up", "humming, eyes half closed", ""),
        ("A call", "laughing on a phone call", "on a worn leather sofa",
         "warm lamp light", "head-and-shoulders", "a wide, genuine laugh", ""),
        ("Dancing", "dancing alone in socks on the kitchen floor", "in a cosy kitchen",
         "warm lamp light", "full-body", "carefree, eyes closed", ""),
        ("Asleep", "asleep on the sofa with the book on their chest", "on a worn leather sofa",
         "dim blue evening light", "close-up portrait", "peaceful, eyes closed", ""),
    ]),
    "The gala night": ("formal", [
        ("Getting ready", "fastening an earring in front of a mirror",
         "in a hotel room with a lit vanity mirror", "warm vanity bulbs",
         "waist-up", "a focused look", "a silk robe"),
        ("Arrival", "stepping out of a car onto the red carpet", "outside a grand hotel",
         "camera flashes and warm entrance lights", "full-body", "a poised smile", ""),
        ("A toast", "raising a glass of champagne", "in a crowded ballroom",
         "golden chandelier light", "three-quarter length", "a sparkling laugh", ""),
        ("Dance floor", "spinning on the dance floor", "in a crowded ballroom",
         "warm spotlights and bokeh", "full-body", "joyful, head thrown back", ""),
        ("Balcony", "leaning on a stone balustrade, city lights beyond", "on a hotel balcony",
         "cool moonlight and city glow", "head-and-shoulders", "a quiet, wistful look", ""),
        ("Walk home", "walking barefoot with their shoes in one hand", "on an empty street at dawn",
         "pale dawn light", "full-body", "a tired, happy smile", ""),
    ]),
}

story = wildcard(
    "Story", "story",
    [O(name, tags=[tag]) for name, (tag, _) in STORIES.items()],
    desc="Which script this run follows. Held: one story for every frame.",
    hold=True, internal=True, scope=S,
)

story_outfit_rule = constraint(
    "Story → Outfit", story, outfit,
    {"city": {"street": ("boost", 3), "casual": ("boost", 2), "swim": ("exclude", 0),
              "lounge": ("exclude", 0)},
     "mountain": {"outerwear": ("boost", 4), "sport": ("boost", 2), "formal": ("exclude", 0),
                  "swim": ("exclude", 0)},
     "home": {"lounge": ("only", 1), "casual": ("allow", 1)},
     "formal": {"formal": ("only", 1)}},
    desc="Dress for the story: the city wants street clothes, the gala formal wear.", scope=S,
)


def beats() -> Module:
    branches = []
    for name, (_, frames) in STORIES.items():
        for i, (title, beat, place, light, shot, expr, change) in enumerate(frames, start=1):
            acts = [put("beat_title", f"{i}. {title}"), put("beat", beat), put("place", place),
                    put("light", light), put("shot", shot), put("expression", expr)]
            if change:
                acts.append(put("outfit", change))
                acts.append(put("shoes_line", ""))
            branches.append(branch(all_of(eq("story", name), eq("iteration", str(i))), *acts))
    return derivation(
        "Beats", [rule("beats", branches, put("beat_title", "Extra frame"),
                       put("beat", "a candid moment"), put("place", "somewhere along the way"),
                       put("light", "soft natural light"), put("shot", "waist-up"),
                       put("expression", "a soft smile"))],
        desc="One branch per story and frame: IF $story is X AND $iteration is N, write that "
             "frame's beat, place, light, shot and expression. Frames past 6 get the else.",
        scope=S,
    )


STORY_PROMPT = (
    "$head $shot photo of $subject, $build, $skin, $hair, $facial_hair, $eyes, $makeup, "
    "wearing $outfit $shoes_line, $beat, $expression, $place, $light, $lens, $film$tail"
)
