/**
 * Autocomplete trigger probe for the rich-text editor.
 *
 * Pure helper (no DOM): given the raw text of the caret's text span and the
 * caret offset within it, scan backwards through identifier characters to the
 * nearest `$` / `@` trigger and decide whether the autocomplete popover should
 * open. Extracted from RichTextInput so the `$$` disambiguation is unit-tested.
 */
export interface AutocompleteProbe {
  /** Index of the trigger char (`$` / `@`) in `str`. */
  start: number;
  /** The identifier typed after the trigger, up to the caret. */
  query: string;
  trigger: "$" | "@";
}

/**
 * `$$` is overloaded: it is BOTH the literal-`$` escape AND the multi-pick
 * delimiter in `{N$$sep$$…}`. A genuine `$name` / `@{` token start is the
 * UNPAIRED tail of an odd run of the trigger char; a paired run (`$$`, `$$$$`)
 * is an escape/delimiter and must NOT open the popover. So:
 *   `$x`        → run 1 (odd)  → trigger        (a var)
 *   `$$x`       → run 2 (even) → no trigger      (escape + literal `x`)
 *   `…$$$style` → run 3 (odd)  → trigger        (delimiter `$$` + `$style`)
 * This lets a `$var` branch that abuts the `$$sep$$` delimiter
 * (`{3$$,$$$style}`) still surface the var autocomplete.
 */
export function probeAutocomplete(str: string, caret: number): AutocompleteProbe | null {
  let i = caret - 1;
  // SP2a: skip a trailing `.K` list accessor (digits then ONE dot, only when a
  // word char precedes the dot) so `$mood.0<caret>` still resolves back to the
  // `$` trigger and keeps the popover open.
  let j = i;
  while (j >= 0 && /[0-9]/.test(str[j])) j--;
  if (j < i && j >= 1 && str[j] === "." && /[A-Za-z0-9_]/.test(str[j - 1])) {
    i = j - 1;
  }
  while (i >= 0 && /[a-zA-Z0-9_]/.test(str[i])) i--;
  if (i < 0) return null;
  const trigger = str[i];
  if (trigger !== "$" && trigger !== "@") return null;
  if (str[i + 1] === trigger) return null; // caret is mid-run (`$|$`), not a token start
  // Parity of the consecutive trigger-char run ending at `i`: odd = real token
  // start, even = the tail of an escape/delimiter pair.
  let runStart = i;
  while (runStart > 0 && str[runStart - 1] === trigger) runStart--;
  if ((i - runStart + 1) % 2 === 0) return null;
  return { start: i, query: str.slice(i + 1, caret), trigger };
}
