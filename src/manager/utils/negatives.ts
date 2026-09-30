import { toIdentifier } from "./slug";

/**
 * Send-to-negative (schema v8) helpers shared by the library editors.
 *
 * A negative is library content: wildcard options, fixed values and combines
 * carry an optional `negative` string. An EMPTY negative is stored as an
 * ABSENT key — never `""` — so `schemaVersionForPayload` only stamps v8 when a
 * negative is really there and an untouched payload stays byte-identical.
 */

/** True for a missing, empty or whitespace-only negative. */
export function isBlankNegative(v: string | null | undefined): boolean {
  return typeof v !== "string" || v.trim() === "";
}

/** Write `value` as `target.negative`, deleting the key when it is blank. */
export function setNegative(target: { negative?: string }, value: string | null | undefined): void {
  if (typeof value !== "string" || isBlankNegative(value)) delete target.negative;
  else target.negative = value;
}

/** Drop a blank `negative` key from every row (save-time normalisation). */
export function pruneBlankNegatives<T extends { negative?: string }>(rows: T[]): T[] {
  for (const r of rows) if ("negative" in r && isBlankNegative(r.negative)) delete r.negative;
  return rows;
}

/** Bulk "Add to each": append `words` to an existing negative with `, `. */
export function appendNegative(existing: string | null | undefined, words: string): string {
  const add = words.trim();
  const cur = (existing ?? "").trim();
  if (!add) return cur;
  if (!cur) return add;
  return `${cur.replace(/,\s*$/, "")}, ${add}`;
}

/** One library module that files a negative under a variable. */
export interface VarNegativeSource {
  moduleId: string;
  moduleName: string;
  kind: "wildcard" | "fixed_values" | "combine" | "derivation";
  /** Distinct non-blank negative texts, in payload order. */
  texts: string[];
  /** Wildcard only: how many options the wildcard has, so a card can say
   *  "2 of 5 options" — which text rides along depends on the pick. */
  optionCount?: number;
  /** Wildcard only: how many of those options carry a negative. */
  optionsWithNegative?: number;
}

interface CatalogRowLike {
  id: string;
  name: string;
  type: string;
  payload?: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strip$(v: unknown): string {
  return typeof v === "string" ? v.replace(/^\$+/, "").trim() : "";
}
function pushText(texts: string[], v: unknown): void {
  if (typeof v !== "string" || isBlankNegative(v)) return;
  const t = v.trim();
  if (!texts.includes(t)) texts.push(t);
}

/**
 * The library's negatives for `$varName`: every module that binds the name
 * AND carries negative text for it (wildcard options, the fixed value row,
 * a combine's own negative, a derivation "Add to negative" action).
 *
 * The library has no execution order, so this is "what COULD ride along",
 * not a roll — the combine editor shows it as a read-only Carries line.
 */
export function libraryVarNegatives(
  catalog: readonly CatalogRowLike[],
  varName: string,
  excludeId?: string,
): VarNegativeSource[] {
  const want = strip$(varName);
  if (!want) return [];
  const out: VarNegativeSource[] = [];
  for (const m of catalog) {
    if (excludeId && m.id === excludeId) continue;
    const p = asRecord(m.payload);
    const texts: string[] = [];
    let optionCount: number | undefined;
    let optionsWithNegative: number | undefined;
    if (m.type === "wildcard") {
      const binding = strip$(p.var_binding) || toIdentifier(m.name);
      if (binding !== want) continue;
      const opts = asArray(p.options);
      optionCount = opts.length;
      optionsWithNegative = 0;
      for (const o of opts) {
        const neg = asRecord(o).negative;
        if (typeof neg === "string" && !isBlankNegative(neg)) optionsWithNegative++;
        pushText(texts, neg);
      }
    } else if (m.type === "fixed_values") {
      for (const row of asArray(p.values)) {
        const r = asRecord(row);
        if (strip$(r.name) === want) pushText(texts, r.negative);
      }
    } else if (m.type === "combine") {
      if (strip$(p.output_var) !== want) continue;
      pushText(texts, p.negative);
    } else if (m.type === "derivation") {
      for (const rule of asArray(p.rules)) {
        const r = asRecord(rule);
        const actions = [
          ...asArray(r.branches).map((b) => asRecord(asRecord(b).action)),
          asRecord(asRecord(r.else).action),
        ];
        for (const a of actions) {
          if (a.mode === "negative" && strip$(a.target_var) === want) pushText(texts, a.value);
        }
      }
    } else {
      continue;
    }
    if (texts.length) {
      out.push({
        moduleId: m.id,
        moduleName: m.name,
        kind: m.type as VarNegativeSource["kind"],
        texts,
        ...(optionCount !== undefined ? { optionCount, optionsWithNegative } : {}),
      });
    }
  }
  return out;
}
