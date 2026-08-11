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
export interface TagWordProbe {
  /** Raw-text offset the word starts at — where a commit splices from. */
  start: number;
  query: string;
}

/** A caret sitting inside a model reference the user is part-way through. */
export interface ModelRefProbe {
  /** Where the NAME starts — after the marker, so a commit replaces only the
   *  path and leaves `<lora:` / `embedding:` in place. */
  start: number;
  /** The path typed so far. May contain spaces, dots and separators: model
   *  filenames routinely have all three. */
  query: string;
  /** Which source to search. A reference names one kind by construction, so
   *  offering the other — or offering tags — is offering something that cannot
   *  be inserted here. */
  kind: "lora" | "embedding";
}

/** `<lora:` and `embedding:`, lower-cased for matching. */
const LORA_OPEN = "<lora:";
const EMBED_OPEN = "embedding:";

/**
 * The model reference the caret is inside, if any.
 *
 * Takes precedence over {@link probeTagWord}, and exists because that probe
 * cannot describe a filename. Its word class stops at any character outside
 * `[a-zA-Z0-9_'-]`, so a caret at the end of
 * `embedding:style\lazyhand-e12c.safetensors` walked back only as far as the
 * dot and searched for `safetensors` — matching every model on disk and
 * nothing the user meant. Real names carry dots, path separators and spaces
 * (`8.0-sprite pixel art style by skormino`), none of which a character class
 * can bound.
 *
 * So the bound comes from the SYNTAX instead: everything between the marker
 * and the caret. Unambiguous, and it works for names no character class could
 * describe.
 *
 * Scanning stops at the characters that cannot appear inside a reference — a
 * comma, a newline, or a closing `>` — so a completed `<lora:x>` earlier in the
 * prompt cannot claim a caret that is now somewhere else entirely.
 */
export function probeModelRef(str: string, caret: number): ModelRefProbe | null {
  if (caret <= 0 || caret > str.length) return null;
  const lower = str.slice(0, caret).toLowerCase();

  let markerAt = -1;
  let kind: "lora" | "embedding" = "lora";
  const loraAt = lower.lastIndexOf(LORA_OPEN);
  const embedAt = lower.lastIndexOf(EMBED_OPEN);
  if (loraAt > embedAt) {
    markerAt = loraAt;
    kind = "lora";
  } else if (embedAt >= 0) {
    markerAt = embedAt;
    kind = "embedding";
  }
  if (markerAt < 0) return null;

  const start = markerAt + (kind === "lora" ? LORA_OPEN.length : EMBED_OPEN.length);
  const between = str.slice(start, caret);
  // Anything that closes or separates means the caret has left the reference.
  if (/[,\n>]/.test(between)) return null;
  // A LoRA's weight follows a second colon; a caret past it is editing the
  // number, not the name.
  if (kind === "lora" && between.includes(":")) return null;
  return { start, query: between, kind };
}

/**
 * The bare word at the caret, for the optional booru-tag autocomplete.
 *
 * Unlike `probeAutocomplete` there is no trigger character to key off, so this
 * has to be conservative about when it fires at all:
 *
 * - **Never over a `$` or `@` token.** Those belong to the sigil probe, and a
 *   second popover competing for the same caret is the one behaviour this
 *   feature must not introduce. Callers should only reach here when
 *   `probeAutocomplete` returned null; the check below is the second lock.
 * - **A minimum length**, because firing on one or two characters means a
 *   popover on essentially every keystroke.
 *
 * Word characters include `_` since booru tags are underscore-joined, plus `'`
 * and `-` which appear inside real tags (`cat's_cradle`, `t-shirt`). A space
 * ends the word: multi-word queries are handled by typing underscores, which
 * is how the tags themselves are written.
 */
export function probeTagWord(
  str: string,
  caret: number,
  minLength = 3,
): TagWordProbe | null {
  if (caret <= 0 || caret > str.length) return null;
  let i = caret - 1;
  while (i >= 0 && /[a-zA-Z0-9_'-]/.test(str[i])) i--;
  const start = i + 1;
  const query = str.slice(start, caret);
  if (query.length < minLength) return null;
  // A sigil immediately before the word means this is `$foo` / `@foo` and the
  // other probe owns it. Also covers `{$foo` and similar, since we only look
  // at the single preceding character.
  const preceding = start > 0 ? str[start - 1] : "";
  if (preceding === "$" || preceding === "@") return null;
  // A digit-only run is a weight or a count, not a tag prefix.
  if (/^[0-9]+$/.test(query)) return null;
  return { start, query };
}

export function probeAutocomplete(str: string, caret: number): AutocompleteProbe | null {
  // NB: the `@{uuid#name}` brace form is an INTERNAL serialisation, never
  // something the user types — they type `@name` and pick from the popover,
  // which inserts the chip. Wildcards are addressed by variable binding, not
  // display name, so a query never contains spaces either: a space is the
  // settle delimiter that commits the chip. The bare-identifier scan below is
  // therefore the whole story; an earlier attempt to also accept partial
  // `@{…` runs and spaces was fixing a misdiagnosis (the real bug was that
  // deletion never re-probed — see `onHostKeydown`'s Backspace branch).
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
