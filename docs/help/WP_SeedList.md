# WP Seed List

Emits a list of seeds, one per loop iteration, so a downstream KSampler gets its own seed on every pass. Use it for sampler seeds only: it never changes a prompt.

<!-- video:start -->
▶ **Video:** [WP Seed List in depth](https://youtu.be/Se5_0BDex9A) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## On the node

- **base_seed** `INT`: Where the seed list starts. Same base, same seeds.
- **count** `INT`: How many seeds it gives (1–999). Follows the loop's count while Override count from loop is on.
- **Strategy**: hash, sequential (base, base+1 …) or stride. It changes which numbers you get, not how varied the images are.
- **Per-iteration seeds**: Lock single seeds, Lock all, Copy / Paste, or Prev to keep the seed a frame used last run.
- **Override … from loop**: Three switches: take the base seed, the count and the strategy from the wired loop. Count and strategy switch on by themselves when you connect loop_config; base seed stays yours unless you switch it on.
- **loop_config (in)** `WP_CONTEXT_LOOP_CONFIG`: Optional. A WP Context Loop's loop_config output, so the seeds follow its frames.
- **seed (out)** `INT`: The list of seeds, one per frame. ComfyUI runs the node after it once per seed: wire it into a KSampler's seed.
<!-- fields:end -->

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
