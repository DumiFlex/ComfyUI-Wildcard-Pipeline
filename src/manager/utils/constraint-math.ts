// TypeScript MIRROR of engine/modules/_constraint_math.py (SP3). Identical
// semantics, validated against the SAME corpus (tests/fixtures/
// constraint-corpus.json) so Py === TS parity stays a hard guarantee.
//
// One multiply operator at three levels: across an option's matching matrix
// cells (multi-tag), across source picks (multi-pick), and — by the caller —
// across constraints. `exclude` (factor 0) is the absorbing element.
//
// One exception, added 2026-08 (tag axes). Tags belonging to a source group the
// wildcard declared `accepts` are ALTERNATIVES the option offers, not statements
// that are all true at once. Those fold with `max`, so one sibling's `exclude`
// cannot speak for the rest. Everything else still multiplies, and the axis path
// is unreachable unless the caller passes `axisKinds` — so a payload that
// predates the feature folds identically.

export const EXCLUDE = Symbol("constraint-exclude");

type Rule = { mode?: string; factor?: number };
/** `axes` maps an axis name to the pick's own tags on it. Present only when the
 *  source wildcard declared that group `accepts`. */
type Pick = { value: string; tags: string[]; axes?: Record<string, string[]> };
type Opt = { value: string; tags: string[] };
export type AxisKinds = Record<string, string>;

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

/** Fold one source tag against every tag on the option. Product, because an
 *  option sitting on several rows of the same source tag is genuinely several
 *  separate statements about it. EXCLUDE is absorbing. */
function cellFactor(
  matrix: Record<string, Record<string, Rule>>,
  sourceTag: string,
  optTags: string[],
): number | typeof EXCLUDE {
  const row = (matrix ?? {})[sourceTag];
  if (!row) return 1;
  let factor = 1;
  for (const t of optTags) {
    const rule = row[t];
    if (rule) {
      const r = applyRule(rule);
      if (r === EXCLUDE) return EXCLUDE;
      factor *= r;
    }
  }
  return factor;
}

export function combineConstraintFactor(
  sourcePicks: Pick[],
  option: Opt,
  matrix: Record<string, Record<string, Rule>>,
  exceptions: Array<Record<string, unknown>>,
  axisKinds?: AxisKinds,
): number | typeof EXCLUDE {
  const kinds = axisKinds ?? {};
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
    // Partition this pick's tags: those inside an `accepts` axis fold with max,
    // the rest keep multiplying. A pick only carries `axes` when the source
    // wildcard declared the group `accepts`, and `kinds` gates it a second
    // time, so a legacy pick takes the flat path untouched.
    const accepts: string[][] = [];
    const claimed = new Set<string>();
    for (const [axis, members] of Object.entries(p.axes ?? {})) {
      if (kinds[axis] !== "accepts") continue;
      const inAxis = pTags.filter((t) => (members ?? []).includes(t));
      if (inAxis.length > 0) {
        accepts.push(inAxis);
        for (const t of inAxis) claimed.add(t);
      }
    }

    for (const s of pTags) {
      if (claimed.has(s)) continue;
      const r = cellFactor(matrix, s, optTags);
      if (r === EXCLUDE) return EXCLUDE;
      factor *= r;
    }

    for (const members of accepts) {
      let best = 0;
      for (const s of members) {
        const r = cellFactor(matrix, s, optTags);
        // One member's EXCLUDE is that member declining, not the axis
        // declining — it contributes 0 to the max and the siblings still get
        // their say.
        best = Math.max(best, r === EXCLUDE ? 0 : r);
      }
      // Every alternative the option offered was excluded, so the option
      // really does drop out.
      if (best <= 0) return EXCLUDE;
      factor *= best;
    }
  }
  return factor;
}
