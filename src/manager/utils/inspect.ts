/**
 * Per-kind inspector for one Test Runner stack card: what the module is set
 * up to do (its options, rules, template or values) next to what the last
 * run actually did with it (picks, hits, output distribution).
 *
 * Pure: the drawer renders whatever `inspectItem` returns.
 */
import type { BundleRow, ModuleRow, ScenarioRunResponse } from "../api/types";
import { moduleBinding } from "./scenario";
import { clauseActions } from "../../extension/derivation-conditions";

/** Values listed per variable distribution. */
export const INSPECT_VALUE_LIMIT = 8;

export interface ValueShare { value: string; count: number; pct: number }

export interface Distribution {
  name: string;
  rows: ValueShare[];
  distinct: number;
  /** Runs whose value isn't listed. */
  other: number;
}

export interface WildcardOptionRow {
  id: string;
  value: string;
  weight: number;
  /** Share of the total weight, in percent. */
  weightPct: number;
  /** Times the last run picked it (null when there's no run to read). */
  picks: number | null;
  pickPct: number | null;
  isNull: boolean;
}

export interface WildcardInspect {
  kind: "wildcard";
  binding: string;
  options: WildcardOptionRow[];
  /** Picks the last run made in total (direct and through `@{}` refs). */
  totalPicks: number | null;
  /** Options with weight that the run never picked. */
  neverPicked: number;
}

export interface ConstraintInspect {
  kind: "constraint";
  source: string;
  target: string;
  /** "all later picks", "the next 2 picks", … */
  reach: string;
  rules: number;
  /** Target picks it re-weighted over the whole run (null: no run). */
  hits: number | null;
  runs: number | null;
}

export interface CombineInspect {
  kind: "combine";
  template: string;
  output: string;
  reads: string[];
  fixed: boolean;
  distribution: Distribution | null;
}

export interface DerivationRuleRow { when: string; then: string }

export interface DerivationInspect {
  kind: "derivation";
  rules: DerivationRuleRow[];
  distributions: Distribution[];
}

export interface FixedInspect {
  kind: "fixed_values";
  values: { name: string; value: string }[];
}

export interface BundleChildRow { kind: string; name: string; binding: string; depth: number }

export interface BundleInspect {
  kind: "bundle";
  children: BundleChildRow[];
  distributions: Distribution[];
}

export type Inspect =
  | WildcardInspect
  | ConstraintInspect
  | CombineInspect
  | DerivationInspect
  | FixedInspect
  | BundleInspect;

type Payload = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const round1 = (n: number): number => Math.round(n * 10) / 10;

export function distribution(result: ScenarioRunResponse | null, name: string): Distribution | null {
  const v = result?.variables[name];
  if (!result || !v) return null;
  const total = Math.max(1, result.runs - result.failed);
  const ranked = Object.entries(v.counts).sort((a, b) => b[1] - a[1]);
  const shown = ranked.slice(0, INSPECT_VALUE_LIMIT);
  const hidden = ranked.slice(INSPECT_VALUE_LIMIT).reduce((n, [, c]) => n + c, 0);
  return {
    name,
    rows: shown.map(([value, count]) => ({ value, count, pct: round1((count / total) * 100) })),
    distinct: v.distinct,
    other: v.other + hidden,
  };
}

function inspectWildcard(mod: ModuleRow, result: ScenarioRunResponse | null): WildcardInspect {
  const p = (mod.payload ?? {}) as Payload;
  const raw = Array.isArray(p.options) ? (p.options as Payload[]) : [];
  const counts = result ? result.picks[mod.id] ?? {} : null;
  const totalWeight = raw.reduce((n, o) => n + Math.max(0, num(o.weight, 1)), 0);
  const totalPicks = counts ? Object.values(counts).reduce((n, c) => n + c, 0) : null;
  const options = raw.map((o): WildcardOptionRow => {
    const weight = Math.max(0, num(o.weight, 1));
    const picks = counts ? counts[str(o.id)] ?? 0 : null;
    return {
      id: str(o.id),
      value: str(o.value),
      weight,
      weightPct: totalWeight ? round1((weight / totalWeight) * 100) : 0,
      picks,
      pickPct: picks !== null && totalPicks ? round1((picks / totalPicks) * 100) : picks === null ? null : 0,
      isNull: o.is_null === true,
    };
  });
  return {
    kind: "wildcard",
    binding: moduleBinding(mod),
    options,
    totalPicks,
    neverPicked: totalPicks ? options.filter((o) => o.weight > 0 && o.picks === 0).length : 0,
  };
}

export function reachLabel(select: unknown): string {
  const s = (select ?? {}) as Payload;
  const n = Math.max(1, num(s.count, 1));
  switch (s.mode) {
    case "first": return "the first pick";
    case "next": return n === 1 ? "the next pick" : `the next ${n} picks`;
    case "pick": {
      const k = Array.isArray(s.picks) ? s.picks.length : 0;
      return `${k} chosen pick${k === 1 ? "" : "s"}`;
    }
    default: return "every later pick";
  }
}

function inspectConstraint(mod: ModuleRow, modules: ModuleRow[], result: ScenarioRunResponse | null, uid: string | null): ConstraintInspect {
  const p = (mod.payload ?? {}) as Payload;
  const byId = new Map(modules.map((m) => [m.id, m]));
  const label = (id: unknown): string => {
    const m = byId.get(str(id));
    if (!m) return "a deleted wildcard";
    const b = moduleBinding(m);
    return b ? `$${b}` : m.name;
  };
  const exceptions = Array.isArray(p.exceptions) ? p.exceptions.length : 0;
  const matrix = p.matrix && typeof p.matrix === "object" ? (p.matrix as Record<string, unknown>) : {};
  const cells = Object.values(matrix).reduce<number>(
    (n, row) => n + (row && typeof row === "object" ? Object.keys(row).length : 0), 0,
  );
  // Hits are keyed by module id; a stack uid is accepted too.
  const hits = result ? (result.constraint_hits[mod.id] ?? (uid ? result.constraint_hits[uid] : undefined) ?? 0) : null;
  return {
    kind: "constraint",
    source: label(p.source_wildcard_id),
    target: label(p.target_wildcard_id),
    reach: reachLabel(p.target_select),
    rules: exceptions + cells,
    hits,
    runs: result ? result.runs - result.failed : null,
  };
}

function templateReads(template: string, declared: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(declared)) for (const v of declared) if (typeof v === "string" && v) out.add(v.replace(/^\$/, ""));
  for (const m of template.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(m[1]);
  return [...out];
}

function inspectCombine(mod: ModuleRow, result: ScenarioRunResponse | null, fixed: boolean): CombineInspect {
  const p = (mod.payload ?? {}) as Payload;
  const template = str(p.template);
  const output = moduleBinding(mod);
  return {
    kind: "combine",
    template,
    output,
    reads: templateReads(template, p.input_vars),
    fixed,
    distribution: output ? distribution(result, output) : null,
  };
}

function describeCondition(c: unknown, nested = false): string {
  const cond = (c ?? {}) as Payload;
  // An AND / OR group: `{match: "all"|"any", conditions: [...]}`.
  if (Array.isArray(cond.conditions)) {
    const parts = cond.conditions.map((x) => describeCondition(x, true));
    const joined = parts.join(cond.match === "any" ? " OR " : " AND ");
    return nested && parts.length > 1 ? `(${joined})` : joined;
  }
  const v = str(cond.var).replace(/^\$/, "");
  const op = str(cond.op).replace(/_/g, " ") || "equals";
  const val = cond.value;
  const shown = Array.isArray(val) ? val.map(str).join(", ") : str(val);
  return v ? `$${v} ${op}${shown ? ` "${shown}"` : ""}` : "always";
}

function describeAction(a: unknown): string {
  const act = (a ?? {}) as Payload;
  const target = str(act.target_var).replace(/^\$/, "");
  const mode = str(act.mode);
  const value = str(act.value);
  if (!target) return "no change";
  if (mode === "append") return `$${target} += "${value}"`;
  if (mode === "prepend") return `$${target} = "${value}" + …`;
  if (mode === "negative") return `negative($${target}) += "${value}"`;
  return `$${target} = "${value}"`;
}

/** The variable an action WRITES — none for "Add to negative", which files
 *  words under the variable's negatives and leaves its value alone. */
function writtenTarget(a: unknown): string {
  const act = (a ?? {}) as Payload;
  if (str(act.mode) === "negative") return "";
  return str(act.target_var).replace(/^\$/, "");
}

function inspectDerivation(mod: ModuleRow, result: ScenarioRunResponse | null): DerivationInspect {
  const p = (mod.payload ?? {}) as Payload;
  const rules: DerivationRuleRow[] = [];
  const targets = new Set<string>();
  for (const r of (Array.isArray(p.rules) ? p.rules : []) as Payload[]) {
    const branches = Array.isArray(r.branches) ? (r.branches as Payload[]) : [];
    // A clause's actions read as one THEN: "a; b; c" (THEN ... AND ...).
    const then = (clause: unknown) => clauseActions(clause).map(describeAction).join("; ");
    const collect = (clause: unknown) => {
      for (const a of clauseActions(clause)) {
        const t = writtenTarget(a);
        if (t) targets.add(t);
      }
    };
    branches.forEach((b, i) => {
      rules.push({ when: `${i ? "else if" : "if"} ${describeCondition(b.condition)}`, then: then(b) });
      collect(b);
    });
    const els = r.else as Payload | undefined;
    if (els?.action) {
      rules.push({ when: "else", then: then(els) });
      collect(els);
    }
  }
  return {
    kind: "derivation",
    rules,
    distributions: [...targets].map((t) => distribution(result, t)).filter((d): d is Distribution => d !== null),
  };
}

function inspectFixed(mod: ModuleRow): FixedInspect {
  const p = (mod.payload ?? {}) as Payload;
  const values = (Array.isArray(p.values) ? (p.values as Payload[]) : []).map((v) => ({
    name: str(v.name).replace(/^\$/, ""),
    value: str(v.value),
  }));
  return { kind: "fixed_values", values };
}

function inspectBundle(bundle: BundleRow, result: ScenarioRunResponse | null): BundleInspect {
  const children: BundleChildRow[] = [];
  const walk = (list: unknown[], depth: number): void => {
    for (const c of list as Payload[]) {
      if (!c || typeof c !== "object") continue;
      const meta = (c.meta ?? {}) as Payload;
      const name = str(c.name) || str(meta.name) || str(c.id);
      const kind = str(c.type) || "module";
      if (kind === "bundle") {
        children.push({ kind, name, binding: "", depth });
        if (Array.isArray(c.children)) walk(c.children, depth + 1);
        continue;
      }
      const binding = moduleBinding({ type: kind, name, payload: c.payload } as Pick<ModuleRow, "type" | "name" | "payload">);
      children.push({ kind, name, binding, depth });
    }
  };
  walk(bundle.children ?? [], 0);
  const seen = new Set<string>();
  const distributions: Distribution[] = [];
  for (const c of children) {
    if (!c.binding || seen.has(c.binding)) continue;
    seen.add(c.binding);
    const d = distribution(result, c.binding);
    if (d) distributions.push(d);
  }
  return { kind: "bundle", children, distributions };
}

/**
 * Inspect stack item `index`. `result` is only read when its layout still
 * matches the item (the stack may have changed since the run).
 */
export function inspectItem(
  item: { kind: string; id: string; fixedText?: boolean },
  index: number,
  modules: ModuleRow[],
  bundles: BundleRow[],
  result: ScenarioRunResponse | null,
): Inspect | null {
  const layout = result?.stack.find((s) => s.index === index);
  const run = layout && layout.id === item.id ? result : null;
  if (item.kind === "bundle") {
    const b = bundles.find((x) => x.id === item.id);
    return b ? inspectBundle(b, run) : null;
  }
  const mod = modules.find((m) => m.id === item.id);
  if (!mod) return null;
  switch (mod.type) {
    case "wildcard": return inspectWildcard(mod, run);
    case "constraint": return inspectConstraint(mod, modules, run, layout?.uids[0] ?? null);
    case "combine": return inspectCombine(mod, run, !!item.fixedText);
    case "derivation": return inspectDerivation(mod, run);
    case "fixed_values": return inspectFixed(mod);
    default: return null;
  }
}
