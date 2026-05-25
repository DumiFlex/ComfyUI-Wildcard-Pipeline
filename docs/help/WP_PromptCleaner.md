# WP Prompt Cleaner

Drops duplicate tags, strips orphan punctuation, filters blocklisted words. Operates on the prompt string alone — no context input needed.

## Inputs

- **prompt** — STRING from any source (typically a WP Prompt Assembler).

## Output

- **prompt** — the cleaned STRING.

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
| balanced | whitespace, punctuation, tag dedupe |
| aggressive | whitespace, punctuation, tag dedupe, fuzzy dedupe |

Blocklist auto-enables when its entries are non-empty.

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
