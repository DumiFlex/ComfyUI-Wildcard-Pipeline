# WP Context Loop

Runs the whole chain N times from one Generate. Put it in front of your WP Context: each pass (a **frame**) rolls your wildcards again, so one click gives N different prompts.

## Controls

- **seed**: the base seed, with the usual control after generate. You can convert it to an input and wire any INT.
- **count**: how many frames. 1 means no loop.
- **strategy**: how the frames' seeds are spread from the base. **hash** (default) gives unrelated seeds, **sequential** gives base, base+1, base+2…, **stride** takes large fixed jumps. No strategy makes the images more or less varied.
- **override seed**: off (default) lets each WP Context keep its own seed, and the loop only varies it per frame. On makes the loop's seed the base for every frame, so the whole batch can be reproduced from that one seed. Per-frame seed locks only apply while it is on.
- **iteration var**: the name of the frame counter, `iteration` by default.
- **bypass**: run once without removing the node.
- **Sweep combinations**: run every combination of chosen wildcard options instead of random rolls (see below).

## Outputs

- **context**: one Context per frame. ComfyUI runs the nodes after it once per frame.
- **loop_config**: wire it into a **WP Seed List** so each frame also gets its own sampler seed.

## Frame variables

Each frame sets `$iteration` (1, 2, 3 … up to the count) and `$iteration_total` (the count). They are hidden from the prompt by default; switch their internal flag off in the loop to print them, for example `frame $iteration of $iteration_total`.

## Sweep combinations

Open **Sweep combinations**, switch it on, pick wildcards from the WP Context nodes after the loop and tick the options to include. Sweeping `$hair` (3 options) against `$mood` (3 options) makes 9 frames, one per pair. The first wildcard changes slowest and the last fastest, so it reads like a grid.

- **Limit** (default 64, up to 999) caps the frames.
- **Hold other picks** (default on) keeps everything you didn't sweep the same on every frame.
- The menu lists every frame before you run, and **count** follows it.

## Per-frame control

- **Per-iteration seeds** opens the list of each frame's seed: lock single frames, **Lock all** / **Unlock all**, **Copy** / **Paste**, and **Prev** to lock the seed a frame used on the last run.
- **Edit frame** (the `base / #1 #2 …` chips) lets you give one frame its own settings in the module editors. Ctrl-click a frame chip to skip that frame, Alt-click to lock its seed.

## Tips

- A module with **Lock pick** ignores the loop. **Hold across run** in a module's settings keeps its pick for every frame of one run, then rolls again next run.
- A plain KSampler gets the same seed on every frame. Add a **WP Seed List** if two frames could roll the same prompt.
- More in the manager's docs: WP Context Loop, Seeds & loops, and Per-iteration overrides.
