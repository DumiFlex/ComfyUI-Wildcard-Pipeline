/**
 * Assembler › "Mark unused internal": flag every upstream variable the
 * Assembler's prompt and negative don't read as internal, unless another
 * Assembler on the same context still reads it.
 *
 * Internal is decided per WRITER, last write wins (`collectUpstreamKinds`),
 * and only the Prompt Assembler drops internal variables (combine,
 * derivation, constraints, Var to X and later Contexts still read them). So:
 *
 *  - a variable read only through another one (`$scene` = "$hero in $place")
 *    is safe to hide: the combine still reads `$hero`;
 *  - a variable is in use when ANY Assembler downstream of its writer reads
 *    it in its template or negative template (accessor reads `$x.0`, `$x.AXIS`,
 *    `$x.neg`, `$x.bool` count);
 *  - a Context module carries ONE flag for every name it writes, so it is
 *    flipped only when none of those names is in use.
 *
 * Pure graph logic, no DOM: `planMarkUnused` decides, `applyMarkUnused`
 * writes the widgets and returns what `undoMarkUnused` needs.
 */
import { findDownstreamAssemblers, upstreamChainOf, type LiteGraphLike, type LiteNodeLike } from "./graph";
import { derivationTargets } from "./derivation-conditions";
import { MODEL_INFO_NODE, MODEL_INFO_KEYS, CONFIG_WIDGET as MODEL_WIDGET } from "./model-info";
import { TOGGLES_NODE, nodeTogglesConfig, internalToggleVars, toggleRows } from "./toggles";
import { NEGATIVES_VAR } from "./assembler-vars";
import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  parseWidgetJson,
  serializeWidgetJson,
  type ContextWidgetValue,
  type ModuleEntry,
} from "../widgets/_shared";

const ASSEMBLER = "WP_PromptAssembler";
const SKIP_MODES = new Set<number>([2, 4]);
const VAR_RE = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** One internal flag: flipping it hides every name in `names`. */
interface Unit {
  node: LiteNodeLike;
  /** Which flag on the node (module `_uid`/index, binding, toggle var …). */
  ref: string;
  names: string[];
  internal: boolean;
  /** False for a name nothing can mark internal (the Loop's `_value`). */
  flippable: boolean;
}

export type KeptReason =
  /** Another Assembler on the same context reads it. */
  | "other_assembler"
  /** Its module also writes a variable that is in use (one flag for both). */
  | "shared_module"
  /** An Assembler that could read it has its template wired from a node. */
  | "wired_template"
  /** Nothing can mark it internal (the Loop's `_value`). */
  | "fixed";

export interface MarkPlan {
  /** This Assembler's own template is wired: nothing can be decided. */
  wired: boolean;
  /** Variables that will become internal, in chip order. */
  marked: string[];
  /** Unused here but kept, with why. */
  kept: Array<{ name: string; reason: KeptReason; also?: string }>;
  /** @internal what `applyMarkUnused` flips. */
  units: Unit[];
}

export interface MarkChange {
  node: LiteNodeLike;
  widget: string;
  before: string;
  after: string;
}

function isSkipped(n: LiteNodeLike): boolean {
  return typeof n.mode === "number" && SKIP_MODES.has(n.mode);
}

function widgetString(n: LiteNodeLike, name: string): string {
  const w = n.widgets?.find((x) => x.name === name);
  return typeof w?.value === "string" ? w.value : "";
}

function inputWired(n: LiteNodeLike, name: string): boolean {
  return n.inputs?.find((i) => i.name === name)?.link != null;
}

function scanNames(text: string, into: Set<string>, reserved?: string): void {
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1];
    if (name.startsWith("__") || name === reserved) continue;
    into.add(name);
  }
}

/** Names an Assembler's prompt + negative read, or `null` when either box is
 *  wired from another node (then it could read anything). */
export function assemblerReads(n: LiteNodeLike): Set<string> | null {
  if (inputWired(n, "template") || inputWired(n, "negative_template")) return null;
  const out = new Set<string>();
  scanNames(widgetString(n, "template"), out);
  scanNames(widgetString(n, "negative_template"), out, NEGATIVES_VAR);
  return out;
}

const bare = (raw: string | undefined | null): string => (raw ?? "").replace(/^\$/, "").trim();

/** Every name one Context module writes (mirror of `collectUpstreamKinds`). */
export function moduleNames(m: ModuleEntry): string[] {
  const out: string[] = [];
  const add = (n: string) => { if (n && !out.includes(n)) out.push(n); };
  if (m.type === "fixed_values") {
    const inst = (m.instance ?? {}) as {
      values_overrides?: Array<{ id?: string; name?: string }>;
      enabled_options?: string[] | null;
    };
    const filter = Array.isArray(inst.enabled_options) ? new Set(inst.enabled_options) : null;
    const passes = (id: string | undefined) => filter === null || (typeof id === "string" && filter.has(id));
    const overrides = Array.isArray(inst.values_overrides) && inst.values_overrides.length > 0
      ? inst.values_overrides : null;
    const rows = overrides ?? ((m.payload ?? {}) as { values?: Array<{ id?: string; name?: string }> }).values ?? [];
    for (const r of rows) if (passes(r.id)) add(bare(r.name));
    if (!overrides) for (const e of m.entries ?? []) add(bare(e.variable_name));
    return out;
  }
  if (m.type === "derivation") {
    for (const n of derivationTargets(m.payload)) add(n);
    return out;
  }
  const inst = (m.instance ?? {}) as { variable_binding?: string | null };
  const payload = (m.payload ?? {}) as { var_binding?: string; output_var?: string };
  add(bare(inst.variable_binding ?? payload.var_binding ?? payload.output_var ?? ""));
  return out;
}

function loopConfig(n: LiteNodeLike): { base: string; iter: boolean; total: boolean } {
  const cfg = parseWidgetJson<{ iteration_var_name?: string; iteration_internal?: boolean; total_internal?: boolean }>(
    widgetString(n, "wp_context_loop_config"), {},
  );
  return {
    base: (cfg.iteration_var_name ?? "iteration").trim() || "iteration",
    iter: cfg.iteration_internal === true,
    total: cfg.total_internal === true,
  };
}

/** The flags one node carries, in write order. */
function unitsOf(n: LiteNodeLike): Unit[] {
  if (n.type === "WP_ContextInjector") {
    const inj = parseWidgetJson<{ rows?: Array<{ binding?: string; enabled?: boolean; internal?: boolean }> }>(
      widgetString(n, "wp_rows"), { rows: [] },
    );
    // Last enabled row of a binding decides, like the walkers.
    const byName = new Map<string, boolean>();
    for (const r of inj.rows ?? []) {
      const b = (r.binding ?? "").trim();
      if (r.enabled === true && b) byName.set(b, r.internal === true);
    }
    return [...byName].map(([b, internal]) => ({ node: n, ref: `row:${b}`, names: [b], internal, flippable: true }));
  }
  if (n.type === MODEL_INFO_NODE) {
    const flags = parseWidgetJson<{ internal?: Record<string, unknown> }>(widgetString(n, MODEL_WIDGET), {}).internal ?? {};
    return MODEL_INFO_KEYS.map((k) => ({
      node: n, ref: `model:${k}`, names: [`model_${k}`], internal: flags[k] !== false, flippable: true,
    }));
  }
  if (n.type === TOGGLES_NODE) {
    const cfg = nodeTogglesConfig(n as Parameters<typeof nodeTogglesConfig>[0]);
    const hidden = internalToggleVars(cfg);
    const names = new Set<string>(toggleRows(cfg).map((t) => t.var).filter(Boolean));
    if (cfg.mode === "one" && cfg.group_var) names.add(cfg.group_var);
    return [...names].map((v) => ({ node: n, ref: `toggle:${v}`, names: [v], internal: hidden.has(v), flippable: true }));
  }
  if (n.type === "WP_ContextLoop") {
    const c = loopConfig(n);
    const out: Unit[] = [
      { node: n, ref: "loop:iteration", names: [c.base], internal: c.iter, flippable: true },
      { node: n, ref: "loop:total", names: [`${c.base}_total`], internal: c.total, flippable: true },
    ];
    if (inputWired(n, "values")) out.push({ node: n, ref: "loop:value", names: [`${c.base}_value`], internal: false, flippable: false });
    return out;
  }
  if (n.type !== "WP_Context") return [];
  const v = parseWidgetJson<ContextWidgetValue>(widgetString(n, "wp_modules"), { version: 1, modules: [] });
  const enabled = buildBundleEnabledMap(v.bundles);
  const out: Unit[] = [];
  v.modules.forEach((m, i) => {
    if (!isModuleEffectivelyEnabled(m, enabled)) return;
    const names = moduleNames(m);
    if (!names.length) return;
    out.push({ node: n, ref: `module:${m._uid ?? ""}:${i}`, names, internal: m.instance?.internal === true, flippable: true });
  });
  return out;
}

/**
 * What the button would do for `assembler`. Nothing is written.
 */
export function planMarkUnused(rootGraph: LiteGraphLike, assembler: LiteNodeLike): MarkPlan {
  const own = assemblerReads(assembler);
  if (own === null) return { wired: true, marked: [], kept: [], units: [] };

  // Winner per name, furthest upstream → closest (last write wins).
  const chain = upstreamChainOf(rootGraph, assembler);
  const winner = new Map<string, Unit>();
  const order: string[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (isSkipped(n)) continue;
    for (const u of unitsOf(n)) {
      for (const name of u.names) {
        if (!winner.has(name)) order.push(name);
        winner.set(name, u);
      }
    }
  }

  // Reads of every Assembler below each writer node, cached per node.
  const readsBelow = new Map<LiteNodeLike, { reads: Set<string>; wired: boolean }>();
  const below = (n: LiteNodeLike) => {
    const hit = readsBelow.get(n);
    if (hit) return hit;
    const reads = new Set<string>();
    let wired = false;
    for (const a of findDownstreamAssemblers(rootGraph, n)) {
      if (a.type !== ASSEMBLER) continue;
      const r = assemblerReads(a);
      if (r === null) wired = true;
      else for (const x of r) reads.add(x);
    }
    const out = { reads, wired };
    readsBelow.set(n, out);
    return out;
  };

  const marked: string[] = [];
  const kept: MarkPlan["kept"] = [];
  const flip = new Set<Unit>();
  const decided = new Map<Unit, { ok: boolean; reason?: KeptReason; also?: string }>();
  for (const name of order) {
    const u = winner.get(name);
    if (!u || u.internal || own.has(name)) continue;
    let verdict = decided.get(u);
    if (!verdict) {
      const { reads, wired } = below(u.node);
      const used = u.names.find((x) => reads.has(x) || own.has(x));
      if (!u.flippable) verdict = { ok: false, reason: "fixed" };
      else if (wired) verdict = { ok: false, reason: "wired_template" };
      else if (used !== undefined) verdict = { ok: false, reason: "shared_module", also: used };
      else verdict = { ok: true };
      decided.set(u, verdict);
    }
    if (verdict.ok) {
      flip.add(u);
      marked.push(name);
      continue;
    }
    // A name the other Assemblers read is kept for THAT reason, even when
    // its module shares a flag with something else.
    const reason: KeptReason = below(u.node).reads.has(name) ? "other_assembler" : verdict.reason ?? "other_assembler";
    kept.push({ name, reason, ...(reason === "shared_module" && verdict.also ? { also: verdict.also } : {}) });
  }
  return { wired: false, marked, kept, units: [...flip] };
}

function writeWidget(n: LiteNodeLike, name: string, value: string): void {
  const w = n.widgets?.find((x) => x.name === name);
  if (!w) return;
  w.value = value;
  (n.graph as { setDirtyCanvas?: (fg: boolean, bg: boolean) => void } | undefined)?.setDirtyCanvas?.(true, true);
}

type Json = Record<string, unknown>;
const obj = (raw: string): Json => {
  try {
    const d: unknown = raw.trim() ? JSON.parse(raw) : {};
    return d && typeof d === "object" && !Array.isArray(d) ? (d as Json) : {};
  } catch { return {}; }
};

/** The node's widget value with `refs` flipped internal. */
function flipped(n: LiteNodeLike, refs: Set<string>): { widget: string; value: string } | null {
  if (n.type === "WP_ContextInjector") {
    const raw = widgetString(n, "wp_rows");
    const d = obj(raw);
    const rows = Array.isArray(d.rows) ? (d.rows as Json[]) : [];
    d.rows = rows.map((r) => {
      const b = typeof r.binding === "string" ? r.binding.trim() : "";
      return r.enabled === true && refs.has(`row:${b}`) ? { ...r, internal: true } : r;
    });
    return { widget: "wp_rows", value: JSON.stringify(d) };
  }
  if (n.type === MODEL_INFO_NODE) {
    const d = obj(widgetString(n, MODEL_WIDGET));
    const flags = { ...(d.internal && typeof d.internal === "object" ? (d.internal as Json) : {}) };
    for (const k of MODEL_INFO_KEYS) if (refs.has(`model:${k}`)) flags[k] = true;
    d.internal = flags;
    return { widget: MODEL_WIDGET, value: JSON.stringify(d) };
  }
  if (n.type === TOGGLES_NODE) {
    const d = obj(widgetString(n, "wp_toggles"));
    const rows = Array.isArray(d.rows) ? (d.rows as Json[]) : [];
    d.rows = rows.map((r) => {
      if (r.kind !== "toggle" || typeof r.var !== "string" || !refs.has(`toggle:${r.var}`)) return r;
      const { visible: _v, ...rest } = r;
      void _v;
      return rest;
    });
    if (typeof d.group_var === "string" && refs.has(`toggle:${d.group_var}`)) delete d.group_visible;
    return { widget: "wp_toggles", value: JSON.stringify(d) };
  }
  if (n.type === "WP_ContextLoop") {
    const d = obj(widgetString(n, "wp_context_loop_config"));
    if (refs.has("loop:iteration")) d.iteration_internal = true;
    if (refs.has("loop:total")) d.total_internal = true;
    return { widget: "wp_context_loop_config", value: JSON.stringify(d) };
  }
  if (n.type !== "WP_Context") return null;
  const v = parseWidgetJson<ContextWidgetValue>(widgetString(n, "wp_modules"), { version: 1, modules: [] });
  const modules = v.modules.map((m, i) => {
    if (!refs.has(`module:${m._uid ?? ""}:${i}`)) return m;
    // Same as the card's globe: the user now owns the flag, so a bundle
    // master's markers go (its OFF cascade must not revert this row).
    const inst = (m.instance ?? {}) as NonNullable<ModuleEntry["instance"]>;
    const ui = { ...((inst as { _ui?: Json })._ui ?? {}) };
    delete ui.master_internal;
    delete ui.master_internal_by;
    return { ...m, instance: { ...inst, internal: true, _ui: ui } };
  });
  return { widget: "wp_modules", value: serializeWidgetJson({ ...v, modules }) };
}

/** Write the plan. Returns each widget's old and new value, for Undo. */
export function applyMarkUnused(plan: MarkPlan): MarkChange[] {
  const byNode = new Map<LiteNodeLike, Set<string>>();
  for (const u of plan.units) {
    const s = byNode.get(u.node) ?? new Set<string>();
    s.add(u.ref);
    byNode.set(u.node, s);
  }
  const changes: MarkChange[] = [];
  for (const [n, refs] of byNode) {
    const next = flipped(n, refs);
    if (!next) continue;
    const before = widgetString(n, next.widget);
    if (before === next.value) continue;
    writeWidget(n, next.widget, next.value);
    changes.push({ node: n, widget: next.widget, before, after: next.value });
  }
  return changes;
}

/** Put each widget back, unless it was edited since. Returns how many were
 *  edited since and left alone. */
export function undoMarkUnused(changes: MarkChange[]): number {
  let skipped = 0;
  for (const c of changes) {
    if (widgetString(c.node, c.widget) !== c.after) { skipped++; continue; }
    writeWidget(c.node, c.widget, c.before);
  }
  return skipped;
}

/** "$a, $b and 3 more". */
export function nameList(names: string[], max = 4): string {
  const shown = names.slice(0, max).map((n) => `$${n}`);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length < 2) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** The toast line for a plan that was applied. */
export function summary(plan: MarkPlan): string {
  const parts: string[] = [];
  if (plan.marked.length) {
    parts.push(`Marked ${plan.marked.length} internal: ${nameList(plan.marked)}.`);
  }
  const other = plan.kept.filter((k) => k.reason === "other_assembler").map((k) => k.name);
  const shared = plan.kept.filter((k) => k.reason === "shared_module");
  const wired = plan.kept.filter((k) => k.reason === "wired_template").map((k) => k.name);
  if (other.length) parts.push(`Kept ${nameList(other)}: another Assembler uses ${other.length === 1 ? "it" : "them"}.`);
  for (const k of shared.slice(0, 2)) {
    parts.push(`Kept $${k.name}: its module also writes $${k.also ?? "?"}, which is in use.`);
  }
  if (shared.length > 2) parts.push(`Kept ${shared.length - 2} more that share a module with a used variable.`);
  if (wired.length) parts.push(`Kept ${nameList(wired)}: an Assembler below gets its template from a wire.`);
  return parts.join(" ");
}
