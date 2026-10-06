# WP Prompt Cleaner

Drops duplicate tags, strips orphan punctuation, removes empty `()` groups, merges nested weights, tidies LoRA tags and filters blocklisted words. Operates on the prompt string alone — no context input needed.

## Inputs

- **prompt** — STRING from any source (typically a WP Prompt Assembler).
- **negative** — optional STRING (wire-only), e.g. the Assembler's negative output.

## Outputs

- **prompt** — the cleaned STRING.
- **negative** — the cleaned negative (empty when the negative input is unwired).

## Cleaning the negative

The RULES list has a second checkbox column for the negative. Its defaults match the prompt column's (gentle: whitespace only), except fuzzy dedupe and blocklist off, since near-duplicates in a negative are usually deliberate and blocklisted words often belong there. **Drop negative tags also in prompt** (off by default) removes a negative tag the prompt also asks for; either way the run stats name the overlap.

## How to use

1. Wire any STRING output into the prompt input.
2. Pick a mode + intensity in the widget.
3. Optionally toggle individual rules. Click **Blocklist…** to filter specific words.
4. Wire the output to your CLIP encoder / preview.

## Mode

- **tags** — split input on commas. Each segment is a tag.
- **text** — treat input as prose. Tag-only rules (dedupe, fuzzy) are disabled.

## Intensity presets

| Preset | Rules |
|---|---|
| gentle | whitespace |
| balanced | empty groups, LoRA spacing, whitespace, punctuation, tag dedupe |
| aggressive | empty groups, merge weights, LoRA spacing, whitespace, punctuation, tag dedupe, fuzzy dedupe |

Blocklist auto-enables when its entries are non-empty.

## Prompt syntax rules

These read the prompt the way ComfyUI does, and work in both modes.

- **empty groups** — removes brackets with nothing inside: `()`, `[]`, `( , )`, `(:1.2)`, and groups left empty once those go. `red (), dress` → `red, dress`. The usual source is a weighted ref that resolved to nothing: `(@{hat}:1.2)` → `(:1.2)`.
- **merge weights** — folds stacked weights into one group by multiplying them, as ComfyUI does (a bare `( )` counts as 1.1): `((a:1.1):1.2)` → `(a:1.32)`, `(((a)))` → `(a:1.33)`. A weight of 1 is unwrapped: `(a:1.0)` → `a`. Only merges when the inner group is everything inside the outer one (`((a:1.1), b:1.2)` stays), and rounds to 2 decimals. `[ ]` is not a weight in ComfyUI, so it's never merged.
- **LoRA spacing** — `< lora : x : 0.8 >` → `<lora:x:0.8>`, `girl<lora:x:1>smile` → `girl <lora:x:1> smile`. Also covers lyco, locon, hypernet and `<embedding:…>`. Spaces inside a file name stay.

Escaped `\(` `\)` are literal and left alone, LoRA and embedding names are never edited, and if the brackets don't balance the bracket rules leave the prompt exactly as written.

## Blocklist

Click **Blocklist…** to open the editor. Two modes:

- **list** — comma- or newline-separated plain words. Each entry matches as a case-insensitive word-boundary substring. `cat` drops `black cat` but not `catcher`.
- **regex** — one regex per line, compiled with `IGNORECASE`. Bad patterns are skipped (reported in run stats), so one typo won't kill the rule.

What gets dropped:

- **tags mode** — the whole comma-separated tag containing the match. Blocklist `steps` on `cfg, steps . avoid:` drops the entire `steps . avoid:` tag → `cfg`.
- **text mode** — only the matched word is removed; adjacent orphan punctuation/space is scrubbed. Blocklist `steps` on `cfg, steps. avoid` → `cfg, avoid`.

Toggling the rule off via its row in RULES overrides the auto-enable, even with entries present. Toggling it on with no entries does nothing (no patterns to match).

## Tips

- Hover any control for an inline tooltip.
- The **CUSTOM** badge lights up when your toggles diverge from the intensity preset. Click the intensity again to reset.
- Stats next to each active rule show what it dropped on the last run.
