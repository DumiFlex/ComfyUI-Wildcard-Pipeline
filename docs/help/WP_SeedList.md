# WP Seed List

Emits a list of seeds, one per loop iteration, so a downstream KSampler gets its own seed on every pass. Use it for sampler seeds only: it never changes a prompt.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `base_seed` | `INT` | Starting point for the series. Has `control_after_generate`. Change it for a different batch; keep it to reproduce. |
| `count` | `INT` | How many seeds to emit (1–999). 1 emits a single seed. |
| `strategy` | chips | How the seeds are spread from the base: `hash_index` (default), `sequential` (`base, base+1, …`) or `prime_stride` (large prime jumps). No strategy makes images more or less varied. |
| `override base seed` | switch | With `loop_config` wired, take the base seed from the loop. Off by default. |
| `override count` | switch | With `loop_config` wired, take the count from the loop. Turns on when you connect the wire. |
| `override strategy` | switch | With `loop_config` wired, take the strategy from the loop. Turns on when you connect the wire. |
| `loop_config` | `WP_CONTEXT_LOOP_CONFIG` | Optional. The WP Context Loop's side output. |

## Outputs

| Name | Type | Notes |
|---|---|---|
| `seed` | `INT` (list) | N seeds. ComfyUI runs the downstream node once per seed. |

## How it works

Wire the loop's `loop_config` into this node and its seed list pairs with the loop's prompts by index: frame N's prompt gets seed N. With **override count** on, frames the loop bypasses are left out too, so the sampler runs once per prompt the loop kept.

The toggles are independent, so you can take the loop's count and strategy but keep your own base seed. Disconnecting the wire leaves the toggles as they are, and the widget values are used again.

Every seed is masked to 50 bits, inside the range ComfyUI's randomize button produces, so any seed copied into a plain KSampler reproduces the same image.

## Per-iteration seeds

**Per-iteration seeds** on the node opens the list, where you can lock any iteration to a fixed seed while the rest stay derived. **Prev** locks the seed that iteration used on the last run (it lights up after the first generate). **Lock all**, **Unlock all**, **Copy** and **Paste** (`#N: seed`) work on the whole list.

## Tips

- Prompt seeds and sampler seeds are separate. To reproduce one frame exactly, lock it on the Loop (with its override seed on) and on the Seed List.
- Connected to a chain that expects one seed, a count above 1 still runs the downstream node N times. Set `count` to 1 to stop that without removing the node.
- A fixed sampler seed with varying prompts is a fair comparison too: leave the Seed List out for that.
