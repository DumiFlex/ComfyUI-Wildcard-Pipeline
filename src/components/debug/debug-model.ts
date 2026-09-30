/**
 * WP Debug snapshot → view model. Pure: no DOM, no Vue, no fetches.
 *
 * The snapshot is the flat JSON `wp_nodes/debug_node.py` emits: user
 * variables at the top level, run data on `__wp_*__` keys. Version 2
 * snapshots (`__wp_debug_version__`) add per-module `detail`, the Context
 * node each row ran in, nested `@{}` picks and the other keys listed in
 * `debug_node.py`. Older snapshots (a cached run from an earlier build)
 * still parse; they just have less to show.
 */

// ── Snapshot shapes (as the engine writes them) ─────────────────────────

export interface RawWrite {
  variable?: string;
  value?: unknown;
  overwrite?: boolean;
  /** The joined negatives the variable carries after this write (only
   *  present when non-empty). */
  negative?: string;
}

export interface RawCondition {
  var?: string;
  op?: string;
  value?: unknown;
  actual?: unknown;
  result?: boolean;
  match?: "all" | "any";
  conditions?: RawCondition[];
}

export interface RawRuleDetail {
  id?: string;
  fired?: number | "else" | null;
  disabled?: boolean;
  else_disabled?: boolean;
  has_else?: boolean;
  branches?: Array<{
    index?: number;
    matched?: boolean;
    disabled?: boolean;
    condition?: RawCondition;
  }>;
  action?: { target?: string; mode?: string; value?: string; result?: string | null };
}

export interface RawDetail {
  // wildcard
  mode?: string;
  option_id?: string | null;
  option_ids?: Array<string | null>;
  chance?: number | null;
  pool?: number;
  live?: number;
  filter?: string;
  exclude_null?: boolean;
  held?: boolean;
  range?: [number, number];
  independent?: boolean;
  constraints?: Array<{ id?: string; uid?: string; name?: string; source?: string; source_value?: unknown }>;
  // derivation
  rules?: RawRuleDetail[];
  // constraint
  uid?: string;
  reach?: { mode?: string; count?: number; picks?: unknown[] };
  cells?: number;
  exceptions?: number;
  only?: boolean;
}

export interface RawTraceEntry {
  id?: string;
  _uid?: string;
  type?: string;
  name?: string;
  node?: string;
  node_id?: string;
  status?: string;
  binding?: string;
  bindings?: string[];
  value?: unknown;
  writes?: RawWrite[];
  internal?: boolean;
  seed_locked?: boolean;
  seed?: number;
  constraint_source?: string;
  constraint_target?: string;
  error?: string | { type?: string; message?: string } | null;
  detail?: RawDetail;
}

export interface RawRef {
  owner?: string | null;
  uuid?: string;
  name?: string;
  option_id?: string | null;
  depth?: number;
  value?: unknown;
  raw?: unknown;
  node_id?: string;
}

// ── View model ──────────────────────────────────────────────────────────

export type Kind = "wildcard" | "fixed" | "combine" | "derivation" | "constraint" | "injector" | "unknown";
export type StepStatus = "ok" | "off" | "frame" | "error" | "unknown" | "never";
export type Severity = "info" | "warning" | "error";

export interface StepWrite {
  variable: string;
  value: string;
  overwrite: boolean;
  /** Negative words the variable carries after this write ("" = none). */
  negative: string;
}

export interface RefRow {
  name: string;
  uuid: string;
  depth: number;
  value: string;
}

export interface ConstraintInfo {
  source: string;
  target: string;
  hits: number | null;
  reach: string;
  cells: number | null;
  exceptions: number | null;
  only: boolean;
}

/** A constraint that re-weighted a wildcard's pick. */
export interface AppliedConstraint {
  name: string;
  /** The constraint's own trace step, when it is in this trace. */
  stepKey: string | null;
  source: string;
  sourceValue: string;
}

export interface TraceStep {
  /** Stable per snapshot: `<entry index>`. */
  key: string;
  order: number;
  id: string;
  uid: string;
  nodeId: string;
  kind: Kind;
  kindLabel: string;
  /** Module display name when the run recorded one, else "". */
  name: string;
  /** The variable(s) this step is about, `$`-prefixed, for the row label. */
  bindings: string[];
  status: StepStatus;
  statusLabel: string;
  writes: StepWrite[];
  seed: string;
  seedLocked: boolean;
  internal: boolean;
  error: string | null;
  /** Injector rows: the value type on the wire and whether it was templated. */
  valueType: string;
  isTemplate: boolean;
  detail: RawDetail | null;
  refs: RefRow[];
  constraint: ConstraintInfo | null;
  appliedBy: AppliedConstraint[];
  warningCount: number;
}

/** What the canvas knows about a node id (both "" when it doesn't). */
export interface NodeInfo {
  title: string;
  codename: string;
}

export interface TraceGroup {
  nodeId: string;
  seed: string;
  steps: TraceStep[];
}

export interface VarRow {
  name: string;
  value: string;
  items: string[] | null;
  internal: boolean;
  axes: Array<{ axis: string; value: string }>;
  tags: string[];
  /** The step that wrote this variable last, when the trace has it. */
  writerKey: string | null;
  writerKind: Kind | null;
  writerName: string;
  /** How many steps wrote this variable (>1 means it was overwritten). */
  writeCount: number;
  /** Set by an upstream node's pass-through, not by any traced module. */
  fromUpstream: boolean;
  /** The variable's negative words (send-to-negative), grouped by where
   *  they came from. `source` is "" when the variable's own module set
   *  them, else a readable name (a derivation's module, `$other`, Injector). */
  negatives: NegativeLine[];
}

export interface NegativeLine {
  text: string;
  source: string;
}

/** One `__wp_negatives__` entry as the engine files it. */
export interface RawNegativeEntry {
  text?: string;
  pick?: number | null;
  source?: string;
}

export interface WarningRow {
  key: string;
  type: string;
  label: string;
  severity: Severity;
  message: string;
  detailText: string;
  binding: string;
  /** Trace step the warning belongs to, when it can be told. */
  stepKey: string | null;
}

export interface DebugModel {
  version: number;
  variables: VarRow[];
  steps: TraceStep[];
  groups: TraceGroup[];
  warnings: WarningRow[];
  seed: string;
  loopIndex: number | null;
  counts: { info: number; warning: number; error: number };
  /** How many variables carry negative words. */
  negativeCount: number;
  /** module uuid → variable (or display) name, from the trace. */
  names: Record<string, string>;
  /** module uuid → engine type, from the trace. */
  kinds: Record<string, string>;
}

// ── Labels ──────────────────────────────────────────────────────────────

/** Friendly label per runtime warning type. Covers every type the engine
 *  emits (`engine/pipeline.py`, `engine/modules/*`, `engine/syntax/resolve.py`);
 *  anything unmapped falls back to its raw token. */
export const WARNING_LABELS: Record<string, string> = {
  unknown_ref: "Reference not found",
  ref_subcategory_empty_pool: "Filter matched no options",
  ref_out_of_surface: "Reference not allowed here",
  var_out_of_surface: "Variable not allowed here",
  unknown_var: "Unknown variable",
  axis_untagged_pick: "Pick has no tag on this axis",
  unknown_tag_axis: "Unknown tag axis",
  recursion_limit: "References nested too deep",
  cycle_detected: "Reference cycle",
  constraint_never_applied: "Constraint never applied",
  constraint_partial_reach: "Constraint partial reach",
  constraint_source_missing: "Constraint source missing",
  constraint_register_failed: "Constraint failed to register",
  constraint_excludes_all_options: "Constraint excluded every option",
  constraint_factor_ignored_on_allow: "Constraint factor ignored (allow)",
  unknown_constraint_mode: "Unknown constraint mode",
  fixed_values_overrides_malformed: "Fixed-values overrides malformed",
  handler_error: "Module failed",
};

export const OP_LABELS: Record<string, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  starts_with: "starts with",
  ends_with: "ends with",
  matches: "matches",
  exists: "exists",
  not_exists: "doesn't exist",
  is_set: "is set",
  is_unset: "is unset",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

/** Ops that ignore `value`. */
export const VALUELESS_OPS = new Set([
  "exists", "not_exists", "is_set", "is_unset", "is_empty", "is_not_empty",
]);

const KIND_LABELS: Record<Kind, string> = {
  wildcard: "wildcard",
  fixed: "fixed",
  combine: "combine",
  derivation: "derivation",
  constraint: "constraint",
  injector: "injector",
  unknown: "module",
};

// ── Helpers ─────────────────────────────────────────────────────────────

export function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && Array.isArray((v as { items?: unknown }).items)) {
    const o = v as { items: unknown[]; sep?: unknown };
    return o.items.map(formatValue).join(typeof o.sep === "string" ? o.sep : ", ");
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function parseSnapshot(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asList<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function kindOf(entry: RawTraceEntry): Kind {
  if (entry.node === "WP_ContextInjector") return "injector";
  switch (entry.type) {
    case "wildcard": return "wildcard";
    case "fixed_values": return "fixed";
    case "combine": return "combine";
    case "derivation": return "derivation";
    case "constraint": return "constraint";
    default: return "unknown";
  }
}

function statusOf(raw: string | undefined, hasError: boolean): { status: StepStatus; label: string } {
  if (hasError || raw === "failed" || raw === "error") return { status: "error", label: "failed" };
  if (!raw || raw === "ok") return { status: "ok", label: "ran" };
  if (raw === "skipped_disabled") return { status: "off", label: "off" };
  if (raw === "skipped_frame") return { status: "frame", label: "off this frame" };
  if (raw === "skipped_unknown_type") return { status: "unknown", label: "unknown type" };
  return { status: "unknown", label: raw.replace(/_/g, " ") };
}

function errorText(e: RawTraceEntry["error"]): string | null {
  if (!e) return null;
  if (typeof e === "string") return e;
  const msg = e.message ?? "error";
  return e.type ? `${e.type}: ${msg}` : msg;
}

export function reachLabel(reach: RawDetail["reach"] | undefined): string {
  const mode = reach?.mode ?? "all";
  if (mode === "first") return "first target";
  if (mode === "next") {
    const n = Number(reach?.count ?? 1);
    return `next ${n} target${n === 1 ? "" : "s"}`;
  }
  if (mode === "pick") {
    const n = Array.isArray(reach?.picks) ? reach.picks.length : 0;
    return `${n} picked target${n === 1 ? "" : "s"}`;
  }
  return "every target";
}

function severityOf(v: unknown): Severity {
  if (v === "error") return "error";
  if (v === "info") return "info";
  return "warning";
}

/** Old engines quoted bare 8-hex uuids (`constraint 'e4b95847' never
 *  fired`); wrap them as `@{…}` so the chip renderer resolves them. */
export function wrapBareUuids(text: string): string {
  return text ? text.replace(/'([0-9a-fA-F]{8})'/g, "@{$1}") : text;
}

function warningDetailText(type: string, detail: Record<string, unknown>): string {
  if (type === "constraint_partial_reach") {
    const reached = Number(detail.reached);
    const requested = Number(detail.requested);
    return Number.isFinite(reached) && Number.isFinite(requested) ? `reached ${reached} of ${requested}` : "";
  }
  if (type === "constraint_never_applied") {
    return detail.target_present === false ? "target not in chain" : "";
  }
  if (type === "unknown_ref") {
    return str(detail.name) ? "placeholder, or a module that was deleted" : "";
  }
  if (type === "unknown_var" || type === "var_out_of_surface") {
    return str(detail.surface) ? `in a ${str(detail.surface)}` : "";
  }
  if (type === "unknown_tag_axis") {
    const declared = asList<string>(detail.declared);
    return declared.length ? `axes: ${declared.join(", ")}` : "";
  }
  return "";
}

/** Readable name for a negative entry's `source`. The engine files an
 *  option / fixed / combine negative under its own binding, a derivation's
 *  under the fired branch's carrier key (`rule_id:branch`), an Injector
 *  row's under "injector", and inherited entries keep the binding they came
 *  from. "" means "the variable's own module". */
function negativeSourceLabel(variable: string, source: string, carriers: Map<string, string>): string {
  if (!source || source === variable) return "";
  const carrier = carriers.get(source);
  if (carrier) return carrier;
  if (source === "injector") return "Injector";
  if (source === "derivation") return "derivation";
  return `$${source}`;
}

/** A variable's negative entries as display lines: texts joined per
 *  source (multi-pick entries of one option read as one line). */
export function negativeLines(
  variable: string,
  entries: unknown,
  carriers: Map<string, string> = new Map(),
): NegativeLine[] {
  const out: NegativeLine[] = [];
  for (const raw of asList<RawNegativeEntry>(entries)) {
    const text = str(asRecord(raw).text).trim();
    if (!text) continue;
    const source = negativeSourceLabel(variable, str(asRecord(raw).source), carriers);
    const last = out[out.length - 1];
    if (last && last.source === source) last.text = `${last.text}, ${text}`;
    else out.push({ text, source });
  }
  return out;
}

// ── Build ───────────────────────────────────────────────────────────────

export function buildModel(snap: Record<string, unknown>): DebugModel {
  const version = Number(snap.__wp_debug_version__ ?? 1) || 1;
  const trace = asList<RawTraceEntry>(snap.__wp_trace__).filter((t) => t && typeof t === "object");
  const rawWarnings = asList<unknown>(snap.__wp_warnings__);
  const picks = asRecord(snap.__wp_picks__);
  const refLog = asList<RawRef>(snap.__wp_ref_log__);
  const hits = asRecord(snap.__wp_constraint_hits__);
  const internalFlags = asRecord(snap.__wp_internal_flags__);
  const axes = asRecord(snap.__wp_axes__);
  const multi = asRecord(snap.__wp_multi__);
  const nodes = asList<{ node_id?: string; seed?: number }>(snap.__wp_nodes__);

  // uuid → name / kind, from the trace (the viewer's library fetch fills gaps).
  const names: Record<string, string> = {};
  const kinds: Record<string, string> = {};
  for (const t of trace) {
    const id = str(t.id);
    if (!id) continue;
    const firstWrite = asList<RawWrite>(t.writes)[0];
    const name = str(firstWrite?.variable) || str(t.binding) || str(asList<string>(t.bindings)[0]);
    if (name && !names[id]) names[id] = name;
    if (t.type) kinds[id] = t.type;
  }

  // Nested refs grouped by the step (owner uid) that made them.
  const refsByOwner = new Map<string, RefRow[]>();
  for (const r of refLog) {
    if (!r || typeof r !== "object") continue;
    const owner = `${str(r.node_id)}|${str(r.owner)}`;
    const list = refsByOwner.get(owner) ?? [];
    list.push({
      name: str(r.name) || names[str(r.uuid)] || str(r.uuid).slice(0, 8),
      uuid: str(r.uuid),
      depth: Number(r.depth ?? 0) || 0,
      value: formatValue(r.value ?? r.raw),
    });
    refsByOwner.set(owner, list);
  }

  // Warnings, then how many belong to each step.
  const warningOwner = (o: Record<string, unknown>): string => {
    const uid = str(o.owner_uid);
    if (uid) return `${str(o.node_id)}|${uid}`;
    return "";
  };
  const stepKeyByOwner = new Map<string, string>();
  const stepKeyByModuleId = new Map<string, string>();

  const never = new Set<string>();
  for (const w of rawWarnings) {
    const o = asRecord(w);
    if (o.type === "constraint_never_applied" && str(o.module_id)) never.add(str(o.module_id));
  }

  const steps: TraceStep[] = trace.map((t, i) => {
    const kind = kindOf(t);
    const hasError = !!t.error;
    const { status, label } = statusOf(t.status, hasError);
    const writes: StepWrite[] = asList<RawWrite>(t.writes).map((w) => ({
      variable: str(w.variable),
      value: formatValue(w.value),
      overwrite: !!w.overwrite,
      negative: str(w.negative).trim(),
    }));
    if (kind === "injector" && t.binding) {
      writes.push({ variable: t.binding, value: formatValue(t.value), overwrite: false, negative: "" });
    }
    const declared = writes.length
      ? writes.map((w) => w.variable)
      : t.binding ? [t.binding] : asList<string>(t.bindings);
    const detail = t.detail && typeof t.detail === "object" ? t.detail : null;
    let constraint: ConstraintInfo | null = null;
    if (kind === "constraint") {
      const uid = str(detail?.uid) || str(t._uid) || str(t.id);
      const h = hits[uid] ?? hits[str(t.id)];
      constraint = {
        source: str(t.constraint_source),
        target: str(t.constraint_target),
        hits: typeof h === "number" ? h : null,
        reach: reachLabel(detail?.reach),
        cells: typeof detail?.cells === "number" ? detail.cells : null,
        exceptions: typeof detail?.exceptions === "number" ? detail.exceptions : null,
        only: !!detail?.only,
      };
    }
    let finalStatus = status;
    let finalLabel = label;
    if (kind === "constraint" && status === "ok") {
      const ids = [str(t._uid), str(t.id), str(detail?.uid)].filter(Boolean);
      if (ids.some((x) => never.has(x)) || constraint?.hits === 0) {
        finalStatus = "never";
        finalLabel = "never applied";
      }
    }
    const injectorType = kind === "injector" ? str(t.type).toLowerCase() : "";
    const isTemplate = injectorType.startsWith("str(template)") || injectorType === "template";
    const key = String(i);
    const nodeId = str(t.node_id);
    if (t._uid) stepKeyByOwner.set(`${nodeId}|${t._uid}`, key);
    if (t.id && !stepKeyByModuleId.has(t.id)) stepKeyByModuleId.set(t.id, key);
    return {
      key,
      order: i + 1,
      id: str(t.id),
      uid: str(t._uid),
      nodeId,
      kind,
      kindLabel: KIND_LABELS[kind],
      name: str(t.name),
      bindings: declared.filter(Boolean),
      status: finalStatus,
      statusLabel: finalLabel,
      writes,
      seed: typeof t.seed === "number" && Number.isFinite(t.seed) ? String(t.seed) : "",
      seedLocked: !!t.seed_locked,
      internal: !!t.internal,
      error: errorText(t.error),
      valueType: kind === "injector" ? (isTemplate ? "str" : injectorType).toUpperCase() : "",
      isTemplate,
      detail,
      refs: refsByOwner.get(`${nodeId}|${str(t._uid)}`) ?? [],
      constraint,
      appliedBy: [],
      warningCount: 0,
    };
  });

  // Link each wildcard's re-weighting constraints to their own steps.
  const stepByUid = new Map<string, TraceStep>();
  for (const s of steps) {
    if (s.kind !== "constraint") continue;
    for (const k of [s.uid, str(s.detail?.uid), s.id]) if (k && !stepByUid.has(k)) stepByUid.set(k, s);
  }
  for (const s of steps) {
    for (const c of s.detail?.constraints ?? []) {
      const own = stepByUid.get(str(c.uid)) ?? stepByUid.get(str(c.id)) ?? null;
      s.appliedBy.push({
        name: str(c.name) || own?.name || names[str(c.id)] || str(c.id).slice(0, 8),
        stepKey: own?.key ?? null,
        source: str(c.source),
        sourceValue: formatValue(c.source_value),
      });
    }
  }

  const warnings: WarningRow[] = rawWarnings.map((w, i) => {
    const o = asRecord(w);
    const type = str(o.type) || "unknown";
    const detail = asRecord(o.detail);
    const owner = warningOwner(o);
    let stepKey = owner ? stepKeyByOwner.get(owner) ?? null : null;
    if (!stepKey && str(o.module_id)) stepKey = stepKeyByModuleId.get(str(o.module_id)) ?? null;
    if (!stepKey && str(o.owner_id)) stepKey = stepKeyByModuleId.get(str(o.owner_id)) ?? null;
    return {
      key: String(i),
      type,
      label: WARNING_LABELS[type] ?? type.replace(/_/g, " "),
      severity: typeof w === "object" && w !== null ? severityOf(o.severity) : "warning",
      message: typeof w === "object" && w !== null ? wrapBareUuids(str(o.message)) : String(w),
      detailText: warningDetailText(type, detail),
      binding: str(o.binding),
      stepKey,
    };
  });
  const byStep = new Map<string, number>();
  for (const w of warnings) if (w.stepKey) byStep.set(w.stepKey, (byStep.get(w.stepKey) ?? 0) + 1);
  for (const s of steps) s.warningCount = byStep.get(s.key) ?? 0;

  // Groups: consecutive steps from the same node. Rows from a snapshot
  // without node ids fall into one unnamed group.
  const seedByNode = new Map<string, string>();
  for (const n of nodes) if (n && n.node_id) seedByNode.set(String(n.node_id), n.seed != null ? String(n.seed) : "");
  const groups: TraceGroup[] = [];
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (last && last.nodeId === s.nodeId) last.steps.push(s);
    else groups.push({ nodeId: s.nodeId, seed: seedByNode.get(s.nodeId) ?? "", steps: [s] });
  }

  // Variables: the public ctx at the top level, plus who wrote each one.
  const lastWriter = new Map<string, TraceStep>();
  const writeCount = new Map<string, number>();
  for (const s of steps) {
    if (s.status !== "ok" && s.status !== "never") continue;
    for (const w of s.writes) {
      lastWriter.set(w.variable, s);
      writeCount.set(w.variable, (writeCount.get(w.variable) ?? 0) + 1);
    }
  }
  const tagsByVar = new Map<string, string[]>();
  for (const [mid, p] of Object.entries(picks)) {
    const name = names[mid];
    const tags = asList<string>(asRecord(p).sub_categories).filter((x) => typeof x === "string");
    if (name && tags.length) tagsByVar.set(name, tags);
  }
  // Derivation carrier keys (`rule_id:branch`) → the module that fired them,
  // so an "Add to negative" entry names its derivation.
  const negTable = asRecord(snap.__wp_negatives__);
  const carriers = new Map<string, string>();
  for (const s of steps) {
    if (s.kind !== "derivation") continue;
    for (const r of s.detail?.rules ?? []) {
      if (r.id && r.fired != null && !carriers.has(`${r.id}:${r.fired}`)) {
        carriers.set(`${r.id}:${r.fired}`, s.name || "derivation");
      }
    }
  }
  const variables: VarRow[] = [];
  for (const [name, value] of Object.entries(snap)) {
    if (name.startsWith("__")) continue;
    const m = asRecord(multi[name]);
    const items = Array.isArray(m.items) ? m.items.map(formatValue) : null;
    const axisRows: VarRow["axes"] = [];
    const ax = axes[name];
    if (Array.isArray(ax)) {
      const byAxis = new Map<string, string[]>();
      ax.forEach((pick) => {
        for (const [axis, v] of Object.entries(asRecord(pick))) {
          const list = byAxis.get(axis) ?? [];
          list.push(formatValue(v));
          byAxis.set(axis, list);
        }
      });
      for (const [axis, vals] of byAxis) axisRows.push({ axis, value: vals.filter(Boolean).join(", ") });
    } else {
      for (const [axis, v] of Object.entries(asRecord(ax))) axisRows.push({ axis, value: formatValue(v) });
    }
    const writer = lastWriter.get(name) ?? null;
    variables.push({
      name,
      value: formatValue(value),
      items: items && items.length ? items : null,
      internal: internalFlags[name] === true,
      axes: axisRows,
      tags: tagsByVar.get(name) ?? [],
      writerKey: writer?.key ?? null,
      writerKind: writer?.kind ?? null,
      writerName: writer?.name ?? "",
      writeCount: writeCount.get(name) ?? 0,
      fromUpstream: !writer,
      negatives: negativeLines(name, negTable[name], carriers),
    });
  }

  const counts = { info: 0, warning: 0, error: 0 };
  for (const w of warnings) counts[w.severity] += 1;
  const seedRaw = snap.__wp_node_seed__;
  const loopRaw = snap.__wp_loop_index__;

  return {
    version,
    variables,
    steps,
    groups,
    warnings,
    seed: typeof seedRaw === "number" || typeof seedRaw === "string" ? String(seedRaw) : "",
    loopIndex: typeof loopRaw === "number" ? loopRaw : null,
    counts,
    negativeCount: variables.filter((v) => v.negatives.length > 0).length,
    names,
    kinds,
  };
}

/** Every `@{uuid}` the model mentions that `known` can't name yet — the
 *  viewer fetches these from the library so chips read `@style`. */
export function unresolvedUuids(model: DebugModel, raw: Record<string, unknown>, known: Record<string, string>): string[] {
  const out = new Set<string>();
  const re = /@\{([0-9a-f]{6,16})(?:#[^#:}@{]*)?(?::[^}]*)?\}/gi;
  const want = (u: string) => { if (u && !known[u]) out.add(u); };
  const scan = (text: string) => { for (const m of text.matchAll(re)) want(m[1]); };
  for (const v of model.variables) scan(v.value);
  for (const s of model.steps) {
    for (const w of s.writes) scan(w.value);
    for (const r of s.refs) scan(r.value);
    if (s.constraint) { want(s.constraint.source); want(s.constraint.target); }
    for (const c of s.appliedBy) want(c.source);
    if (s.id && !s.name && !s.bindings.length) want(s.id);
  }
  for (const w of model.warnings) scan(w.message);
  for (const [mid, p] of Object.entries(asRecord(raw.__wp_picks__))) {
    want(mid);
    scan(formatValue(asRecord(p).value));
  }
  return [...out];
}

/** Text the Trace filter matches a step against. */
export function stepSearchText(s: TraceStep): string {
  return [
    s.name, s.kindLabel, ...s.bindings.map((b) => `$${b}`),
    ...s.writes.map((w) => w.value), s.error ?? "",
  ].join("\n").toLowerCase();
}
