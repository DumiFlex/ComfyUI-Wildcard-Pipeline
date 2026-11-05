# WP Context Loop

Runs the whole chain N times from one Generate. Put it in front of your WP Context: each pass (a **frame**) rolls your wildcards again, so one click gives N different prompts.

<!-- fields:start -->
## On the node

- **seed** `INT`: The loop's own seed. Only used when Override Context seed is on.
- **count** `INT`: How many frames one Generate makes (1–999). 1 switches looping off without unwiring the node.
- **values** `STRING`: Optional text from another node: one frame per line (or per list entry), each writing its line to $iteration_value. The values set the frame count and count follows the last run; with a sweep on, every value runs every combination. Its dot sits beside the iteration variable (beside the values note once wired) and shows when you hover it.
- **Strategy**: hash, sequential or stride: how the frame seeds are worked out when Override Context seed is on. See Seeds & loops.
- **Per-iteration seeds**: The seed each frame will use. Lock single frames, Lock all, Copy / Paste, or Prev to keep the seed a frame used last run. Locks need Override Context seed on.
- **Sweep combinations**: Run every combination of the options you pick instead of random rolls. See below.
- **Edit frame**: The base / #1 #2 … chips. Pick a frame to change just that frame (see Per-iteration overrides). Ctrl-click skips a frame, Alt-click locks its seed.
- **Override Context seed**: On: the loop sets every frame's seed from its own seed, so the batch can be repeated. Off (default): each WP Context keeps its own seed and the loop changes it a little per frame.
- **Iteration var**: The name of the frame-number variable ($iteration). The globe and Σ buttons hide or show $iteration and $iteration_total in the prompt.
- **Bypass loop**: Runs a single frame while the node stays wired.
- **context (out)** `context`: One Context per frame. ComfyUI runs the nodes after it once per frame.
- **loop_config (out)** `WP_CONTEXT_LOOP_CONFIG`: Wire it into a WP Seed List so each frame also gets its own sampler seed.
<!-- fields:end -->

## Frame variables

Each frame sets `$iteration` (1, 2, 3 … up to the count) and `$iteration_total` (the count). They are hidden from the prompt by default; switch their internal flag off in the loop to print them, for example `frame $iteration of $iteration_total`.

The **values** dot sits beside the iteration variable (beside the values note once wired) and shows when you hover it. With **values** wired, each frame also sets `$iteration_value` to its line. It prints by default, so `a picture of $iteration_value` works straight away.

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
