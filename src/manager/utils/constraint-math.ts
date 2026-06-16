// TypeScript MIRROR of engine/modules/_constraint_math.py (SP3). Identical
// semantics, validated against the SAME corpus (tests/fixtures/
// constraint-corpus.json) so Py === TS parity stays a hard guarantee.
//
// One multiply operator at three levels: across an option's matching matrix
// cells (multi-tag), across source picks (multi-pick), and — by the caller —
// across constraints. `exclude` (factor 0) is the absorbing element.

export const EXCLUDE = Symbol("constraint-exclude");

type Rule = { mode?: string; factor?: number };
type Pick = { value: string; tags: string[] };
type Opt = { value: string; tags: string[] };

// Exception pairs are keyed by (source_value, target_value). Use the
// non-printable unit separator so the joined key can never collide even if a
// real value contains a space — mirrors the Python `(s, t)` tuple semantics.
const SEP = "\x1f";

function applyRule(rule: Rule): number | typeof EXCLUDE {
  if (rule.mode === "exclude") return EXCLUDE;
  if (rule.mode === "boost" || rule.mode === "reduce") {
    const f = Number(rule.factor ?? 1);
    return Number.isFinite(f) ? Math.max(0, f) : 1;
  }
  return 1; // allow / unknown -> no weight change
}

export function combineConstraintFactor(
  sourcePicks: Pick[],
  option: Opt,
  matrix: Record<string, Record<string, Rule>>,
  exceptions: Array<Record<string, unknown>>,
): number | typeof EXCLUDE {
  const excByPair = new Map<string, Rule>();
  for (const e of exceptions ?? []) {
    const s = (e.source_value ?? e.source) as string | undefined;
    const t = (e.target_value ?? e.target) as string | undefined;
    if (typeof s === "string" && typeof t === "string") {
      excByPair.set(`${s}${SEP}${t}`, e as Rule);
    }
  }
  const optValue = String(option.value ?? "");
  const optTags = option.tags ?? [];
  let factor = 1;
  for (const p of sourcePicks ?? []) {
    const pValue = String(p.value ?? "");
    const pTags = p.tags ?? [];
    const exc = excByPair.get(`${pValue}${SEP}${optValue}`);
    if (exc) {
      const r = applyRule(exc);
      if (r === EXCLUDE) return EXCLUDE;
      factor *= r;
      continue;
    }
    for (const s of pTags) {
      const row = (matrix ?? {})[s];
      if (!row) continue;
      for (const t of optTags) {
        const rule = row[t];
        if (rule) {
          const r = applyRule(rule);
          if (r === EXCLUDE) return EXCLUDE;
          factor *= r;
        }
      }
    }
  }
  return factor;
}
