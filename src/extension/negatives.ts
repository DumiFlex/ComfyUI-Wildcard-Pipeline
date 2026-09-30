/**
 * Send-to-negative, the frontend half: the TS mirror of `engine/negatives.py`
 * tag handling plus the "follow usage" collection the Assembler runs.
 *
 * The Assembler preview builds its negative line LOCALLY from the preview
 * endpoint's `negatives` table (`{binding: [{text, pick, source}]}`), so the
 * line follows the template as the user types instead of waiting on a
 * round trip. The rules must match the engine's or the preview lies:
 *
 *   - Only variables the POSITIVE template renders contribute (follow usage).
 *     `$x.N` carries pick N's entries (plus whole-value ones), `$x` and
 *     `$x.AXIS` every pick's. A read that renders nothing through an index
 *     carries nothing; an internal (or missing) variable is never read.
 *   - Tags join with dedupe that is paren-aware, case-insensitive, first one
 *     wins, and skips tags the negative template already says.
 *   - `$negatives` marks where the words go. Empty template = just the words;
 *     no slot = appended at the end.
 *
 * Pure module: no DOM, no graph.
 */
import { applyVarAccessor, varAccessorParts, type ResolvedValue } from "../widgets/richTokenize";

export interface NegativeEntry {
  text: string;
  /** Multi-pick slot the entry belongs to; `null` = the whole value. */
  pick: number | null;
  source?: string;
}

/** The preview endpoint's `negatives` table. */
export type NegativesTable = Record<string, NegativeEntry[]>;

/** The reserved slot in the Assembler's negative template. */
export const NEGATIVES_SLOT = "$negatives";
/** Its bare name, for `$` suggestion lists and missing-var scans. */
export const NEGATIVES_VAR = "negatives";

const WEIGHT_WRAP = /^\(+\s*(.*?)\s*(?::\s*[0-9.]+)?\s*\)+$/;
const SLOT_RE = /\$negatives(?![A-Za-z0-9_])/;
const SLOT_RE_G = /\$negatives(?![A-Za-z0-9_])/g;

/** Split on commas that are not inside (), [] or {}. */
export function splitTags(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out.filter((t) => t.length > 0);
}

/** Comparison key: lower-cased, whitespace-collapsed, and a single
 *  `(tag:1.2)` / `((tag))` weight wrap removed. */
export function tagKey(tag: string): string {
  let t = tag.trim().split(/\s+/).join(" ").toLowerCase();
  const m = WEIGHT_WRAP.exec(t);
  if (m && !m[1].includes("(") && !m[1].includes(")")) t = m[1].trim();
  return t;
}

/** Join texts tag by tag, dropping repeats (first wins) and any tag whose
 *  key is in `skip`. */
export function joinUnique(texts: Iterable<string>, skip: Iterable<string> = []): string {
  const seen = new Set<string>();
  for (const s of skip) seen.add(tagKey(s));
  const out: string[] = [];
  for (const text of texts) {
    for (const tag of splitTags(text)) {
      const k = tagKey(tag);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(tag);
    }
  }
  return out.join(", ");
}

export function hasSlot(template: string): boolean {
  return SLOT_RE.test(template ?? "");
}

/** Collapse whitespace and empty comma slots; trim edge commas. */
export function tidy(text: string): string {
  const out = text.replace(/[ \t]{2,}/g, " ").replace(/\s*,(?:\s*,)*\s*/g, ", ");
  return out.trim().replace(/^,+|,+$/g, "").trim();
}

/** Fill the negative template (mirror of engine `render_negative`). */
export function renderNegative(
  template: string,
  collected: string,
  resolveRaw: (text: string) => string,
): string {
  const tpl = template ?? "";
  if (!tpl.trim()) return collected;
  const pieces = tpl.split(SLOT_RE_G);
  const rendered = pieces.map((p) => (p ? resolveRaw(p) : ""));
  const fixed: string[] = [];
  for (const r of rendered) fixed.push(...splitTags(r));
  const words = joinUnique([collected], fixed);
  if (pieces.length === 1) {
    const base = tidy(rendered[0]);
    if (!words) return base;
    return base ? `${base}, ${words}` : words;
  }
  return tidy(rendered.join(words));
}

/** One `$var` read a template made: binding + pick index (`null` = all). */
export interface VarRead {
  name: string;
  index: number | null;
}

// Same accessor grammar the Assembler preview matches: `$x`, `$x.0`,
// `$x.AXIS`, `$x.0.AXIS`, `$x.AXIS.0`. `$$` escapes.
const TEMPLATE_VAR_RE =
  /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)(?:\.(?:\d+(?:\.[A-Za-z_][A-Za-z0-9_]*)?|[A-Za-z_][A-Za-z0-9_]*(?:\.\d+)?))?/g;

/**
 * The reads a positive template makes against `resolved` (the renderable,
 * internal-free variable map). A variable absent from the map renders
 * nothing and is not read (engine: missing var = no read). An index read
 * that renders empty (out of range) is dropped; an axis read keeps its
 * index or `null`.
 */
export function templateReads(template: string, resolved: Record<string, ResolvedValue>): VarRead[] {
  const out: VarRead[] = [];
  if (!template) return out;
  for (const m of template.matchAll(TEMPLATE_VAR_RE)) {
    const { base, index, axis } = varAccessorParts(m[0]);
    if (!Object.prototype.hasOwnProperty.call(resolved, base)) continue;
    if (!axis && index != null && !applyVarAccessor(resolved[base], index)) continue;
    out.push({ name: base, index: index ?? null });
  }
  return out;
}

/** A collected entry, tagged with the variable it came from. */
export interface CollectedEntry extends NegativeEntry {
  binding: string;
}

/** Mirror of engine `entries_for_reads`: order follows the reads, each entry
 *  taken once, `(name, K)` takes pick K plus whole-value entries. */
export function entriesForReads(table: NegativesTable, reads: readonly VarRead[]): CollectedEntry[] {
  const out: CollectedEntry[] = [];
  const seen = new Set<string>();
  for (const { name, index } of reads) {
    const rows = Array.isArray(table[name]) ? table[name] : [];
    rows.forEach((e, i) => {
      if (!e || typeof e !== "object") return;
      const pick = typeof e.pick === "number" ? e.pick : null;
      if (index != null && pick != null && pick !== index) return;
      const key = `${name}\u0000${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...e, text: String(e.text ?? ""), pick: null, binding: name });
    });
  }
  return out;
}

/** One tag of the rendered negative line; `varName` set when the tag came
 *  from a variable's negatives (drives the preview's colour). */
export interface NegativeTag {
  text: string;
  varName?: string;
}

export interface NegativePreview {
  /** The negative the Assembler will output. */
  text: string;
  /** `text` split into tags, the collected ones attributed. */
  tags: NegativeTag[];
  /** Distinct variables that contributed at least one tag. */
  fromVars: string[];
}

/**
 * The Assembler's negative output, computed locally.
 *
 * `resolveRaw` renders the negative template's own text (its `$vars` add
 * their VALUE, never their negatives).
 */
export function buildNegativePreview(opts: {
  template: string;
  negativeTemplate: string;
  resolved: Record<string, ResolvedValue>;
  negatives: NegativesTable;
  resolveRaw: (text: string) => string;
}): NegativePreview {
  const reads = templateReads(opts.template, opts.resolved);
  const entries = entriesForReads(opts.negatives, reads);
  const collected = joinUnique(entries.map((e) => e.text));
  const text = renderNegative(opts.negativeTemplate, collected, opts.resolveRaw);

  // Attribute each collected tag to the first variable that said it.
  const owner = new Map<string, string>();
  for (const e of entries) {
    for (const tag of splitTags(e.text)) {
      const k = tagKey(tag);
      if (!owner.has(k)) owner.set(k, e.binding);
    }
  }
  // Tags the template itself says are the template's, even when a variable
  // also carries them (the engine drops the variable's copy).
  const fixed = new Set<string>();
  const tpl = opts.negativeTemplate ?? "";
  if (tpl.trim()) {
    for (const piece of tpl.split(SLOT_RE_G)) {
      for (const tag of splitTags(piece ? opts.resolveRaw(piece) : "")) fixed.add(tagKey(tag));
    }
  }
  const fromVars = new Set<string>();
  const tags: NegativeTag[] = splitTags(text).map((t) => {
    const k = tagKey(t);
    const varName = fixed.has(k) ? undefined : owner.get(k);
    if (varName) fromVars.add(varName);
    return varName ? { text: t, varName } : { text: t };
  });
  return { text, tags, fromVars: [...fromVars] };
}

const BARE_VAR_RE = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * `$vars` an Assembler's templates use that nothing upstream provides: the
 * prompt template's first, then the negative template's, each once.
 * `$negatives` is reserved in the negative template and never missing;
 * engine `__` names are never reported. Used by the pre-run check.
 */
export function missingAssemblerVars(
  template: string,
  negativeTemplate: string,
  known: Iterable<string>,
): string[] {
  const have = new Set(known);
  const out: string[] = [];
  const scan = (text: string, reserved: ReadonlySet<string>) => {
    for (const m of (text ?? "").matchAll(BARE_VAR_RE)) {
      const name = m[1];
      if (name.startsWith("__") || reserved.has(name) || have.has(name) || out.includes(name)) continue;
      out.push(name);
    }
  };
  scan(template, new Set());
  scan(negativeTemplate, new Set([NEGATIVES_VAR]));
  return out;
}

/** The `$vars` a negative template reads, minus the reserved slot. */
export function negativeTemplateVars(template: string): string[] {
  const out = new Set<string>();
  for (const m of (template ?? "").matchAll(TEMPLATE_VAR_RE)) {
    const { base } = varAccessorParts(m[0]);
    if (base !== NEGATIVES_VAR) out.add(base);
  }
  return [...out];
}
