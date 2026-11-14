# WP Model Info

Names the loaded checkpoint so your rules can branch on it. Writes three variables into the Context:

<!-- video:start -->
▶ **Video:** [WP Model Info in depth](https://youtu.be/QWK6l4IMCD4) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

- `$model_family`: the architecture, read from the model itself (`sd15`, `sdxl`, `flux`, `sd3`, …).
- `$model_variant`: the fine-tune line, read from the file name by the variant rules (`pony`, `illustrious`, `noobai`, `animagine`, or empty when nothing matches).
- `$model_name`: the file name without folders or extension.

Pony and Illustrious are both SDXL underneath, so only the file name can tell them apart.

<!-- fields:start -->
## Inputs and outputs

- **upstream (in)** `context`: An existing Context to extend. Only nodes after Model Info see its variables, so it usually goes first.
- **model (in)** `MODEL`: The MODEL from your checkpoint loader. Gives the family, and the node follows the wire back to the loader for the file name, stepping over LoRA loaders and other model patches.
- **family, variant, name (in)** `STRING`: Optional text from another node, such as a switch that names the model you're testing. A wired value beats the pin and detection (an empty one is ignored); a wired name goes through the variant rules like the loader's. The row shows wired, and its value after a run. Each input's dot sits beside its row, like a built-in widget's, and shows when you hover the row or wire it.
- **Detected**: The three values and where each comes from. Variant and name update as soon as you change the loader's checkpoint; the family shows after the first run.
- **Globe**: Whether the variable can print. All three start hidden: rules and constraints read them, but the Assembler leaves them out. Click the globe to print one.
- **Pin**: Use your own value for a row instead of the detected one: a file name when no model is wired, or a variant to try your Pony rules without switching checkpoint. Click it again to go back to detection.
- **Variant rules**: Rows of variant and pattern. The first pattern found in the file name sets $model_variant, and its row lights up. Capitals don't matter; | separates alternatives (pony|pdxl). A broken row is outlined in red and skipped. Reset brings back the built-in rules.
- **context (out)** `context`: The upstream Context plus the three variables.
<!-- fields:end -->

## How to use

1. Wire **Load Checkpoint → MODEL** into **model**, and Model Info's **context** into your first WP Context.
2. Branch on `$model_variant` in a derivation. The derivation editor's **LoRA by model** button adds a ready-made rule that sets `$loras` per variant; put `$loras` in your Assembler template.
3. To drive a **constraint** from the model, make a wildcard (say "Model") with options `pony` and `illustrious`, and in its node settings set **Match variable** to `model_variant`. It then picks the option equal to the detected variant, and any constraint can use it as its source.

## Tips

- If a node that loads LoRAs from the prompt sits on the model, take MODEL from **before** it, or the graph loops.
- A wildcard set to **Match variable** uses its fallback option when no option matches; without one it rolls as usual and WP Debug says why.
- WP Debug's trace shows each value and where it came from (model, loader, rules, pinned or wired).
