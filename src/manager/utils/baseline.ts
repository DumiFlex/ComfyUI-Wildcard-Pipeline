/**
 * Test Runner baselines: a stored snapshot of one run that later runs are
 * compared against, so an edit to a module shows up as "these seeds now
 * produce something different".
 *
 * A baseline keeps the output variable's value for each of the first
 * `TRACK_LIMIT` seeds (seed N is deterministic, so the same stack gives the
 * same value), the value distribution of every variable, and the warnings.
 * It lives in the scenario row's opaque `baseline` column.
 */
import type { ScenarioRunResponse, ScenarioSeedSpec } from "../api/types";

/** Seeds whose tracked output a run returns and a baseline keeps. */
export const TRACK_LIMIT = 1000;
/** Values kept per variable in a baseline's distributions. */
export const BASELINE_VALUE_LIMIT = 50;
/** A value's share has to move this many points to count as shifted. */
export const SHIFT_POINTS = 5;

export interface BaselineVariable {
  counts: Record<string, number>;
  distinct: number;
  /** Runs whose value isn't in `counts` (trimmed tail). */
  other: number;
}

export interface ScenarioBaseline {
  version: 1;
  saved_at: string;
  seed_spec: ScenarioSeedSpec;
  /** The tracked seeds, in run order; `outputs[i]` belongs to `seeds[i]`. */
  seeds: number[];
  runs: number;
  failed: number;
  output_var: string | null;
  outputs: (string | null)[];
  variables: Record<string, BaselineVariable>;
  warnings: { type: string; message: string; count: number }[];
}

export function parseBaseline(raw: unknown): ScenarioBaseline | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<ScenarioBaseline>;
  if (b.version !== 1 || !Array.isArray(b.seeds) || !Array.isArray(b.outputs) || typeof b.variables !== "object") {
    return null;
  }
  return b as ScenarioBaseline;
}

/** Variables a run should track so it can be compared with `baseline`. */
export function trackVars(outputVar: string | null, baseline: ScenarioBaseline | null): string[] {
  const out = new Set<string>();
  if (outputVar) out.add(outputVar);
  if (baseline?.output_var) out.add(baseline.output_var);
  return [...out];
}

export function makeBaseline(
  result: ScenarioRunResponse,
  outputVar: string | null,
  seedSpec: ScenarioSeedSpec,
  now = new Date(),
): ScenarioBaseline {
  const tracked = result.tracked;
  const variables: Record<string, BaselineVariable> = {};
  for (const [name, v] of Object.entries(result.variables)) {
    const ranked = Object.entries(v.counts).sort((a, b) => b[1] - a[1]);
    const kept = ranked.slice(0, BASELINE_VALUE_LIMIT);
    variables[name] = {
      counts: Object.fromEntries(kept),
      distinct: v.distinct,
      other: v.other + ranked.slice(BASELINE_VALUE_LIMIT).reduce((n, [, c]) => n + c, 0),
    };
  }
  return {
    version: 1,
    saved_at: now.toISOString(),
    seed_spec: { ...seedSpec } as ScenarioSeedSpec,
    seeds: tracked ? [...tracked.seeds] : [],
    runs: result.runs,
    failed: result.failed,
    output_var: outputVar,
    outputs: tracked && outputVar ? [...(tracked.values[outputVar] ?? [])] : [],
    variables,
    warnings: result.warnings.map((w) => ({ type: w.type, message: w.message, count: w.count })),
  };
}

export interface OutputChange { seed: number; before: string | null; after: string | null }

export interface VariableChange {
  name: string;
  status: "new" | "gone" | "changed";
  /** Values that only appear now / only appeared in the baseline. */
  added: string[];
  removed: string[];
  /** Values in both whose share of runs moved by at least SHIFT_POINTS. */
  shifted: { value: string; before: number; after: number }[];
}

export interface BaselineDiff {
  outputVar: string | null;
  /** Tracked seeds present in both runs. */
  compared: number;
  /** Baseline seeds this run didn't cover (different seed spec). */
  uncovered: number;
  /** Both runs used the same seeds. Otherwise only the shared seeds are
   *  compared: distributions and warnings from different seeds would
   *  differ by chance, so they're left out. */
  seedsMatch: boolean;
  changed: OutputChange[];
  variables: VariableChange[];
  warningsAdded: { type: string; message: string; count: number }[];
  warningsGone: { type: string; message: string; count: number }[];
  failed: { before: number; after: number };
  /** Nothing differs on anything compared. */
  same: boolean;
}

function pct(n: number, runs: number): number {
  return runs ? Math.round((n / runs) * 1000) / 10 : 0;
}

function compareVariable(name: string, before: BaselineVariable | undefined, after: BaselineVariable | undefined, runsBefore: number, runsAfter: number): VariableChange | null {
  if (!before) return after ? { name, status: "new", added: Object.keys(after.counts), removed: [], shifted: [] } : null;
  if (!after) return { name, status: "gone", added: [], removed: Object.keys(before.counts), shifted: [] };
  const added: string[] = [];
  const removed: string[] = [];
  const shifted: VariableChange["shifted"] = [];
  // A value missing from a trimmed list may just be in its tail, so absence
  // only counts when that side kept every value.
  for (const value of Object.keys(after.counts)) {
    if (!(value in before.counts)) {
      if (before.other === 0) added.push(value);
      continue;
    }
    const b = pct(before.counts[value], runsBefore);
    const a = pct(after.counts[value], runsAfter);
    if (Math.abs(a - b) >= SHIFT_POINTS) shifted.push({ value, before: b, after: a });
  }
  for (const value of Object.keys(before.counts)) {
    if (!(value in after.counts) && after.other === 0) removed.push(value);
  }
  if (!added.length && !removed.length && !shifted.length) return null;
  shifted.sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before));
  return { name, status: "changed", added, removed, shifted };
}

export function compareToBaseline(baseline: ScenarioBaseline, result: ScenarioRunResponse): BaselineDiff {
  const outputVar = baseline.output_var;
  const now = new Map<number, string | null>();
  const tracked = result.tracked;
  const values = outputVar && tracked ? tracked.values[outputVar] : undefined;
  if (tracked && values) tracked.seeds.forEach((seed, i) => now.set(seed, values[i] ?? null));

  const changed: OutputChange[] = [];
  let compared = 0;
  baseline.seeds.forEach((seed, i) => {
    if (!now.has(seed)) return;
    compared++;
    const before = baseline.outputs[i] ?? null;
    const after = now.get(seed) ?? null;
    if (before !== after) changed.push({ seed, before, after });
  });

  const seedsMatch = compared === baseline.seeds.length && result.runs === baseline.runs;
  const variables: VariableChange[] = [];
  const names = new Set([...Object.keys(baseline.variables), ...Object.keys(result.variables)]);
  for (const name of seedsMatch ? names : []) {
    const d = compareVariable(name, baseline.variables[name], result.variables[name], baseline.runs - baseline.failed, result.runs - result.failed);
    if (d) variables.push(d);
  }

  const key = (w: { type: string; message: string }) => `${w.type}\u0000${w.message}`;
  const beforeW = new Set(baseline.warnings.map(key));
  const afterW = new Set(result.warnings.map(key));
  const warningsAdded = !seedsMatch ? [] : result.warnings.filter((w) => !beforeW.has(key(w))).map((w) => ({ type: w.type, message: w.message, count: w.count }));
  const warningsGone = !seedsMatch ? [] : baseline.warnings.filter((w) => !afterW.has(key(w)));

  const failed = { before: baseline.failed, after: result.failed };
  return {
    outputVar,
    compared,
    uncovered: baseline.seeds.length - compared,
    seedsMatch,
    changed,
    variables,
    warningsAdded,
    warningsGone,
    failed,
    same: seedsMatch && !changed.length && !variables.length && !warningsAdded.length && !warningsGone.length && failed.before === failed.after,
  };
}

/** The seed spec that reruns exactly the baseline's tracked seeds. */
export function baselineSeedSpec(baseline: ScenarioBaseline): ScenarioSeedSpec {
  return { list: [...baseline.seeds] };
}

/** Rail summary of a comparison, stored in the scenario's `last_run`. */
export interface BaselineStatus { same: boolean; changed: number; compared: number }

export function baselineStatus(diff: BaselineDiff): BaselineStatus {
  return { same: diff.same, changed: diff.changed.length, compared: diff.compared };
}

export interface DiffSegment { text: string; kind: "same" | "add" | "del" }

/** Word-level diff of two outputs (whitespace kept with each word), for
 *  showing what changed on a seed. Long texts fall back to whole-value. */
export function wordDiff(before: string, after: string, maxTokens = 400): DiffSegment[] {
  const a = before.match(/\s*\S+\s*/g) ?? (before ? [before] : []);
  const b = after.match(/\s*\S+\s*/g) ?? (after ? [after] : []);
  if (a.length > maxTokens || b.length > maxTokens) {
    return [
      ...(before ? [{ text: before, kind: "del" as const }] : []),
      ...(after ? [{ text: after, kind: "add" as const }] : []),
    ];
  }
  // LCS table over tokens (trimmed, so spacing changes don't count).
  const n = a.length;
  const m = b.length;
  const eq = (i: number, j: number) => a[i].trim() === b[j].trim();
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = eq(i, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  // Collect token runs first, then trim whitespace off the ends of each
  // changed run so the highlight covers words, not the spaces around them.
  const runs: DiffSegment[] = [];
  const push = (text: string, kind: DiffSegment["kind"]) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += text;
    else runs.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(i, j)) { push(b[j], "same"); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push(a[i], "del"); i++; }
    else { push(b[j], "add"); j++; }
  }
  while (i < n) push(a[i++], "del");
  while (j < m) push(b[j++], "add");

  const out: DiffSegment[] = [];
  const emit = (text: string, kind: DiffSegment["kind"]) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  for (const r of runs) {
    if (r.kind === "same") { emit(r.text, "same"); continue; }
    const lead = r.text.match(/^\s*/)?.[0] ?? "";
    const trail = r.text.slice(lead.length).match(/\s*$/)?.[0] ?? "";
    emit(lead, "same");
    emit(r.text.slice(lead.length, r.text.length - trail.length), r.kind);
    // A deleted run's trailing space is dropped: whatever follows brings
    // its own, and the struck-through text is spaced by CSS.
    if (r.kind === "add") emit(trail, "same");
  }
  return out;
}
