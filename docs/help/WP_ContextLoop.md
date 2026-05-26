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

## Outputs

| Name | Type | Notes |
|---|---|---|
| `context` | `PIPELINE_CONTEXT` (list) | One payload per iteration. ComfyUI auto-iterates downstream nodes per item. |

## How it works

Each iteration runs the downstream chain with a different seed. Locked modules (any wildcard with a locked seed) ignore the loop — they always roll their fixed seed. Everything else varies per iteration.

Concrete example: `count=3`, `override_seed=ON`, `seed=42`, `strategy=sequential` → downstream WP_Context chain runs three times with chain seeds 42, 43, 44. PromptAssembler emits three prompts; KSampler renders three batches; SaveImage writes three files.

## Tips

- The `seed` field is a stock ComfyUI INT widget with `control_after_generate` — same randomize / fixed / increment buttons KSampler exposes. Right-click → "Convert widget to input" to swap it for an rgthree Seed wire when you want its UI affordances.
- Set `override_seed=OFF` (default) to let each WP_Context's own widget seed drive that node's rolls; loop iteration still varies results via XOR with `loop_index`. Set `override_seed=ON` to take central control.
- Combine with `$iteration` in your prompt template for variation labels: `"variation $iteration of $iteration_total: ..."`.
- ComfyUI's native bypass (Ctrl-B) doesn't work on this node — use the `bypass` switch instead. Native mute (Ctrl-M) does work; the chain falls back to single-run with widget seeds.
