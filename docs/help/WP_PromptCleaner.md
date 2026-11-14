# WP Prompt Cleaner

Tidy a prompt before the sampler: drop duplicate tags and stray commas, remove empty brackets, merge stacked weights, tidy LoRA tags and block words you never want. It needs no Context.

<!-- video:start -->
▶ **Video:** [WP Prompt Cleaner in depth](https://youtu.be/pxq0d4rCO8c) · [All node videos](https://www.youtube.com/playlist?list=PLD9orcFSB7nI)
<!-- video:end -->

<!-- fields:start -->
## Inputs and outputs

- **prompt (in)** `STRING`: The text to clean, usually from a WP Prompt Assembler. Any text works.
- **cleaner widget**: Pick a mode and a preset, switch single rules on or off, and edit the blocklist. After a run it shows how many fixes each rule made, and the Last run strip opens the run's before and after with what each rule changed and why.
- **negative (in)** `STRING`: Optional. A negative to clean too: type it or wire in the Assembler's negative. Left empty, the negative output is empty.
- **prompt (out)** `STRING`: The cleaned prompt, for CLIP Text Encode.
- **blocklist (in)** `STRING`: Optional text from another node, such as one shared word list feeding several cleaners. Its entries join the panel's blocklist (comma- or newline-separated in list mode, one per line in regex mode) and turn the blocklist on; the Blocklist button reads + input. Its dot sits beside that button and shows when you hover it or wire it.
- **negative (out)** `STRING`: The cleaned negative, using the negative column's rules. Wire it into your negative CLIP Text Encode.
<!-- fields:end -->

## How to use

1. Wire a prompt into **prompt**.
2. Pick a mode and a preset.
3. Switch single rules on or off if you like, and click **Blocklist…** to block words.
4. Wire the output into CLIP Text Encode.

## Mode

- **tags**: for comma-separated tag lists. Rules work tag by tag.
- **text**: for sentences. Duplicate removal is off, and the blocklist removes just the word.

## Presets

| Preset | Rules |
|---|---|
| gentle | spaces and commas only (`blurry, , lowres` becomes `blurry, lowres`) |
| balanced | empty brackets, LoRA spacing, spaces, punctuation, duplicate tags |
| aggressive | all of balanced, plus merge weights and near-duplicates (`a knight`, `knight` and `knights` keep the first; tags 90% alike letter by letter, the same tag at another weight too) |

**CUSTOM** shows when you've switched rules away from the preset; click the preset again to go back.

## Bracket and LoRA rules

These read brackets the way ComfyUI does and work in both modes.

- **empty groups**: removes brackets with nothing inside, such as `()` or `(:1.2)`. `red (), dress` becomes `red, dress`. Usually left by a weighted reference that printed nothing.
- **merge weights**: folds stacked weights into one: `((a:1.1):1.2)` becomes `(a:1.32)`, `(((a)))` becomes `(a:1.33)`, `(a:1.0)` becomes `a`. Only when the inner group is the whole of the outer one; `[ ]` is never touched.
- **LoRA spacing**: `< lora : x : 0.8 >` becomes `<lora:x:0.8>`, and `girl<lora:x:1>` becomes `girl <lora:x:1>`. Also lyco, locon, hypernet and `<embedding:…>`. File names are never changed.

Escaped `\(` `\)` stay as they are, and if the brackets don't balance these rules leave the prompt alone.

## Blocklist

- **list**: words separated by commas or new lines. Capitals don't matter, and whole words only: `cat` removes `black cat` but not `catcher`.
- **regex**: one pattern per line, capitals don't matter. A broken pattern is skipped and named in the run stats.

In tags mode the whole tag with the word goes; in text mode just the word. Never block a LoRA's trigger words.

## Cleaning the negative

With a negative wired in, the rule list gets a second column for it. It follows the prompt column, except near-duplicates and the blocklist are off. **Drop negative tags also in prompt** (off by default) removes a word from the negative when the prompt asks for it; either way the Last run strip names the overlap on an amber line.

## Tips

- Hover a rule for what it does.
- After a run, the count next to each rule shows what it removed.
- Each rule runs once, in list order, on what the rule before left, so a rule can show 0 because an earlier one already fixed it.
- Duplicate removal never touches `BREAK` or `AND`, and punctuation keeps emoticon tags such as `:3` and `-_-`.
