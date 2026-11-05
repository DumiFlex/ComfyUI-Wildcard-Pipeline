# WP Var → Choice

Reads a `$variable` from the upstream Context and sends it into a dropdown input: the checkpoint, sampler, scheduler, VAE or a LoRA name. It matches the text against that dropdown's real list first.

<!-- fields:start -->
## On the node

- **context (in)** `context`: The Context that holds the $variable.
- **var_name** `variable`: The $variable to read. The list shows every variable the wired Context has.
- **match** `COMBO`: How close the text must be to an option: exact, loose (the default) or closest. See below.
- **fallback** `COMBO`: A dropdown of the options of the input it's wired into, filled when you connect it. Used when nothing matches or the variable is empty. (first option) means the first option in the list.
- **if_no_match** `COMBO`: use fallback carries on with the fallback and warns you. stop the run stops here and lists some of the options.
- **choice (out)** `any`: Wire it into a dropdown input: ckpt_name, sampler_name, scheduler, vae_name, lora_name and so on. The line under the picker names what it feeds and how many options that has.
<!-- fields:end -->

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
