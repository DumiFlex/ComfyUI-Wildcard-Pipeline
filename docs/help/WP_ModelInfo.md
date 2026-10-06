# WP Model Info

Names the loaded checkpoint so your rules can branch on it. Writes three variables into the Context:

- `$model_family`: the architecture, read from the model itself (`sd15`, `sdxl`, `flux`, `sd3`, …).
- `$model_variant`: the fine-tune line, read from the file name by the variant rules (`pony`, `illustrious`, `noobai`, `animagine`, or empty when nothing matches).
- `$model_name`: the file name without folders or extension.

Pony and Illustrious are both SDXL underneath, so only the file name can tell them apart.

## Inputs

- **upstream** *(optional)*: an existing Context to extend. Only nodes **after** Model Info see its variables, so put it first in the chain.
- **model** *(optional)*: the MODEL from your checkpoint loader. Gives the family, and the node follows the wire back to the loader to read its file name (through LoRA loaders and other model patches).

## The widget

- **Detected** shows the three values and where each comes from. The variant and name update as soon as you change the loader's checkpoint; the family needs the loaded model, so it shows after the first run.
- Click the **pin** on a row to use your own value instead, for example a file name when no model is wired, or a variant to try your Pony rules without switching checkpoint. Click it again to go back to detection.
- **Variant rules** are `variant` + `pattern` rows. The first pattern found in the file name sets `$model_variant`, and its row lights up. Case-insensitive, `|` separates alternatives. A broken row is outlined in red and skipped (WP Debug says why). **Reset** puts the shipped rules back.

## Output

- **context**: the upstream Context plus the three variables. To use a value outside the pipeline, put it in an Assembler template (for example `$model_variant` in a file-name prefix).

## How to use

1. Wire **Load Checkpoint → MODEL** into **model**, and Model Info's **context** into your first WP Context.
2. Branch on `$model_variant` in a derivation. The derivation editor's **LoRA by model** button adds a ready-made rule that sets `$loras` per variant; put `$loras` in your Assembler template.
3. To drive a **constraint** from the model, make a wildcard (say "Model") with options `pony` and `illustrious`, and in its node settings set **Match variable** to `model_variant`. It then picks the option equal to the detected variant, and any constraint can use it as its source.

## Tips

- If a node that loads LoRAs from the prompt sits on the model, take MODEL from **before** it, or the graph loops.
- A wildcard set to **Match variable** uses its fallback option when no option matches; without one it rolls as usual and WP Debug says why.
- WP Debug's trace shows each value and where it came from (model, loader, rules or pinned).
