# WP Var → Choice

Reads a `$variable` from the upstream Context and sends it into a dropdown input: the checkpoint, sampler, scheduler, VAE or a LoRA name. It matches the text against that dropdown's real list first.

## Inputs

| Name | Type | Notes |
|---|---|---|
| `context` | context | Required. From a WP Context. |
| `var_name` | dropdown | Pick from upstream `$vars`. Stored as `"$checkpoint"`. |
| `match` | `exact` / `loose` / `closest` | How close the text must be. Default `loose`. |
| `fallback` | dropdown | The options of the input `choice` is wired into, filled when you connect it. Used when nothing matches or the var is empty. `(first option)` = the first option in the list. |
| `if_no_match` | `use fallback` / `stop the run` | Carry on with the fallback and warn, or stop with a list of options. |

## Output

`choice`: wire it into any dropdown input (`ckpt_name`, `sampler_name`, `scheduler`, `vae_name`, `lora_name`, …). The line under the picker names what it feeds.

## Matching

- **exact**: the text must be an option.
- **loose**: capitals, folders, the extension and `space _ - .` don't matter; then the shortest option that starts with, or contains, the text.
  - `"Euler A"` → `euler_ancestral`
  - `"dpmpp 2m"` → `dpmpp_2m` (not `dpmpp_2m_sde`)
  - `"wai nsfw v14"` → `illustrious/waiNSFW_v14.safetensors`
- **closest**: loose, then the most similar option (forgives typos).

Wired into a switch or another input without a list, the text passes through unchecked.

## Tip

Hide the variable (the globe on its row) so the model name doesn't print in the prompt. Put **WP Model Info** after the loader and your rules can see which model was picked.
