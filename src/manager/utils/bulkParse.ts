/**
 * Bulk-paste parsers for the manager bulk editor.
 *
 * Wildcard options — one per line: `value [#tag …] [*N] [-- negative [#tag …] [*N]]`.
 *   - `#tag`  adds a sub-category (auto-created in Ungrouped if new).
 *   - `*N`    sets the weight (default 1; integer or decimal).
 *   - Modifiers are TRAILING and order-free: only a contiguous run of `#tag` /
 *     `*N` tokens at the END of the line counts, so a value may contain a
 *     literal `#` mid-text (e.g. `neon #1 sign #vivid` → value "neon #1 sign",
 *     tag "vivid").
 *   - ` -- words` gives the option a negative (send-to-negative). The FIRST
 *     ` -- ` splits the line; `#tag` / `*N` modifiers may trail either side,
 *     so `jet black -- blue tint #cool` tags the option `cool`.
 *
 * Fixed values — one per line: `name = value [-- negative]` (first `=`
 * splits the name, then the first ` -- ` splits the negative off the value).
 *
 * Pure + framework-free so it unit-tests without mounting a component and is
 * shared by WildcardEditor (options) + FixedEditor (values).
 */

export interface ParsedBulkOption {
  value: string;
  /** Sub-category tags, `#` stripped, in typed order, de-duped within the line. */
  tags: string[];
  /** Pick weight; defaults to 1. */
  weight: number;
  /** Negative words after ` -- `. Present only when non-empty, so a line
   *  without one parses exactly as before. */
  negative?: string;
}

const TAG_RE = /^#(\S+)$/;
const WEIGHT_RE = /^\*(\d+(?:\.\d+)?)$/;

/** The FIRST ` -- ` (whitespace on the left; whitespace or line end on the
 *  right) splits a line into its value and its negative. */
const NEG_SPLIT_RE = /\s--(?:\s|$)/;

/** Split `text` at the first ` -- `. `negative` is null when there is none. */
export function splitNegative(text: string): { value: string; negative: string | null } {
  const m = NEG_SPLIT_RE.exec(text);
  if (!m) return { value: text, negative: null };
  return { value: text.slice(0, m.index), negative: text.slice(m.index + m[0].length) };
}

/** Consume trailing `#tag` / `*N` tokens off `text`, folding them into
 *  `tags` (typed order, de-duped) and returning the new weight (or the
 *  incoming one when no `*N` is present). */
function stripModifiers(
  text: string,
  tags: string[],
  weight: number,
): { rest: string; weight: number } {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  let end = toks.length;
  const found: string[] = [];
  let w: number | null = null;
  // Walk back from the end consuming trailing #tag / *N modifiers.
  while (end > 0) {
    const t = toks[end - 1];
    const wm = t.match(WEIGHT_RE);
    if (wm) { w = parseFloat(wm[1]); end--; continue; }
    const tm = t.match(TAG_RE);
    if (tm) { if (!found.includes(tm[1])) found.unshift(tm[1]); end--; continue; }
    break;
  }
  for (const tag of found) if (!tags.includes(tag)) tags.push(tag);
  return { rest: toks.slice(0, end).join(" ").trim(), weight: w ?? weight };
}

/** Parse a single bulk-add option line. Returns null when no value remains
 *  (blank line, or a line that is only modifiers like `#warm`). */
export function parseBulkOptionLine(line: string): ParsedBulkOption | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const split = splitNegative(trimmed);
  const tags: string[] = [];
  const left = stripModifiers(split.value, tags, 1);
  let weight = left.weight;
  let negative = "";
  if (split.negative !== null) {
    const right = stripModifiers(split.negative, tags, weight);
    weight = right.weight;
    negative = right.rest;
  }
  const value = left.rest;
  if (!value) return null;
  return negative ? { value, tags, weight, negative } : { value, tags, weight };
}

export function parseBulkOptions(text: string): ParsedBulkOption[] {
  return text
    .split(/\r?\n/)
    .map(parseBulkOptionLine)
    .filter((x): x is ParsedBulkOption => x !== null);
}

export interface BulkOptionsSummary {
  /** Non-duplicate options to actually create, in paste order. */
  add: ParsedBulkOption[];
  /** Lines whose value matches an existing option (or an earlier paste line). */
  duplicates: number;
  /** `add` entries carrying ≥1 tag. */
  tagged: number;
  /** `add` entries with a non-default weight. */
  weighted: number;
  /** `add` entries carrying a negative. */
  withNegative: number;
  /** Tags not already present anywhere — auto-created on commit. De-duped, encounter order. */
  newTags: string[];
}

/**
 * Reconcile parsed options against the current wildcard for the live preview +
 * commit. Value matching + new-tag detection are case-insensitive (mirrors the
 * editor's own dedupe), so pass lower-cased sets.
 */
export function summarizeBulkOptions(
  parsed: ParsedBulkOption[],
  existingValues: ReadonlySet<string>,
  existingTags: ReadonlySet<string>,
): BulkOptionsSummary {
  const add: ParsedBulkOption[] = [];
  let duplicates = 0;
  let tagged = 0;
  let weighted = 0;
  let withNegative = 0;
  const newTags: string[] = [];
  const seenNew = new Set<string>();
  const addedValues = new Set<string>();
  for (const p of parsed) {
    const key = p.value.toLowerCase();
    if (existingValues.has(key) || addedValues.has(key)) { duplicates++; continue; }
    addedValues.add(key);
    add.push(p);
    if (p.tags.length) tagged++;
    if (p.weight !== 1) weighted++;
    if (p.negative) withNegative++;
    for (const tag of p.tags) {
      const tk = tag.toLowerCase();
      if (!existingTags.has(tk) && !seenNew.has(tk)) { seenNew.add(tk); newTags.push(tag); }
    }
  }
  return { add, duplicates, tagged, weighted, withNegative, newTags };
}

export interface ParsedFixedValue {
  name: string;
  value: string;
  /** Negative words after ` -- `; present only when non-empty. */
  negative?: string;
}

/**
 * Parse `name = value [-- negative]` lines (first `=` splits, so values may
 * contain `=`; then the first ` -- ` splits the negative off the value).
 * Blank lines + lines without a `=` (or with an empty name) are skipped. A
 * later line with the same name overrides an earlier one (caller updates in
 * place); we return every line in order and let the caller fold by name.
 */
export function parseBulkFixedValues(text: string): ParsedFixedValue[] {
  const out: ParsedFixedValue[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const split = splitNegative(line.slice(eq + 1).trim());
    const value = split.value.trim();
    const negative = split.negative?.trim() ?? "";
    if (!name) continue;
    out.push(negative ? { name, value, negative } : { name, value });
  }
  return out;
}
