/**
 * Pure helpers for the Test Runner workbench (scenario stacks and run
 * results). No Vue, no API — the view and its panels import these so the
 * logic is unit-testable on its own.
 */
import type {
  BundleRow,
  ModuleRow,
  ModuleType,
  ScenarioRunResponse,
  ScenarioSeedSpec,
  ScenarioStackItem,
  ScenarioValue,
} from "../api/types";
import { toIdentifier } from "./slug";

export type StackKind = ModuleType | "bundle";

/** What a stack card shows for one item, resolved against the library. */
export interface StackItemView {
  kind: StackKind;
  id: string;
  name: string;
  /** The `$var` the item writes (wildcard/combine/derivation), else "". */
  binding: string;
  /** Short one-line detail: "$outfit", "4 values", "3 modules", "hair → mood". */
  detail: string;
  enabled: boolean;
  missing: boolean;
}

export const DEFAULT_SEEDS: ScenarioSeedSpec = { from: 0, count: 100 };

export function isBundleItem(item: ScenarioStackItem): item is { bundle: string; enabled?: boolean } {
  return "bundle" in item && typeof item.bundle === "string";
}

export function itemId(item: ScenarioStackItem): string {
  return isBundleItem(item) ? item.bundle : item.module;
}

/** The `$var` a library module writes, or "" when it writes none / many. */
export function moduleBinding(mod: Pick<ModuleRow, "type" | "name" | "payload">): string {
  const p = (mod.payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/^\$/, "") : "");
  if (mod.type === "wildcard") return str(p.var_binding) || toIdentifier(mod.name);
  if (mod.type === "combine") return str(p.output_var);
  if (mod.type === "derivation") {
    const rules = Array.isArray(p.rules) ? p.rules : [];
    for (const r of rules as { branches?: { action?: { target_var?: unknown } }[] }[]) {
      for (const b of r.branches ?? []) {
        const t = str(b.action?.target_var);
        if (t) return t;
      }
    }
  }
  return "";
}

function moduleDetail(mod: ModuleRow, byId: Map<string, ModuleRow>): string {
  const p = (mod.payload ?? {}) as Record<string, unknown>;
  const binding = moduleBinding(mod);
  if (mod.type === "fixed_values") {
    const n = Array.isArray(p.values) ? p.values.length : 0;
    return `${n} value${n === 1 ? "" : "s"}`;
  }
  if (mod.type === "constraint") {
    const src = byId.get(String(p.source_wildcard_id ?? ""));
    const tgt = byId.get(String(p.target_wildcard_id ?? ""));
    return `${src ? moduleBinding(src) : "?"} → ${tgt ? moduleBinding(tgt) : "?"}`;
  }
  if (mod.type === "derivation") return binding ? `→ $${binding}` : "rules";
  return binding ? `$${binding}` : "";
}

export function describeItem(
  item: ScenarioStackItem,
  modules: ModuleRow[],
  bundles: BundleRow[],
): StackItemView {
  const enabled = item.enabled !== false;
  if (isBundleItem(item)) {
    const b = bundles.find((x) => x.id === item.bundle);
    const n = b?.children?.length ?? 0;
    return {
      kind: "bundle", id: item.bundle, name: b?.name ?? item.bundle, binding: "",
      detail: b ? `${n} module${n === 1 ? "" : "s"}` : "deleted", enabled, missing: !b,
    };
  }
  const byId = new Map(modules.map((m) => [m.id, m]));
  const m = byId.get(item.module);
  if (!m) {
    return {
      kind: "wildcard", id: item.module, name: item.module, binding: "",
      detail: "deleted", enabled, missing: true,
    };
  }
  return {
    kind: m.type, id: m.id, name: m.name, binding: moduleBinding(m),
    detail: moduleDetail(m, byId), enabled, missing: false,
  };
}

/** The variable a scenario treats as its prompt when none is chosen: the
 *  last enabled combine's output, else the last binding in the stack. */
export function defaultOutputVar(views: StackItemView[]): string | null {
  const on = views.filter((v) => v.enabled && !v.missing);
  for (let i = on.length - 1; i >= 0; i--) if (on[i].kind === "combine" && on[i].binding) return on[i].binding;
  for (let i = on.length - 1; i >= 0; i--) if (on[i].binding) return on[i].binding;
  return null;
}

/** A multi-pick renders joined by its separator, like a bare `$name`. */
export function renderValue(v: ScenarioValue | undefined): string {
  if (v === undefined) return "";
  return typeof v === "string" ? v : v.items.join(v.sep);
}

export interface VariableSummary {
  name: string;
  rows: { value: string; count: number; pct: number }[];
  distinct: number;
  other: number;
  internal: boolean;
}

/** Per-variable distributions, sorted by count. Variables that only ever
 *  took one value (fixed values, pins) are split out as `constants` so the
 *  panel can show them compactly. */
export function summarizeVariables(result: ScenarioRunResponse): {
  varying: VariableSummary[];
  constants: { name: string; value: string }[];
} {
  const total = Math.max(1, result.runs - result.failed);
  const varying: VariableSummary[] = [];
  const constants: { name: string; value: string }[] = [];
  for (const [name, v] of Object.entries(result.variables)) {
    const entries = Object.entries(v.counts).sort((a, b) => b[1] - a[1]);
    if (v.distinct === 1 && entries.length === 1) {
      constants.push({ name, value: entries[0][0] });
      continue;
    }
    varying.push({
      name,
      rows: entries.map(([value, count]) => ({ value, count, pct: (count / total) * 100 })),
      distinct: v.distinct,
      other: v.other,
      internal: v.internal,
    });
  }
  return { varying, constants };
}

/** Order variables the way the stack writes them, so panels read top to
 *  bottom like the chain. Unknown names keep their relative order at the end. */
export function orderByStack(names: string[], views: StackItemView[]): string[] {
  const rank = new Map<string, number>();
  views.forEach((v, i) => { if (v.binding && !rank.has(v.binding)) rank.set(v.binding, i); });
  return [...names].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
}

export interface Segment { text: string; varName: string | null }

/** Split a rendered prompt into segments, tagging the parts that came from
 *  another variable's value (first occurrence, longest values first) so the
 *  Outputs panel can color who wrote what. Best effort: a value that isn't
 *  in the prompt, or is shorter than 3 characters, stays plain. */
export function segmentOutput(
  output: string,
  vars: Record<string, ScenarioValue>,
  outputVar: string,
  allowed: Set<string>,
): Segment[] {
  const claims: { start: number; end: number; name: string }[] = [];
  const candidates = Object.entries(vars)
    .filter(([name]) => name !== outputVar && allowed.has(name))
    .map(([name, v]) => [name, renderValue(v)] as const)
    .filter(([, text]) => text.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, text] of candidates) {
    let from = 0;
    while (from <= output.length) {
      const at = output.indexOf(text, from);
      if (at < 0) break;
      const end = at + text.length;
      if (!claims.some((c) => at < c.end && end > c.start)) {
        claims.push({ start: at, end, name });
        break;
      }
      from = at + 1;
    }
  }
  claims.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const c of claims) {
    if (c.start > pos) out.push({ text: output.slice(pos, c.start), varName: null });
    out.push({ text: output.slice(c.start, c.end), varName: c.name });
    pos = c.end;
  }
  if (pos < output.length || !out.length) out.push({ text: output.slice(pos), varName: null });
  return out;
}

/** Summary the rail shows for a scenario's latest run; stored on the row. */
export interface LastRunSummary {
  runs: number;
  failed: number;
  warnings: number;
  elapsed_ms: number;
  ran_at: string;
}

export function lastRunSummary(result: ScenarioRunResponse, now = new Date()): LastRunSummary {
  return {
    runs: result.runs,
    failed: result.failed,
    warnings: result.warnings.reduce((n, w) => n + w.count, 0),
    elapsed_ms: result.elapsed_ms,
    ran_at: now.toISOString(),
  };
}

export function seedLabel(spec: ScenarioSeedSpec): string {
  if ("list" in spec) return `${spec.list.length} listed seed${spec.list.length === 1 ? "" : "s"}`;
  if ("random" in spec) return `${spec.count} random seeds`;
  return `seeds ${spec.from} to ${spec.from + spec.count - 1}`;
}

/** Text a picker search matches against: name, id, tags, and the payload's
 *  own strings (option values, templates, rule values). */
export function searchText(row: { id: string; name: string; tags?: string[]; payload?: unknown; children?: unknown }): string {
  const parts = [row.name, row.id, ...(row.tags ?? [])];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === "string") { parts.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
  };
  walk(row.payload, 0);
  walk(row.children, 0);
  return parts.join("\n").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Reads nothing earlier in the stack sets                              */
/* ------------------------------------------------------------------ */

type PayloadRow = { type?: unknown; payload?: unknown; name?: unknown };

const VAR_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** `$names` a module's text reads: a combine's template, a derivation's
 *  conditions and action values. Axis and index suffixes (`$outfit.SHOES`,
 *  `$tags.0`) read their base variable, so only the base name counts. */
export function moduleReads(row: PayloadRow): string[] {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const found = new Set<string>();
  const scan = (text: unknown): void => {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(VAR_RE)) found.add(m[1]);
  };
  if (row.type === "combine") scan(p.template);
  if (row.type === "derivation") {
    const rules = Array.isArray(p.rules) ? p.rules : [];
    for (const r of rules as { branches?: { condition?: { var?: unknown }; action?: { value?: unknown } }[]; else?: { action?: { value?: unknown } } }[]) {
      for (const b of r.branches ?? []) {
        if (typeof b.condition?.var === "string") found.add(b.condition.var.replace(/^\$/, "").split(".")[0]);
        scan(b.action?.value);
      }
      scan(r.else?.action?.value);
    }
  }
  return [...found];
}

/** Every `$var` a module can write. */
export function moduleWrites(row: PayloadRow): string[] {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  if (row.type === "fixed_values") {
    const vals = Array.isArray(p.values) ? p.values : [];
    return (vals as { name?: unknown; var?: unknown }[])
      .map((v) => String(v.name ?? v.var ?? "").replace(/^\$/, ""))
      .filter(Boolean);
  }
  if (row.type === "derivation") {
    const out = new Set<string>();
    const rules = Array.isArray(p.rules) ? p.rules : [];
    for (const r of rules as { branches?: { action?: { target_var?: unknown } }[]; else?: { action?: { target_var?: unknown } } }[]) {
      for (const b of r.branches ?? []) if (typeof b.action?.target_var === "string") out.add(b.action.target_var.replace(/^\$/, ""));
      if (typeof r.else?.action?.target_var === "string") out.add(r.else.action.target_var.replace(/^\$/, ""));
    }
    return [...out];
  }
  const b = moduleBinding({ type: row.type as ModuleType, name: String(row.name ?? ""), payload: row.payload as ModuleRow["payload"] });
  return b ? [b] : [];
}

/** Per stack item, the variables it reads that no pin and no earlier
 *  enabled item sets. At run time those read as empty, which is the usual
 *  reason a combine keeps producing the same text. */
export function unsetReads(
  stack: ScenarioStackItem[],
  modules: ModuleRow[],
  bundles: BundleRow[],
  pins: Record<string, string>,
): string[][] {
  const written = new Set(Object.keys(pins).map((k) => k.replace(/^\$/, "")));
  const byId = new Map(modules.map((m) => [m.id, m]));
  return stack.map((item) => {
    if (item.enabled === false) return [];
    const rows: PayloadRow[] = isBundleItem(item)
      ? ((bundles.find((b) => b.id === item.bundle)?.children ?? []) as PayloadRow[])
      : [byId.get(item.module)].filter((m): m is ModuleRow => !!m);
    const missing: string[] = [];
    for (const row of rows) {
      for (const v of moduleReads(row)) if (!written.has(v) && !missing.includes(v)) missing.push(v);
      for (const v of moduleWrites(row)) written.add(v);
    }
    return missing;
  });
}
