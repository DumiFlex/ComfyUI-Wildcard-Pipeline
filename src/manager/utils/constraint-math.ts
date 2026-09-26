// TypeScript MIRROR of engine/modules/_constraint_math.py (SP3). Identical
// semantics, validated against the SAME corpus (tests/fixtures/
// constraint-corpus.json) so Py === TS parity stays a hard guarantee.
//
// One multiply operator at three levels: across an option's matching matrix
// cells (multi-tag), across source picks (multi-pick), and — by the caller —
// across constraints. `exclude` (factor 0) is the absorbing element.
//
// Tag axes (2026-08). Tags in an `accepts` axis are ALTERNATIVES, not statements
// all true at once, so they fold with `max`. This applies to BOTH ends:
//   - SOURCE: the pick already carries only the rolled winner per axis (the
//     handler collapses it), gated by `axisKinds`.
//   - TARGET: a target option's tags inside an accepts axis (`targetAxes`) fold
//     with max, so the option stays viable when the source allows any of them.
// Everything else still multiplies. Both axis paths are unreachable unless the
// caller passes `axisKinds` / `targetAxes`, so a payload that predates the
// feature folds identically.
//
// `only` (2026-09, linked picks). Turns its row into an allow-list: when the
// source fires, every target WITHOUT a rule of its own in that row is excluded
// — by literal value on an exception, by tag in a matrix row. The `only` rule
// itself weighs 1 (like `allow`); a target with any other rule keeps it. In a
// matrix row an `allow` cell is NOT a mention (editors show it as the empty
// "neutral" state); an `allow` exception is a visible row, so it is. A payload
// with no `only` rule never reaches either gate.

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
  return 1; // allow / only / unknown -> no weight change
}

function rowHasOnly(row: Record<string, Rule>): boolean {
  return Object.values(row).some((r) => r?.mode === "only");
}

/** Fold one source tag against every tag on the option. Classify target tags
 *  fold with product (several separate statements). Tags in a target `accepts`
 *  axis (`targetAxes`: group -> members) fold with max instead — the option
 *  OFFERS them as alternatives, so it stays viable when the source allows ANY
 *  (mirror of the source-side accepts fold; the target's own roll is then
 *  restricted to the allowed members by the caller). A no-rule target tag is
 *  neutral (1). EXCLUDE is absorbing for a classify tag and for a fully-excluded
 *  axis. `targetAxes` is unreachable unless the caller passes it, so a legacy
 *  call folds identically. */
function cellFactor(
  matrix: Record<string, Record<string, Rule>>,
  sourceTag: string,
  optTags: string[],
  targetAxes?: Record<string, string[]>,
): number | typeof EXCLUDE {
  const rawRow = (matrix ?? {})[sourceTag];
  if (!rawRow) return 1;
  // `only` makes the row an allow-list: an option carrying no tag the row
  // mentions is shut out, and an unmentioned accepts-axis member offers 0. A
  // neutral (`allow`) cell is not a mention.
  const hasOnly = rowHasOnly(rawRow);
  const row = hasOnly
    ? Object.fromEntries(Object.entries(rawRow).filter(([, r]) => r && r.mode !== "allow"))
    : rawRow;
  if (hasOnly && !optTags.some((t) => row[t] !== undefined)) return EXCLUDE;
  const unruled = hasOnly ? 0 : 1;
  const axes = targetAxes ?? {};
  const axisOf: Record<string, string> = {};
  for (const [ax, members] of Object.entries(axes)) {
    for (const t of members ?? []) axisOf[t] = ax;
  }
  let factor = 1;
  const axisMembers: Record<string, string[]> = {};
  for (const t of optTags) {
    const ax = axisOf[t];
    if (ax === undefined) {
      const rule = row[t];
      if (rule) {
        const r = applyRule(rule);
        if (r === EXCLUDE) return EXCLUDE;
        factor *= r;
      }
    } else {
      (axisMembers[ax] ??= []).push(t);
    }
  }
  for (const members of Object.values(axisMembers)) {
    let best = 0;
    for (const t of members) {
      const rule = row[t];
      const r = rule ? applyRule(rule) : unruled;
      best = Math.max(best, r === EXCLUDE ? 0 : r);
    }
    // Every alternative this axis offered was excluded → the option drops.
    if (best <= 0) return EXCLUDE;
    factor *= best;
  }
  return factor;
}

export function combineConstraintFactor(
  sourcePicks: Pick[],
  option: Opt,
  matrix: Record<string, Record<string, Rule>>,
  exceptions: Array<Record<string, unknown>>,
  axisKinds?: AxisKinds,
  targetAxes?: Record<string, string[]>,
): number | typeof EXCLUDE {
  const kinds = axisKinds ?? {};
  const tAxes = targetAxes ?? {};
  const excByPair = new Map<string, Rule>();
  for (const e of exceptions ?? []) {
    const s = (e.source_value ?? e.source) as string | undefined;
    const t = (e.target_value ?? e.target) as string | undefined;
    if (typeof s === "string" && typeof t === "string") {
      excByPair.set(`${s}${SEP}${t}`, e as Rule);
    }
  }
  // Source values whose exceptions include an `only`: a target value with no
  // exception of its own is excluded for them. Read off the de-duplicated map
  // so it agrees with the rule that actually applies to each pair.
  const onlySources = new Set<string>();
  for (const [key, rule] of excByPair) {
    if (rule.mode === "only") onlySources.add(key.slice(0, key.indexOf(SEP)));
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
    if (onlySources.has(pValue)) return EXCLUDE;
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
      const r = cellFactor(matrix, s, optTags, tAxes);
      if (r === EXCLUDE) return EXCLUDE;
      factor *= r;
    }

    for (const members of accepts) {
      let best = 0;
      for (const s of members) {
        const r = cellFactor(matrix, s, optTags, tAxes);
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
