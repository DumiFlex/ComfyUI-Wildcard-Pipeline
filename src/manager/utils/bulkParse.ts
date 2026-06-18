/**
 * Bulk-paste parsers for the manager bulk editor.
 *
 * Wildcard options — one per line: `value [#tag …] [*N]`.
 *   - `#tag`  adds a sub-category (auto-created in Ungrouped if new).
 *   - `*N`    sets the weight (default 1; integer or decimal).
 *   - Modifiers are TRAILING and order-free: only a contiguous run of `#tag` /
 *     `*N` tokens at the END of the line counts, so a value may contain a
 *     literal `#` mid-text (e.g. `neon #1 sign #vivid` → value "neon #1 sign",
 *     tag "vivid").
 *
 * Fixed values — one per line: `name = value` (first `=` splits).
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
}

const TAG_RE = /^#(\S+)$/;
const WEIGHT_RE = /^\*(\d+(?:\.\d+)?)$/;

/** Parse a single bulk-add option line. Returns null when no value remains
 *  (blank line, or a line that is only modifiers like `#warm`). */
export function parseBulkOptionLine(line: string): ParsedBulkOption | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const toks = trimmed.split(/\s+/);
  const tags: string[] = [];
  let weight = 1;
  let end = toks.length;
  // Walk back from the end consuming trailing #tag / *N modifiers.
  while (end > 0) {
    const t = toks[end - 1];
    const wm = t.match(WEIGHT_RE);
    if (wm) { weight = parseFloat(wm[1]); end--; continue; }
    const tm = t.match(TAG_RE);
    if (tm) { const tag = tm[1]; if (!tags.includes(tag)) tags.unshift(tag); end--; continue; }
    break;
  }
  const value = toks.slice(0, end).join(" ").trim();
  if (!value) return null;
  return { value, tags, weight };
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
    for (const tag of p.tags) {
      const tk = tag.toLowerCase();
      if (!existingTags.has(tk) && !seenNew.has(tk)) { seenNew.add(tk); newTags.push(tag); }
    }
  }
  return { add, duplicates, tagged, weighted, newTags };
}

export interface ParsedFixedValue { name: string; value: string; }

/**
 * Parse `name = value` lines (first `=` splits, so values may contain `=`).
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
    const value = line.slice(eq + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}
