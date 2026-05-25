# WP Prompt Cleaner

Cleans up the final assembled prompt string. Drops duplicate tags, strips orphan punctuation, filters blocklisted words. No context input — operates purely on the prompt + your widget config.

## How to use

1. Connect the **prompt** input to any STRING source (typically a WP Prompt Assembler output).
2. Pick an **intensity** preset (gentle / balanced / aggressive).
3. Optionally toggle individual rules on/off, or click **Blocklist…** to add filtered words.
4. Connect the **prompt** output downstream (CLIP encoder, preview, etc.).

The widget shows the cleaned word/character counts + per-rule "what got dropped" stats after each run.

## Mode

- **tags** — split input on commas. Each segment is treated as a tag. Most rules operate per-tag.
- **text** — treat the whole prompt as prose. Tag-only rules (dedupe, fuzzy) no-op; whitespace / punctuation / blocklist still apply.

## Intensity presets

| Preset | Rules |
|---|---|
| gentle | whitespace |
| balanced | whitespace, punctuation, tag dedupe |
| aggressive | whitespace, punctuation, tag dedupe, fuzzy dedupe |

Blocklist auto-enables when its entries are non-empty (regardless of intensity).

## Rules

- **whitespace** — collapse runs of spaces, trim outer whitespace, collapse double commas (`,,` → `,`), drop leading/trailing commas, normalize `,xxx` → `, xxx` in tags mode.
- **punctuation** — drop tags that are only punctuation (e.g. lone `.`), strip leading/trailing punctuation from each tag (tags mode) or from the whole string (text mode).
- **tag dedupe** — drop later occurrences of an identical tag (case-insensitive, leftmost wins). Tags mode only.
- **fuzzy dedupe** — drop near-duplicate tags via Levenshtein similarity ≥ 0.9 (e.g. `pixie cut` / `pixie cuts`). Tags mode only.
- **blocklist** — drop tags containing any blocklist entry (word-boundary, case-insensitive). Click the Blocklist… button to edit.

Click any rule row to toggle it on/off for this node. An amber pip next to the label means you've diverged from the intensity preset's default; the **CUSTOM** badge in the header lights up while any override is active. Click an intensity button to reset.

## Blocklist modal

Two modes inside the modal:

- **list** — comma- or newline-separated entries. Each entry is matched as a word-boundary substring (case-insensitive). `cat` drops the tag `black cat` but not `catcher`.
- **regex** — one regex per line. Each pattern is compiled with `IGNORECASE`. Bad patterns are skipped and shown in the run report errors.

In tags mode, the whole matching tag is dropped. In text mode, only the matched word is removed (with adjacent orphan punctuation/space scrubbed).

## When it's useful

- **Stray commas after wildcards resolve to empty.** Aggressive intensity strips the leftover `,` artifacts.
- **Duplicate tags from manual + wildcard injection.** Tag dedupe collapses them.
- **Negative prompts you want kept short.** Blocklist drops the words you don't want surfacing.
- **Typo / plural collisions.** Fuzzy dedupe catches `pixie cut` / `pixie cuts`.

## Tips

- All rules are deterministic — same input + same config → byte-identical output.
- The node is `not_idempotent` so it re-runs every queue (matches WP_Context / WP_Debug behavior).
- Word/character counts are reported back via the `executed` event and refresh after each run.
- The widget has tooltips on every control — hover to see what each rule does.
