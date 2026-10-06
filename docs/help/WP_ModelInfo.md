# WP Model Info

Names the loaded checkpoint so your rules can branch on it. Writes three variables into the Context:

- `$model_family`: the architecture, read from the model itself (`sd15`, `sdxl`, `flux`, `sd3`, …).
- `$model_variant`: the fine-tune line, read from the file name by the variant rules (`pony`, `illustrious`, `noobai`, `animagine`, or empty when nothing matches).
- `$model_name`: the file name without folders or extension.

Pony and Illustrious are both SDXL underneath, so only the file name can tell them apart.

## Inputs

- **upstream** *(optional)*: an existing Context to extend. Only nodes **after** Model Info see its variables, so put it first in the chain.
- **model** *(optional)*: the MODEL from your checkpoint loader. Gives the family, and the node follows the wire back to the loader to read its file name (through LoRA loaders and other model patches).
- **model_name**: type or wire a file name here to use it instead of the loader's.
- **variant_rules**: one `variant: pattern` per line. The first pattern found in the file name sets `$model_variant`. Case-insensitive, `|` separates alternatives, `#` starts a comment.
- **family_override** / **variant_override**: use these instead of what was detected, for example to try your Pony rules without switching checkpoint.

## Outputs

- **context**: the upstream Context plus the three variables.
- **model_family**, **model_variant**, **model_name**: the same values as plain strings, for non-WP nodes.

## How to use

1. Wire **Load Checkpoint → MODEL** into **model**, and Model Info's **context** into your first WP Context.
2. Branch on `$model_variant` in a derivation. The derivation editor's **LoRA by model** button adds a ready-made rule that sets `$loras` per variant; put `$loras` in your Assembler template.
3. To drive a **constraint** from the model, make a wildcard (say "Model") with options `pony` and `illustrious`, and in its node settings set **Match variable** to `model_variant`. It then picks the option equal to the detected variant, and any constraint can use it as its source.

## Tips

- If a node that loads LoRAs from the prompt sits on the model, take MODEL from **before** it, or the graph loops.
- A wildcard set to **Match variable** uses its fallback option when no option matches; without one it rolls as usual and WP Debug says why.
- WP Debug's trace shows each value and where it came from (model, loader, rules, input or override).
