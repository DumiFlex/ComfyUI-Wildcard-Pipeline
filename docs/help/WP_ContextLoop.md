# WP Context Loop

Optional power-user node that loops a WP_Context chain N times in a single workflow run, producing N variations.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `seed` | `INT` | Base seed widget. Has `control_after_generate` (randomize / fixed / increment buttons). Right-click → "Convert widget to input" to wire rgthree's Seed (or any INT source) instead. |
| `count` | `INT` | How many iterations. 1 = no loop. |
| `strategy` | chips | How to derive N seeds from base. `hash_index` (default) is independent per-iteration; `sequential` is `base, base+1, …`; `stride` is `base + i × 1,000,003`. |
| `override_seed` | switch | When OFF (default): `seed` is ignored. Downstream WP_Context widget seeds drive each node; loop iteration only adds XOR variation. When ON: `seed` becomes the base; derived N times via `strategy`; replaces downstream widget seeds. |
| `iteration var` | text | Stamps `$<name>` (0..N-1) and `$<name>_total` (N) into each iteration's context. Default `iteration`. |
| `bypass` | switch | Skip the loop. Behaves as `count=1`. |
| Sweep combinations | menu | Run every combination of chosen wildcard options instead of `count` random rolls. See below. |

## Outputs

| Name | Type | Notes |
|---|---|---|
| `context` | `PIPELINE_CONTEXT` (list) | One payload per iteration. ComfyUI auto-iterates downstream nodes per item. |

## How it works

Each iteration runs the downstream chain with a different seed. Locked modules (any wildcard with a locked seed) ignore the loop — they always roll their fixed seed. Everything else varies per iteration.

Concrete example: `count=3`, `override_seed=ON`, `seed=42`, `strategy=sequential` → downstream WP_Context chain runs three times with chain seeds 42, 43, 44. PromptAssembler emits three prompts; KSampler renders three batches; SaveImage writes three files.

## Sweep combinations

Open **Sweep combinations** on the node and switch it on. Pick wildcards from the WP_Context nodes after the loop and tick which of their options to include; one Generate then runs every combination, one frame each. Sweeping `$hair` (red, blonde, black) against `$mood` (calm, joyful, brooding) gives 9 prompts in grid order: the first wildcard changes slowest, the last fastest. Above each wildcard's options, **all** ticks every option, **none** clears them so you can tick just the few you want, and **enabled only** goes back to the wildcard's enabled options.

- **Limit** (default 64, max 999) caps the frames; extra combinations are skipped in order.
- **Hold other picks** (default on) keeps every module you didn't sweep on the same pick across frames, so only the swept wildcards change.
- The menu lists every frame before you run, the button shows the frame count, and `count` follows it.
- Seed locks and bypassed frames follow their combination when you change the sweep (a lock on red + calm stays on red + calm), and go away when that combination no longer runs.
- Each frame pins the swept wildcards like a hand-pinned option: tag axes still roll and constraints they drive still apply downstream.

## Tips

- The `seed` field is a stock ComfyUI INT widget with `control_after_generate` — same randomize / fixed / increment buttons KSampler exposes. Right-click → "Convert widget to input" to swap it for an rgthree Seed wire when you want its UI affordances.
- Set `override_seed=OFF` (default) to let each WP_Context's own widget seed drive that node's rolls; loop iteration still varies results via XOR with `loop_index`. Set `override_seed=ON` to take central control.
- Combine with `$iteration` in your prompt template for variation labels: `"variation $iteration of $iteration_total: ..."`.
- The `bypass` switch collapses the loop to a single run (`count=1`) while keeping the node wired — handy for A/B without rebuilding the graph. Native ComfyUI bypass (Ctrl-B) and mute (Ctrl-M) also work as usual.
