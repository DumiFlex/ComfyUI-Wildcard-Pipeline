<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import { highlightJson } from "./highlight";
import ContextMenu, { type ContextMenuItem } from "../shared/ContextMenu.vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";

const props = withDefaults(
  defineProps<{
    snapshot: string;
    /** Litegraph mode — 0=ALWAYS, 2=NEVER (mute), 4=BYPASS. Drives
     *  the dim overlay so muted/bypassed state matches litegraph's
     *  native title/border dim. */
    nodeMode?: number;
  }>(),
  { nodeMode: 0 },
);

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const emit = defineEmits<{
  /** Fires whenever the formula-computed min-width changes. Mount
   *  glue updates the widget host's `computeLayoutSize` getter so
   *  litegraph re-reads it on the next layout pass. Same pull-based
   *  pattern InjectorWidget uses — no DOM measurements, just CSS
   *  knowns summed against current state. */
  (e: "request-min-width", w: number): void;
}>();

type TabId = "snapshot" | "trace" | "picks" | "warnings";

const activeTab = ref<TabId>("snapshot");

/** Parsed snapshot — null when the snapshot string is empty or malformed. */
const parsed = computed<Record<string, unknown> | null>(() => {
  if (!props.snapshot) return null;
  try {
    const v = JSON.parse(props.snapshot);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
});

/** Snapshot view — strips internal `__wp_*` keys for the user-facing view. */
const snapshotView = computed(() => {
  if (!parsed.value) return "";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.value)) {
    if (!k.startsWith("__")) out[k] = v;
  }
  return JSON.stringify(out, null, 2);
});

const traceView = computed(() => {
  const trace = parsed.value?.__wp_trace__;
  return Array.isArray(trace) ? JSON.stringify(trace, null, 2) : "(no trace)";
});

const picks = computed<Record<string, unknown>>(() => {
  const p = parsed.value?.__wp_picks__;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
});

const warnings = computed<unknown[]>(() => {
  const w = parsed.value?.__wp_warnings__;
  return Array.isArray(w) ? w : [];
});

const picksCount = computed(() => Object.keys(picks.value).length);
const warningsCount = computed(() => warnings.value.length);

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "snapshot", label: "Snapshot" },
  { id: "trace", label: "Trace" },
  { id: "picks", label: "Picks" },
  { id: "warnings", label: "Warnings" },
];

const bodyText = computed(() => {
  switch (activeTab.value) {
    case "snapshot": return snapshotView.value;
    case "trace":    return traceView.value;
    case "picks":    return JSON.stringify(picks.value, null, 2);
    case "warnings": return JSON.stringify(warnings.value, null, 2);
  }
});

/** Pre-tokenized HTML for the snapshot/trace JSON view. Wraps keys /
 *  strings / numbers / booleans in semantic spans the stylesheet
 *  paints with semantic colors. */
const bodyHtml = computed(() => {
  if (!bodyText.value) return "";
  return highlightJson(bodyText.value);
});

interface TraceWrite {
  variable: string;
  value: unknown;
  source?: string;
  overwrite?: boolean;
}

interface TraceEntry {
  id?: string;
  type?: string;
  node?: string;
  status?: string;
  /** Injector-trace shape: a single `binding` field with the variable
   *  the row writes. Engine modules use the same field for their
   *  declared `instance.variable_binding` even when disabled / errored
   *  (so the trace row can label the binding without writes[]). */
  binding?: string;
  /** Injector-trace shape: the written ctx value. Engine modules emit
   *  values inside `writes[]`; injector emits a flat `value` field
   *  alongside `binding` since each row writes exactly one binding. */
  value?: unknown;
  /** Multi-binding declared bindings — fixed_values modules surface
   *  every variable they would have written. Used when the module is
   *  disabled / errors before writes is populated. */
  bindings?: string[];
  /** Engine-trace shape — one entry per binding the module wrote. */
  writes?: TraceWrite[];
  /** True when `instance.internal` is set — every binding the module
   *  wrote is engine-only (stripped from public ctx payload). */
  internal?: boolean;
  /** True when `instance.locked_seed` is a number — the module rolled
   *  with a pinned seed instead of inheriting the chain seed. */
  seed_locked?: boolean;
  /** Constraint trace adds the source + target wildcard uuids so the
   *  debug viewer can label the row as `$src → $tgt` instead of an
   *  opaque `$<short-uuid>`. */
  constraint_source?: string;
  constraint_target?: string;
  error?: string | { type?: string; message?: string } | null;
  seed?: number;
}

interface WarningEntry {
  type?: string;
  /** Binding label rendered before the message — raw text passed to
   *  RichTextPreview so embedded `@{uuid}` refs render as colored
   *  chips. */
  bindingText?: string;
  /** Message body — raw text passed to RichTextPreview so embedded
   *  `@{uuid}` refs render as colored chips. */
  messageText?: string;
  severity?: "info" | "warning" | "error";
}

/** A `module_id → variable_name` lookup built from the trace. Used to
 *  re-key the raw `__wp_picks__` map (which is keyed by uuid) into a
 *  human-readable `$variable_name` view in the Picks tab. Also drives
 *  constraint-row labels (`$src → $tgt` cross-references via uuid).
 *
 *  Three lookup layers, tried in order:
 *    1. `writes[0].variable` — engine-trace shape, ok-status rows.
 *    2. `binding` — single-value field stamped by the pipeline on
 *       every trace entry (ok / disabled / error / unknown-type),
 *       so disabled / errored modules still resolve their label.
 *       Also covers the injector trace shape.
 *    3. `bindings[0]` — multi-binding fallback for disabled
 *       fixed_values modules where `binding` is not set but
 *       `bindings: string[]` lists every declared variable.
 *
 *  Falls back to uuid form when no layer matches — defensive for
 *  older snapshots, modules that ran in a different Context node not
 *  visible to this debug snapshot, etc. */
const moduleIdToVar = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const t of traceEntriesRaw.value) {
    const id = typeof t.id === "string" ? t.id : "";
    if (!id) continue;
    const firstWrite = Array.isArray(t.writes) ? t.writes[0] : undefined;
    const fromWrite = firstWrite && typeof firstWrite.variable === "string"
      ? firstWrite.variable
      : "";
    const fromBinding = typeof t.binding === "string" ? t.binding : "";
    const fromBindings = Array.isArray(t.bindings) && typeof t.bindings[0] === "string"
      ? t.bindings[0]
      : "";
    const name = fromWrite || fromBinding || fromBindings;
    if (name) map[id] = name;
  }
  return map;
});

/** Effective uuid→name map — trace entries win (canonical for this
 *  run), library entries (fetched lazily for unresolved refs) fill
 *  in references that didn't roll. Concrete state lives below, after
 *  `traceEntriesRaw` to avoid TDZ on the watch's `immediate: true`. */
const libraryNameMap = ref<Record<string, string>>({});
const effectiveIdMap = computed<Record<string, string>>(() => ({
  ...libraryNameMap.value,
  ...moduleIdToVar.value,
}));

/** Raw trace as the engine emits it. Kept separate from `traceRows`
 *  so the picks-tab lookup can scan unfiltered entries. */
const traceEntriesRaw = computed<TraceEntry[]>(() => {
  const trace = parsed.value?.__wp_trace__;
  return Array.isArray(trace) ? (trace as TraceEntry[]) : [];
});

// SPA library fallback for `@{uuid}` refs that the trace didn't roll.
// A wildcard option can reference another wildcard via `@{uuid}` —
// when that referenced wildcard didn't get picked this run, no trace
// entry carries its name and the chip would fall back to the raw
// short-uuid. Fetch the unresolved uuids from
// `/wp/api/modules/embed-bundle` (returns `payload.var_binding` per
// uuid) and merge into `libraryNameMap` so the ref tokenizer reads
// the friendly name even for refs that weren't part of this run.
//
// Cached per-uuid (via `libraryFetched`) so we don't re-fetch known
// ids across runs. Watch is `immediate: true` so the initial
// snapshot triggers a fetch — declared HERE (after `traceEntriesRaw`)
// rather than near the `libraryNameMap` ref because the watch's
// immediate-mode synchronously walks the dep chain and would TDZ on
// the forward-referenced `traceEntriesRaw`.
const libraryFetched = ref<Set<string>>(new Set());
const unresolvedUuids = computed<string[]>(() => {
  const idMap = moduleIdToVar.value;
  const out = new Set<string>();
  const re = /@\{([0-9a-f]{6,16})\}/gi;
  function scan(text: unknown): void {
    if (typeof text !== "string") return;
    for (const m of text.matchAll(re)) {
      const uuid = m[1];
      if (!idMap[uuid] && !libraryNameMap.value[uuid]) out.add(uuid);
    }
  }
  for (const v of Object.values(picks.value)) {
    if (v && typeof v === "object" && "value" in v) {
      scan((v as { value?: unknown }).value);
    }
  }
  for (const t of traceEntriesRaw.value) {
    if (Array.isArray(t.writes)) {
      for (const w of t.writes) scan((w as { value?: unknown }).value);
    }
    scan(t.binding);
    if (typeof t.error === "object" && t.error !== null && "message" in t.error) {
      scan((t.error as { message?: unknown }).message);
    }
    // Constraint rows label themselves as `$src → $tgt` using the
    // source / target wildcard uuids. If neither wildcard rolled on
    // this run (no trace entry), the trace's id map can't resolve
    // them — surface as candidates for the library lookup so the
    // row reads `$style → $mood` instead of `$ae07018b → $c0f09840`.
    if (typeof t.constraint_source === "string" && t.constraint_source) {
      const u = t.constraint_source;
      if (!idMap[u] && !libraryNameMap.value[u]) out.add(u);
    }
    if (typeof t.constraint_target === "string" && t.constraint_target) {
      const u = t.constraint_target;
      if (!idMap[u] && !libraryNameMap.value[u]) out.add(u);
    }
    // Trace entry's own module id — when writes is empty AND no
    // binding is stamped (e.g. constraint module that registers a
    // matrix but writes nothing, or any module the engine couldn't
    // bind), the row label falls back to `$<short-uuid>`. Library
    // fetch on the id gives us the var_binding so the row reads
    // `$style` instead of `$ae07018b`.
    if (typeof t.id === "string" && t.id && !idMap[t.id] && !libraryNameMap.value[t.id]) {
      out.add(t.id);
    }
  }
  // Also harvest the picks-map keys so a wildcard with no trace entry
  // (e.g. ran inside a separate Context node visible only via merged
  // ctx) still resolves to its var_binding for the picks tab label.
  for (const pid of Object.keys(picks.value)) {
    if (!idMap[pid] && !libraryNameMap.value[pid]) out.add(pid);
  }
  return [...out];
});

watch(
  unresolvedUuids,
  (uuids) => {
    const toFetch = uuids.filter((u) => !libraryFetched.value.has(u));
    if (toFetch.length === 0) return;
    // Mark as in-flight immediately so a re-trigger before the fetch
    // resolves doesn't queue a duplicate request for the same uuids.
    for (const u of toFetch) libraryFetched.value.add(u);
    if (typeof fetch !== "function") return;
    void fetch("/wp/api/modules/embed-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuids: toFetch }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || typeof data !== "object") return;
        const snaps = (data as { snapshots?: Record<string, unknown> }).snapshots;
        if (!snaps || typeof snaps !== "object") return;
        const next = { ...libraryNameMap.value };
        for (const [uuid, entry] of Object.entries(snaps)) {
          const e = entry as { name?: string; payload?: { var_binding?: string } };
          const name = e.payload?.var_binding ?? e.name;
          if (typeof name === "string" && name) next[uuid] = name;
        }
        libraryNameMap.value = next;
      })
      .catch(() => {
        // Best-effort. Falls back to short-uuid chips on failure.
      });
  },
  { immediate: true },
);

interface TraceRow {
  /** Stable React-key — `<module_id>:<binding>:<index>`. Same module
   *  may emit several rows when it writes multiple bindings (one row
   *  per write), so module_id alone isn't unique. */
  key: string;
  /** 1-indexed run order — the row's position in the flattened trace
   *  stream as the engine emitted it. Disambiguates same-variable
   *  rows (chains that overwrite `$foo` twice show two rows with
   *  different `runOrder`) and makes the table readable as a
   *  chronological log. */
  runOrder: number;
  /** Raw module_id, kept for the row-tooltip + debugging. */
  id: string;
  /** Friendly variable-first label — `$variable_name` when available,
   *  `$<short-uuid>` when a module ran but produced no bindings (e.g.
   *  a constraint-only module that only registers cross-cell rules). */
  label: string;
  /** Module type (`wildcard`, `fixed_values`, `combine`, ...). */
  type: string;
  /** Display alias for the type chip — `fixed_values` reads as
   *  `fixed` in the kind tokens (matches the rest of the app). */
  typeLabel: string;
  /** CSS class for the colored type chip — `wp-kind-chip--<kind>` so
   *  the type column reads with the same color family as the module
   *  rows in ContextWidget / ModulePickerModal / AssemblerHelper. */
  kindClass: string;
  /** Secondary value-type label (e.g. "STR" / "INT" / "FLOAT") —
   *  populated for injector trace rows so the user sees both the
   *  source (kind chip = injector) and the wire's underlying type.
   *  Empty / undefined for non-injector rows. */
  valueType?: string;
  /** True when the binding was produced via the injector's template
   *  path (substituted from `$slot` refs). Drives a small TPL badge
   *  next to the value-type chip. */
  isTemplate?: boolean;
  /** Status bucket — drives pill color. */
  status: "ok" | "skipped" | "error" | "unknown";
  /** Status label shown inside the pill (lowercase, terse). */
  statusLabel: string;
  /** Formatted picked / written value. */
  value: string;
  /** Full seed as string — rendered in full so the user can read /
   *  copy the actual number, not a "…841064" truncation. */
  seed: string;
  errorMessage: string | null;
  /** True when this write replaced an existing upstream value. */
  overwrite: boolean;
  /** True when the module was marked `instance.internal`. Drives the
   *  small lock-icon next to the variable label so users see at a
   *  glance that this binding is engine-only. */
  internal: boolean;
  /** True when the module had `instance.locked_seed` set — the seed
   *  cell renders with a pin glyph + tooltip explaining the run used
   *  a pinned seed not the chain seed. */
  seedLocked: boolean;
  /** True when the module was disabled — the row dims + the value
   *  cell shows `(disabled)` instead of a written value. */
  disabled: boolean;
}

function formatSeed(seed: number | undefined): string {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return "";
  return String(seed);
}

function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function categorizeStatus(raw: string | undefined, hasError: boolean): TraceRow["status"] {
  if (hasError || raw === "failed" || raw === "error") return "error";
  if (raw === "ok") return "ok";
  if (raw && raw.startsWith("skipped")) return "skipped";
  return raw ? "unknown" : "ok";
}

function statusLabelOf(raw: string | undefined, hasError: boolean): string {
  if (hasError) return "error";
  if (raw === "skipped_disabled") return "disabled";
  if (raw === "skipped_unknown_type") return "skipped";
  return raw || "ok";
}

/** Set of constraint module ids that the engine emitted a
 *  `constraint_never_applied` warning for — these registered into ctx
 *  but no downstream wildcard instance ever consumed them. The trace
 *  status for those rows still says `ok` because the constraint itself
 *  RAN (the module's `resolve` succeeded); the warning is the only
 *  signal of the no-op. Surfacing it inline as a "never fired" pill
 *  so the user reads the no-op without needing to cross-reference
 *  the Warnings tab. */
const unfiredConstraintIds = computed<Set<string>>(() => {
  const out = new Set<string>();
  for (const w of warnings.value) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    if (o.type !== "constraint_never_applied") continue;
    const mid = typeof o.module_id === "string" ? o.module_id : "";
    if (mid) out.add(mid);
  }
  return out;
});

/** Map raw engine type to the kind-token alias used by
 *  `wp-kind-chip--<alias>` rules in theme.css. `fixed_values` is
 *  aliased to `fixed` because the token system pre-dates the
 *  underscore form.
 *
 *  Injector trace entries (`node === "WP_ContextInjector"`) get their
 *  own "injector" kind chip — their raw `type` field carries the
 *  Python value type (`str` / `int` / `float` / `bool` / `str(template)`)
 *  which is value-type info, not module-kind info. Surfacing both:
 *  the kind chip says "injector" so the user reads where the binding
 *  came from, and a secondary `subLabel` carries the value type
 *  (rendered as a small companion chip in the type cell). */
interface KindInfo {
  label: string;
  cls: string;
  /** Optional secondary label rendered as a tiny chip next to the
   *  kind chip. Used by injector entries to surface the value type
   *  (str/int/float/bool/template) alongside the kind. */
  subLabel?: string;
  /** Whether the row represents a template-rendered binding (injector
   *  template path). Drives the tooltip + a subtle "TPL" badge style. */
  isTemplate?: boolean;
}
function kindAlias(type: string, node?: string): KindInfo {
  if (node === "WP_ContextInjector") {
    const t = (type || "").toLowerCase();
    const isTemplate = t.startsWith("str(template)") || t === "template";
    // Strip the `(template)` suffix from the value-type display —
    // the template-ness is conveyed by the isTemplate flag + tooltip,
    // not by the chip text.
    const sub = isTemplate ? "str" : t || "";
    return {
      label: "injector",
      cls: "wp-kind-chip--injector",
      subLabel: sub.toUpperCase() || undefined,
      isTemplate,
    };
  }
  switch (type) {
    case "wildcard":     return { label: "wildcard",   cls: "wp-kind-chip--wildcard" };
    case "fixed_values": return { label: "fixed",      cls: "wp-kind-chip--fixed" };
    case "combine":      return { label: "combine",    cls: "wp-kind-chip--combine" };
    case "derivation":   return { label: "derivation", cls: "wp-kind-chip--derivation" };
    case "constraint":   return { label: "constraint", cls: "wp-kind-chip--constraint" };
    default:             return { label: type || "—",  cls: "wp-kind-chip--unknown" };
  }
}

/** Trace rows — projection of the raw engine + injector trace into a
 *  table-friendly shape. **Multi-write modules expand into multiple
 *  rows** — a single fixed_values module that writes 3 bindings
 *  produces 3 trace rows, one per binding, sharing module-id / type /
 *  seed metadata. Modules with no writes (e.g. constraint-only) get
 *  one row labelled with the constraint's source→target binding so
 *  the user reads the relationship instead of an opaque short-uuid.
 *  Disabled modules surface their declared binding(s) so the row
 *  reads as `$varname (disabled)` rather than `$<short-uuid>`. */
const traceRows = computed<TraceRow[]>(() => {
  const rows: TraceRow[] = [];
  const idMap = effectiveIdMap.value;
  // `seq` counts flattened rows (1-indexed) so each row gets a
  // chronological RUN order regardless of fan-out. `entryIdx` is the
  // original trace entry's position — included in the row key so
  // duplicate variables (chain rolls `$chain_a` twice from different
  // modules) get distinct keys even if module ids happen to match.
  let seq = 0;
  for (let entryIdx = 0; entryIdx < traceEntriesRaw.value.length; entryIdx++) {
    const t = traceEntriesRaw.value[entryIdx];
    const id = typeof t.id === "string" ? t.id : "";
    const hasError = !!t.error;
    const errMsg =
      hasError && typeof t.error === "object" && t.error !== null && "message" in t.error
        ? String((t.error as { message?: string }).message ?? "error")
        : hasError && typeof t.error === "string"
          ? t.error
          : null;
    const kind = kindAlias(t.type || "", t.node);
    const isDisabled = t.status === "skipped_disabled";
    const isInternal = !!t.internal;
    const isSeedLocked = !!t.seed_locked;
    const baseRow = {
      id,
      type: t.type || "—",
      typeLabel: kind.label,
      kindClass: kind.cls,
      valueType: kind.subLabel,
      isTemplate: !!kind.isTemplate,
      status: categorizeStatus(t.status, hasError),
      statusLabel: statusLabelOf(t.status, hasError),
      seed: formatSeed(t.seed),
      errorMessage: errMsg,
      internal: isInternal,
      seedLocked: isSeedLocked,
      disabled: isDisabled,
    };

    const writes = Array.isArray(t.writes) ? t.writes : [];
    if (writes.length > 0) {
      // Engine trace path — fan out one row per binding written so
      // multi-binding modules (a fixed_values block declaring 3
      // variables) show all three.
      writes.forEach((w, i) => {
        seq += 1;
        rows.push({
          ...baseRow,
          runOrder: seq,
          key: `${entryIdx}:${id || t.type || "row"}:${w.variable || "anon"}:${i}`,
          label: w.variable ? `$${w.variable}` : (id ? `$${id.slice(0, 8)}` : "—"),
          value: formatValue(w.value),
          overwrite: !!w.overwrite,
        });
      });
    } else if (Array.isArray(t.bindings) && t.bindings.length > 0) {
      // Disabled multi-binding module (fixed_values) — surface every
      // declared binding as its own row so the user sees what would
      // have been written. Value cell shows `(disabled)` so the
      // status is unmistakable.
      t.bindings.forEach((b, i) => {
        seq += 1;
        rows.push({
          ...baseRow,
          runOrder: seq,
          key: `${entryIdx}:${id || t.type || "row"}:${b}:${i}`,
          label: `$${b}`,
          value: "(disabled)",
          overwrite: false,
        });
      });
    } else if (t.binding) {
      // Single-binding module (engine-side disabled / errored, or
      // injector trace `{node, binding, type, internal, value}`).
      // Engine disabled rows surface the declared binding here;
      // injector rows surface the binding the row writes. Either way:
      // prefix with `$` and let the value cell carry the (disabled)
      // hint OR the written value when present.
      seq += 1;
      rows.push({
        ...baseRow,
        runOrder: seq,
        key: `${entryIdx}:${id || t.node || "row"}:${t.binding}`,
        label: `$${t.binding}`,
        value: isDisabled
          ? "(disabled)"
          : t.value !== undefined
            ? formatValue(t.value)
            : "",
        overwrite: false,
      });
    } else if (t.constraint_source && t.constraint_target) {
      // Constraint trace — no binding to write, but the source +
      // target wildcard uuids let us label the row as `$src → $tgt`
      // when both can be resolved to variable names. Falls back to
      // short-uuid form when a referenced wildcard didn't roll (no
      // trace entry for it).
      const srcVar = idMap[t.constraint_source];
      const tgtVar = idMap[t.constraint_target];
      const srcLabel = srcVar ? `$${srcVar}` : `$${t.constraint_source.slice(0, 8)}`;
      const tgtLabel = tgtVar ? `$${tgtVar}` : `$${t.constraint_target.slice(0, 8)}`;
      // Constraint that registered but never claimed a downstream
      // target instance — the engine emits a `constraint_never_applied`
      // warning AT chain end. Swap the row's "ok" status to a
      // "never fired" skipped pill so the no-op reads inline.
      const neverFired = !isDisabled && id !== "" && unfiredConstraintIds.value.has(id);
      seq += 1;
      rows.push({
        ...baseRow,
        status: neverFired ? "skipped" : baseRow.status,
        statusLabel: neverFired ? "never fired" : baseRow.statusLabel,
        runOrder: seq,
        key: `${entryIdx}:${id || "constraint"}`,
        label: `${srcLabel} → ${tgtLabel}`,
        value: isDisabled ? "(disabled)" : "",
        overwrite: false,
      });
    } else {
      // Module ran but produced no bindings AND no metadata to
      // disambiguate. Last-resort short-uuid label so the row stays
      // visible for status visibility.
      seq += 1;
      rows.push({
        ...baseRow,
        runOrder: seq,
        key: `${entryIdx}:${id || t.type || "row"}`,
        label: id ? `$${id.slice(0, 8)}` : "—",
        value: isDisabled ? "(disabled)" : "",
        overwrite: false,
      });
    }
  }
  return rows;
});

interface PickRow {
  /** `$varname` for display, falls back to `$<short-uuid>` when the
   *  trace doesn't carry a variable name for this module. */
  label: string;
  /** The picked option's `value` field as raw text. RichTextPreview
   *  parses `@{uuid}` tokens into colored chips on render. */
  valueText: string;
  /** Sub-category tag — shown as a small chip. Empty = no sub-cat. */
  subCategory: string;
  /** Raw uuid — kept around so power-users can still see which module
   *  the row came from in a tooltip. */
  rawId: string;
}

/** `uuid → name` Map view of `effectiveIdMap` — RichTextPreview takes
 *  a Map for its `uuidToName` prop. Built once per reactive tick so
 *  every chip-rendering site (picks values, trace values, warnings)
 *  shares the same lookup, and the library-fetch fallback flows
 *  through automatically.
 *
 *  Note: RichTextPreview ALSO consults the global preview-resolver
 *  cache as a deeper fallback (`@{uuid}` refs that aren't in the
 *  trace's id map AND aren't in this widget's libraryNameMap still
 *  resolve via the shared cache populated by other surfaces). The
 *  net effect is that no surface in the app should render a raw
 *  short-uuid for a known wildcard. */
const uuidToNameMap = computed<Map<string, string>>(() => {
  const m = new Map<string, string>();
  for (const [uuid, name] of Object.entries(effectiveIdMap.value)) {
    if (typeof name === "string" && name) m.set(uuid, name);
  }
  return m;
});

/** Picks tab — re-key raw `__wp_picks__[module_id]` map into a list of
 *  `$variable_name → value` rows. Splits the option dict's `value` /
 *  `sub_category` into separate columns so the user reads "what got
 *  picked" without parsing JSON. Nested `@{uuid}` refs in the value
 *  string get tokenized into ref-chip segments so they render as
 *  styled `@varname` chips, not raw text. */
const pickRows = computed<PickRow[]>(() => {
  const idMap = effectiveIdMap.value;
  return Object.entries(picks.value).map(([rawId, opt]): PickRow => {
    const varName = idMap[rawId];
    const label = varName ? `$${varName}` : `$${rawId.slice(0, 8)}`;
    let value = "";
    let subCategory = "";
    if (opt && typeof opt === "object") {
      const o = opt as Record<string, unknown>;
      value = formatValue(o.value);
      subCategory = typeof o.sub_category === "string" ? o.sub_category : "";
    } else {
      value = formatValue(opt);
    }
    return { label, valueText: value, subCategory, rawId };
  });
});

const traceCount = computed(() => traceRows.value.length);

/** Typed warnings list — coerce loose dicts into a known shape so
 *  rendering can pull severity / message reliably. Defaults severity
 *  to "warning" when the engine didn't tag one. Warning messages
 *  (e.g. cycle-detected paths like `Cycle: @{d9cb9f0f} → @{8c299ebd}
 *  → @{d9cb9f0f}`) get tokenized so embedded `@{uuid}` refs render
 *  as colored chips: `Cycle: @cycle_a → @cycle_b → @cycle_a`. */
const warningEntries = computed<WarningEntry[]>(() => {
  return warnings.value.map((w): WarningEntry => {
    if (!w || typeof w !== "object") {
      return { type: "unknown", messageText: String(w) };
    }
    const o = w as Record<string, unknown>;
    const rawMsg = typeof o.message === "string" ? o.message : "";
    const rawBinding = typeof o.binding === "string" ? o.binding : "";
    return {
      type: typeof o.type === "string" ? o.type : "unknown",
      bindingText: rawBinding || undefined,
      messageText: rawMsg || undefined,
      severity: (o.severity === "info" || o.severity === "warning" || o.severity === "error")
        ? o.severity
        : "warning",
    };
  });
});

const toolbarCopyFlash = ref(false);
let toolbarCopyFlashTimer: number | null = null;
async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(bodyText.value);
    // Brief affordance — icon swap + tooltip change for ~1.2s so the
    // user sees the copy fired (no toast singleton needed here).
    toolbarCopyFlash.value = true;
    if (toolbarCopyFlashTimer != null) window.clearTimeout(toolbarCopyFlashTimer);
    toolbarCopyFlashTimer = window.setTimeout(() => { toolbarCopyFlash.value = false; }, 1200);
  } catch { /* permission denied — silent */ }
}

/** Tab-aware label so the toolbar copy/download tooltip tells the
 *  user WHAT they're about to copy/download (Snapshot vs Trace vs
 *  Picks vs Warnings JSON). */
const activeTabLabel = computed(() => {
  switch (activeTab.value) {
    case "trace":    return "trace";
    case "picks":    return "picks";
    case "warnings": return "warnings";
    case "snapshot":
    default:         return "snapshot";
  }
});

/** Tracks the last copied row's stable key so the cell can flash a
 *  brief "copied" hint without needing a global toast. Keyed by
 *  `row.key` (not by seed value) so chains where many modules share
 *  the same seed only flash the row the user actually clicked —
 *  pre-fix using `seed` as the key meant every row sharing that
 *  seed lit up simultaneously. Cleared after 1.2s. */
const copiedSeedKey = ref<string | null>(null);
let copiedSeedTimer: number | null = null;

async function copySeed(seed: string, rowKey: string, ev: MouseEvent): Promise<void> {
  if (!seed) return;
  ev.stopPropagation();
  try {
    await navigator.clipboard.writeText(seed);
    copiedSeedKey.value = rowKey;
    if (copiedSeedTimer != null) window.clearTimeout(copiedSeedTimer);
    copiedSeedTimer = window.setTimeout(() => { copiedSeedKey.value = null; }, 1200);
  } catch { /* clipboard permission denied — silent */ }
}

function downloadJson(): void {
  if (!parsed.value) return;
  const blob = new Blob([props.snapshot], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wp-debug-snapshot.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Right-click context menu (trace + pick rows) ────────────────────
// Reuses shared ContextMenu so the affordance matches Module rows /
// Bundle headers / Injector rows. Items adapt to the row kind:
//   - Trace row: Copy value, Copy $var, Copy seed (if any), Copy module id (if any)
//   - Pick row:  Copy value, Copy $var
// Header reads `Trace · $var` / `Pick · $var` so the user reads which
// entity the menu is for (mirrors the module/injector ctxmenu pattern).
async function clipboardWrite(text: string): Promise<void> {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* permission denied — silent */ }
}

// ── State-driven min-width ──────────────────────────────────────────
// Computed from the toolbar/tabs row contents so the node can't be
// dragged narrower than its own chrome. Values mirror the CSS knowns
// (tab padding, badge widths, filter input min, button widths, gaps).
// Re-emits on tab change because the filter input appears only on
// trace + picks tabs.
const PANE_PART = {
  // Tab pill: 10px×2 padding + ~50px label width + 12px badge + 4px gap
  TAB:           76,
  TAB_GAP:        2,
  TABS_COUNT:     4,
  // Toolbar: copy + download buttons (24px each, 4px gap)
  TOOLBAR_BTNS:  52,
  TOOLBAR_GAP:    4,
  // Filter (only on trace/picks tabs): 160px min-width + 4px gap to neighbor
  FILTER:       164,
  // Outer padding/borders
  CONTAINER_H:   24,
} as const;
const requiredMinWidth = computed(() => {
  const p = PANE_PART;
  const tabs = p.TAB * p.TABS_COUNT + p.TAB_GAP * (p.TABS_COUNT - 1);
  const toolbar = p.TOOLBAR_BTNS + p.TOOLBAR_GAP;
  const filter = (activeTab.value === "trace" || activeTab.value === "picks") ? p.FILTER : 0;
  return tabs + filter + toolbar + p.CONTAINER_H;
});
watch(requiredMinWidth, (w) => emit("request-min-width", w), { immediate: true });

// ── Filter + pin ────────────────────────────────────────────────────
// Trace + pick tabs grow long quickly on real workflows. A filter
// input narrows the list to rows whose `$var` name or rendered
// value matches a substring. Pinned rows (toggled via the per-row
// ctxmenu) are ALWAYS visible regardless of filter — so the user
// can keep one variable in view while sifting through the rest.
const filterQuery = ref<string>("");
const pinnedKeys = ref<Set<string>>(new Set());
function togglePin(key: string): void {
  const next = new Set(pinnedKeys.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  pinnedKeys.value = next;
}
function matchesFilter(text: string): boolean {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

/** Trace rows after filtering. Pinned rows always pass; everything
 *  else has to match the query in label or value. */
const visibleTraceRows = computed<TraceRow[]>(() => {
  const q = filterQuery.value.trim();
  if (!q) return traceRows.value;
  return traceRows.value.filter((r) =>
    pinnedKeys.value.has(r.key) ||
    matchesFilter(r.label) ||
    matchesFilter(r.value || ""),
  );
});

/** Pick rows after filtering. Same pin-overrides-filter rule. The
 *  filter walks every segment so `@refname` matches via the
 *  resolved ref text. */
const visiblePickRows = computed<PickRow[]>(() => {
  const q = filterQuery.value.trim();
  if (!q) return pickRows.value;
  return pickRows.value.filter((r) => {
    if (pinnedKeys.value.has(r.rawId)) return true;
    if (matchesFilter(r.label)) return true;
    if (matchesFilter(r.valueText)) return true;
    return matchesFilter(r.subCategory || "");
  });
});

// ── Recently-changed trace rows ─────────────────────────────────────
// Track each trace row's last-rendered value across snapshot updates.
// When a value changes between runs, flash the row briefly via the
// shared `wp-row-flash` class — the user spots which bindings rolled
// differently without diffing manually. Pulses clear ~600ms after
// trigger; tracking happens via a non-reactive Map (we only need
// `recentlyChangedKeys` to be reactive for the visual class binding).
const recentlyChangedKeys = ref<Set<string>>(new Set());
const prevTraceValueByKey = new Map<string, string>();
watch(
  () => traceRows.value,
  (rows) => {
    const fresh = new Set<string>();
    for (const r of rows) {
      const prev = prevTraceValueByKey.get(r.key);
      if (prev !== undefined && prev !== r.value) fresh.add(r.key);
      prevTraceValueByKey.set(r.key, r.value);
    }
    if (fresh.size === 0) return;
    // Merge with anything still flashing so back-to-back changes
    // don't cancel mid-pulse.
    const merged = new Set(recentlyChangedKeys.value);
    for (const k of fresh) merged.add(k);
    recentlyChangedKeys.value = merged;
    window.setTimeout(() => {
      const next = new Set(recentlyChangedKeys.value);
      for (const k of fresh) next.delete(k);
      recentlyChangedKeys.value = next;
    }, 600);
  },
  { deep: false },
);

// ── Expand long trace values (click-to-wrap) ──────────────────────
// Trace value cell is single-line ellipsized so the table reads
// compactly. Clicking a value toggles its row into a pre-wrap state —
// the full string wraps under the cell. Picks tab values already
// wrap naturally so no toggle there.
const expandedTraceKeys = ref<Set<string>>(new Set());
function toggleTraceExpand(key: string): void {
  const next = new Set(expandedTraceKeys.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  expandedTraceKeys.value = next;
}

/** DOM-measured set of trace rows whose value cell actually overflows
 *  its column (and therefore benefits from click-to-expand). Walked
 *  via `data-trace-key` after each render. Re-measured on column
 *  resize via a ResizeObserver on the trace container — node-width
 *  changes (user drags wider) re-evaluate which rows still overflow.
 *
 *  Beats a hardcoded char-count heuristic: a 50-char value with all
 *  narrow letters fits; a 25-char value with wide caps + mono font
 *  doesn't. Measurement is authoritative. */
const overflowingTraceKeys = ref<Set<string>>(new Set());
function measureOverflow(): void {
  const cells = document.querySelectorAll<HTMLElement>(
    ".wp-debug [data-trace-value-cell]",
  );
  if (!cells.length) {
    if (overflowingTraceKeys.value.size > 0) overflowingTraceKeys.value = new Set();
    return;
  }
  const next = new Set<string>();
  for (const el of cells) {
    if (el.classList.contains("wp-dbg-trace-value--expanded")) {
      // Already expanded — keep it in the set so the expand affordance
      // (cursor + bg) stays visible. scrollWidth match clientWidth
      // when expanded so we can't measure overflow directly.
      const key = el.dataset.traceValueCell;
      if (key) next.add(key);
      continue;
    }
    if (el.scrollWidth > el.clientWidth + 1) {
      const key = el.dataset.traceValueCell;
      if (key) next.add(key);
    }
  }
  // Cheap equality check — only swap the ref if the set actually changed.
  const cur = overflowingTraceKeys.value;
  if (next.size !== cur.size) { overflowingTraceKeys.value = next; return; }
  for (const k of next) if (!cur.has(k)) { overflowingTraceKeys.value = next; return; }
}

/** Predicate consulted by the template: cell is expandable if DOM
 *  measurement says its content overflows OR the user already
 *  expanded it (we want to keep the affordance visible until
 *  collapsed). Empty / placeholder values short-circuit to false. */
function isExpandableValue(row: TraceRow): boolean {
  if (!row.value || row.value === "—" || row.value === "(disabled)") return false;
  return overflowingTraceKeys.value.has(row.key) || expandedTraceKeys.value.has(row.key);
}

// Re-measure after every reactive update that affects the trace
// table — new snapshot, filter change, pin toggle, etc. Vue runs
// `onUpdated` post-DOM-commit so measurements see the final layout.
// ResizeObserver on the trace container catches node-width drags
// (user makes the node wider → some previously-overflowing rows
// stop overflowing).
let traceResizeObserver: ResizeObserver | null = null;
onMounted(() => {
  measureOverflow();
  const container = document.querySelector(".wp-dbg-trace");
  if (container && typeof ResizeObserver === "function") {
    traceResizeObserver = new ResizeObserver(() => measureOverflow());
    traceResizeObserver.observe(container);
  }
});
onUpdated(() => {
  // Vue calls this AFTER DOM patches land. The trace container
  // element may swap if it was hidden by a tab switch — reattach
  // the observer if needed.
  measureOverflow();
  if (traceResizeObserver) {
    const container = document.querySelector(".wp-dbg-trace");
    if (container) traceResizeObserver.observe(container);
  }
});
onBeforeUnmount(() => {
  traceResizeObserver?.disconnect();
  traceResizeObserver = null;
});

interface DbgCtxMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  header?: { icon: string; label: string; iconColor?: string };
}
const ctxMenu = ref<DbgCtxMenuState>({ visible: false, x: 0, y: 0, items: [] });

/** Row key of the entity whose ctxmenu is currently open. Drives the
 *  `wp-dbg-trace-row--ctx-active` / `wp-dbg-pick-row--ctx-active`
 *  class so the user sees which row the menu targets. Cleared when
 *  the menu closes. */
const ctxActiveKey = ref<string | null>(null);
function closeCtxMenu(): void {
  ctxMenu.value.visible = false;
  ctxActiveKey.value = null;
}

function openCtxMenu(
  ev: MouseEvent,
  items: ContextMenuItem[],
  header?: DbgCtxMenuState["header"],
): void {
  ev.preventDefault();
  ev.stopPropagation();
  const estW = 250;
  const estH = 220;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  ctxMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    items,
    header,
  };
}

function openTraceRowMenu(ev: MouseEvent, row: TraceRow): void {
  const varName = row.label.replace(/^\$/, "");
  const isPinned = pinnedKeys.value.has(row.key);
  const items: ContextMenuItem[] = [
    {
      label: isPinned ? "Unpin row" : "Pin row",
      icon: isPinned ? "pi-star-fill" : "pi-star",
      subtitle: isPinned ? "Allow this row to be filtered out" : "Always show, even when filter is active",
      onSelect: () => togglePin(row.key),
      divider: true,
    },
    {
      label: "Copy value",
      icon: "pi-clone",
      disabled: !row.value || row.value === "(disabled)" || row.value === "—",
      onSelect: () => { void clipboardWrite(row.value); },
    },
    {
      label: `Copy $${varName}`,
      icon: "pi-dollar",
      disabled: !varName || varName === "—",
      onSelect: () => { void clipboardWrite(`$${varName}`); },
    },
  ];
  if (row.seed) {
    items.push({
      label: "Copy seed",
      icon: "pi-hashtag",
      onSelect: () => { void clipboardWrite(row.seed); },
    });
  }
  if (row.id) {
    items.push({
      label: "Copy module id",
      icon: "pi-id-card",
      divider: true,
      onSelect: () => { void clipboardWrite(row.id); },
    });
  }
  ctxActiveKey.value = row.key;
  openCtxMenu(ev, items, {
    icon: "pi-bolt",
    label: `Trace · ${row.label}`,
  });
}

function openPickRowMenu(ev: MouseEvent, row: PickRow): void {
  const varName = row.label.replace(/^\$/, "");
  const isPinned = pinnedKeys.value.has(row.rawId);
  // Plain value text — RichTextPreview handles chip rendering but
  // copy actions just need the raw string the engine emitted.
  const plainValue = row.valueText;
  const items: ContextMenuItem[] = [
    {
      label: isPinned ? "Unpin row" : "Pin row",
      icon: isPinned ? "pi-star-fill" : "pi-star",
      subtitle: isPinned ? "Allow this row to be filtered out" : "Always show, even when filter is active",
      onSelect: () => togglePin(row.rawId),
      divider: true,
    },
    {
      label: "Copy value",
      icon: "pi-clone",
      disabled: !plainValue,
      onSelect: () => { void clipboardWrite(plainValue); },
    },
    {
      label: `Copy $${varName}`,
      icon: "pi-dollar",
      disabled: !varName,
      onSelect: () => { void clipboardWrite(`$${varName}`); },
    },
  ];
  if (row.rawId) {
    items.push({
      label: "Copy module id",
      icon: "pi-id-card",
      divider: true,
      onSelect: () => { void clipboardWrite(row.rawId); },
    });
  }
  ctxActiveKey.value = row.rawId;
  openCtxMenu(ev, items, {
    icon: "pi-sparkles",
    label: `Pick · ${row.label}`,
  });
}
</script>

<template>
  <div class="wp-debug" :class="{ 'wp-debug--skipped': isSkipped }">
    <div v-if="parsed" class="wp-dbg-tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        :class="['wp-dbg-tab', { 'is-active': activeTab === t.id }]"
        :aria-selected="activeTab === t.id"
        @click="activeTab = t.id"
      >
        {{ t.label }}
        <span
          v-if="t.id === 'trace' && traceCount"
          class="wp-dbg-tab-badge"
        >{{ traceCount }}</span>
        <span
          v-else-if="t.id === 'picks' && picksCount"
          class="wp-dbg-tab-badge"
        >{{ picksCount }}</span>
        <span
          v-else-if="t.id === 'warnings' && warningsCount"
          class="wp-dbg-tab-badge wp-dbg-tab-badge--warn"
        >{{ warningsCount }}</span>
      </button>

      <div class="wp-dbg-toolbar">
        <div
          v-if="activeTab === 'trace' || activeTab === 'picks'"
          class="wp-dbg-filter"
        >
          <i class="pi pi-search wp-dbg-filter__icon" aria-hidden="true" />
          <input
            v-model="filterQuery"
            type="text"
            class="wp-dbg-filter__input"
            data-test="dbg-filter"
            :placeholder="`Filter ${activeTabLabel}…`"
            :aria-label="`Filter ${activeTabLabel} entries`"
            spellcheck="false"
          />
          <button
            v-if="filterQuery"
            type="button"
            class="wp-dbg-filter__clear"
            title="Clear filter"
            aria-label="Clear filter"
            @click="filterQuery = ''"
          ><i class="pi pi-times" aria-hidden="true" /></button>
        </div>
        <button
          type="button"
          class="wp-btn wp-btn--icon"
          :class="{ 'is-flashed': toolbarCopyFlash }"
          data-test="dbg-copy"
          :title="toolbarCopyFlash ? 'Copied!' : `Copy ${activeTabLabel} JSON to clipboard`"
          :aria-label="`Copy ${activeTabLabel} JSON`"
          @click="copyToClipboard"
        ><i :class="['pi', toolbarCopyFlash ? 'pi-check' : 'pi-copy']" /></button>
        <button
          type="button"
          class="wp-btn wp-btn--icon"
          data-test="dbg-download"
          title="Download full snapshot as JSON file"
          aria-label="Download snapshot JSON"
          @click="downloadJson"
        ><i class="pi pi-download" /></button>
      </div>
    </div>

    <!-- Snapshot / Trace tabs use raw highlighted JSON since both
         can hold deeply nested structures. Picks + warnings get
         dedicated table-style renders since their shape is fixed. -->
    <pre
      v-if="parsed && (activeTab === 'snapshot')"
      class="wp-dbg-pre"
      v-html="bodyHtml"
    ></pre>

    <!-- Trace — variable-first table. The "what" column shows the
         friendly `$varname` so users scan their bindings, not the raw
         module-uuid. Status gets a color pill. Value column shows
         what got written. Seed truncated to last 6 digits to keep the
         table tight. Hover any row to see the full uuid via the
         `title` tooltip. -->
    <div v-else-if="parsed && activeTab === 'trace'" class="wp-dbg-pane">
      <div v-if="traceRows.length > 0" class="wp-dbg-trace">
        <div class="wp-dbg-trace-row wp-dbg-trace-row--head">
          <span class="wp-dbg-trace-seq" title="Run order — the position of this trace entry in execution sequence">#</span>
          <span>variable</span>
          <span>type</span>
          <span>status</span>
          <span>value</span>
          <span class="wp-dbg-trace-seed">seed</span>
        </div>
        <div
          v-for="row in visibleTraceRows"
          :key="row.key"
          class="wp-dbg-trace-row"
          :class="[
            `wp-dbg-trace-row--${row.status}`,
            {
              'wp-dbg-trace-row--disabled': row.disabled,
              'wp-row-flash': recentlyChangedKeys.has(row.key),
              'wp-dbg-row--ctx-active': ctxActiveKey === row.key,
              'wp-dbg-row--pinned': pinnedKeys.has(row.key),
            },
          ]"
          :title="row.id ? `module ${row.id}` : ''"
          @contextmenu="(ev) => openTraceRowMenu(ev, row)"
        >
          <span class="wp-dbg-trace-seq" :title="`Run order ${row.runOrder}`">{{ row.runOrder }}</span>
          <span class="wp-dbg-trace-label">
            <i
              v-if="pinnedKeys.has(row.key)"
              class="pi pi-star-fill wp-dbg-row-pin"
              title="Pinned — always visible regardless of filter (right-click row to unpin)"
              aria-hidden="true"
            />
            {{ row.label }}
            <span v-if="row.overwrite" class="wp-dbg-trace-flag" title="Overwrote upstream value">↻</span>
            <!-- Internal flag — `instance.internal` was set, every
                 binding the module wrote is engine-only (stripped
                 from public ctx). Globe icon mirrors ContextWidget's
                 internal-toggle button (`row-action-internal`) so the
                 same glyph means the same thing across the app. -->
            <i
              v-if="row.internal"
              class="wp-dbg-trace-flag pi pi-globe"
              title="Internal — binding hidden from public ctx"
              aria-hidden="true"
            ></i>
            <!-- Seed-lock flag — module rolled with `instance.locked_seed`
                 instead of inheriting the chain seed. Lock icon
                 mirrors ContextWidget's seed-lock toggle button
                 (`row-action-lock`) — same glyph, same meaning. -->
            <i
              v-if="row.seedLocked"
              class="wp-dbg-trace-flag pi pi-lock"
              title="Locked seed — module rolled with a pinned seed"
              aria-hidden="true"
            ></i>
          </span>
          <!-- Type chip uses the same `wp-kind-chip--<kind>` token as
               the row icons in ContextWidget / ModulePickerModal /
               AssemblerHelper, so the user reads the trace in the
               same color family they already know from picking +
               assembling. -->
          <span class="wp-dbg-trace-type-cell">
            <span
              class="wp-dbg-trace-type wp-kind-chip"
              :class="row.kindClass"
            >{{ row.typeLabel }}</span>
            <span
              v-if="row.valueType"
              class="wp-dbg-trace-subtype"
              :class="`wp-dbg-trace-subtype--${row.valueType.toLowerCase()}`"
              :title="row.isTemplate
                ? `Template-rendered string (engine substituted $slot refs at run time)`
                : `Value type carried on the wire (${row.valueType.toLowerCase()})`"
            >{{ row.valueType }}</span>
            <span
              v-if="row.isTemplate"
              class="wp-dbg-trace-tpl"
              title="Template path — engine substituted $slot_name refs against wired sockets before writing to ctx"
            >TPL</span>
          </span>
          <span
            class="wp-dbg-trace-pill"
            :class="`wp-dbg-trace-pill--${row.status}`"
            :title="row.errorMessage || row.statusLabel"
          >{{ row.statusLabel }}</span>
          <span
            class="wp-dbg-trace-value"
            :data-trace-value-cell="row.key"
            :class="{
              'wp-dbg-trace-value--expandable': isExpandableValue(row),
              'wp-dbg-trace-value--expanded': expandedTraceKeys.has(row.key),
            }"
            :title="isExpandableValue(row)
              ? `${row.value}\n\nClick to ${expandedTraceKeys.has(row.key) ? 'collapse' : 'expand'}`
              : (row.value || '')"
            @click.stop="isExpandableValue(row) && toggleTraceExpand(row.key)"
          >
            <RichTextPreview
              v-if="row.value"
              :value="row.value"
              :uuid-to-name="uuidToNameMap"
              surface="wildcard"
            />
            <template v-else>—</template>
          </span>
          <button
            v-if="row.seed"
            type="button"
            class="wp-dbg-trace-seed wp-dbg-trace-seed--clickable"
            :class="{ 'is-copied': copiedSeedKey === row.key }"
            :title="copiedSeedKey === row.key ? 'Copied!' : 'Click to copy seed'"
            @click="(ev) => copySeed(row.seed, row.key, ev)"
          >{{ copiedSeedKey === row.key ? "✓ copied" : row.seed }}</button>
          <span v-else class="wp-dbg-trace-seed"></span>
        </div>
      </div>
      <div v-else class="wp-debug__empty wp-debug__empty--state">
        <i class="pi pi-bolt wp-debug__empty-icon" aria-hidden="true" />
        <span class="wp-debug__empty-line">No modules ran yet.</span>
        <span class="wp-debug__empty-hint">Try executing the graph.</span>
      </div>
    </div>

    <!-- Picks — `$variable` → resolved value table. Variable names
         pulled via the trace's `module_id → variable_name` lookup, so
         a wildcard whose pick was `b0219910` reads as `$backdrop`.
         Sub-category surfaces as a small chip when present (carries
         the constraint-aware metadata). -->
    <div v-else-if="parsed && activeTab === 'picks'" class="wp-dbg-pane">
      <div v-if="pickRows.length > 0" class="wp-dbg-picks">
        <div class="wp-dbg-pick-row wp-dbg-pick-row--head">
          <span>variable</span>
          <span>value</span>
          <span>sub-category</span>
        </div>
        <div
          v-for="row in visiblePickRows"
          :key="row.rawId"
          class="wp-dbg-pick-row"
          :class="{
            'wp-dbg-row--ctx-active': ctxActiveKey === row.rawId,
            'wp-dbg-row--pinned': pinnedKeys.has(row.rawId),
          }"
          :title="`module ${row.rawId}`"
          @contextmenu="(ev) => openPickRowMenu(ev, row)"
        >
          <span class="wp-dbg-pick-key">
            <i
              v-if="pinnedKeys.has(row.rawId)"
              class="pi pi-star-fill wp-dbg-row-pin"
              title="Pinned — always visible regardless of filter (right-click row to unpin)"
              aria-hidden="true"
            />
            {{ row.label }}
          </span>
          <span class="wp-dbg-pick-val">
            <RichTextPreview
              :value="row.valueText"
              :uuid-to-name="uuidToNameMap"
              surface="wildcard"
            />
          </span>
          <span
            v-if="row.subCategory"
            class="wp-dbg-pick-cat"
          >{{ row.subCategory }}</span>
        </div>
      </div>
      <div v-else class="wp-debug__empty wp-debug__empty--state">
        <i class="pi pi-sparkles wp-debug__empty-icon" aria-hidden="true" />
        <span class="wp-debug__empty-line">No wildcard picks this run.</span>
        <span class="wp-debug__empty-hint">Wire a Context node with at least one wildcard.</span>
      </div>
    </div>

    <!-- Warnings — severity dot + text per row. Same color tokens as
         conflict scanner so warnings here read as the same family. -->
    <div v-else-if="parsed && activeTab === 'warnings'" class="wp-dbg-pane">
      <div v-if="warningEntries.length > 0" class="wp-dbg-warnings">
        <div
          v-for="(w, i) in warningEntries"
          :key="i"
          class="wp-dbg-warn-row"
          :class="`wp-dbg-warn-row--${w.severity}`"
        >
          <span class="wp-dbg-warn-dot" :class="`wp-dbg-warn-dot--${w.severity}`" aria-hidden="true"></span>
          <span class="wp-dbg-warn-type">{{ w.type }}</span>
          <span v-if="w.bindingText" class="wp-dbg-warn-binding">
            <RichTextPreview
              :value="`$${w.bindingText}`"
              :uuid-to-name="uuidToNameMap"
              surface="wildcard"
            />
          </span>
          <span v-if="w.messageText" class="wp-dbg-warn-msg">
            <RichTextPreview
              :value="w.messageText"
              :uuid-to-name="uuidToNameMap"
              surface="wildcard"
            />
          </span>
        </div>
      </div>
      <div v-else class="wp-debug__empty wp-debug__empty--state">
        <i class="pi pi-check-circle wp-debug__empty-icon wp-debug__empty-icon--ok" aria-hidden="true" />
        <span class="wp-debug__empty-line">No warnings.</span>
        <span class="wp-debug__empty-hint">All resolved variables look clean.</span>
      </div>
    </div>

    <div v-if="!parsed" class="wp-debug__empty wp-debug__empty--state wp-debug__empty--prerun">
      <i class="pi pi-hourglass wp-debug__empty-icon" aria-hidden="true" />
      <span class="wp-debug__empty-line">No snapshot yet.</span>
      <span class="wp-debug__empty-hint">Run the graph to capture context, trace, picks, and warnings.</span>
    </div>

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      :header="ctxMenu.header"
      @close="closeCtxMenu"
    />
  </div>
</template>

<style>
@import "../shared/theme.css";
/* `wp-row-flash` + `wp-drop-pulse` keyframes live here so Debug's
 * recent-change flash on trace rows uses the same animation family
 * as ContextWidget's library-mutation flash + InjectorWidget's
 * drop-pulse. Imported unscoped — class names are namespaced so no
 * leakage. */
@import "../shared/row-primitives.css";
</style>

<style scoped>
.wp-debug {
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  padding: 6px;
  color: var(--wp-text);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  transition: opacity var(--wp-motion-quick) ease;
}
/* Mute (mode 2) / bypass (mode 4) — dim widget body so the muted
 * state matches litegraph's native node-frame dim. */
.wp-debug--skipped { opacity: 0.45; }
.wp-dbg-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--wp-border);
  align-items: center;
}
.wp-dbg-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-top-left-radius: var(--wp-radius);
  border-top-right-radius: var(--wp-radius);
  margin-bottom: -1px;
  font: 500 11px/1 var(--wp-font-sans);
  color: var(--wp-text-muted);
  padding: 6px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-dbg-tab:hover { color: var(--wp-text); }
.wp-dbg-tab.is-active {
  color: var(--wp-text);
  background: var(--wp-bg-deep, var(--wp-bg));
  border-color: var(--wp-border);
  border-bottom-color: var(--wp-bg-deep, var(--wp-bg));
}
.wp-dbg-tab-badge {
  font: 600 9px/1 var(--wp-font-mono);
  padding: 2px 4px;
  border-radius: 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text-dim);
}
.wp-dbg-tab-badge--warn {
  background: color-mix(in srgb, var(--wp-warn) 22%, transparent);
  color: var(--wp-warn);
}
.wp-dbg-toolbar {
  margin-left: auto;
  display: flex;
  gap: 4px;
  padding-bottom: 4px;
}
/* Toolbar icon button — mirrors ContextWidget's `.wp-btn--icon-sm`
 * style family (transparent default, hover reveals border + bg) so
 * the debug toolbar reads as part of the same design family as the
 * row-level action clusters in module + injector rows. Slightly
 * larger (24×24 vs 20×20) since toolbar lives in its own bar with
 * room to breathe. Padding bumped 4px→5px so the icon glyph has more
 * breathing room — matches the visual weight of `.wp-btn--icon-sm`'s
 * 20×20+3px combo at this scale. */
.wp-btn--icon {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 11px/1 var(--wp-font-sans);
  padding: 5px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--wp-motion-quick), border-color var(--wp-motion-quick), color var(--wp-motion-quick);
}
.wp-btn--icon:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-border-soft, var(--wp-border2));
  color: var(--wp-text);
}
.wp-btn--icon.is-flashed {
  border-color: var(--wp-green);
  color: var(--wp-green);
  background: color-mix(in srgb, var(--wp-green) 12%, transparent);
}
.wp-btn--icon .pi { font-size: 12px; }

/* Filter input — sits next to the toolbar buttons. Compact width
 * (160px) so the toolbar doesn't dominate the panel. Search icon
 * + clear-X follows the same affordance pattern as the SPA search
 * bar. */
.wp-dbg-filter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-right: auto;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 0 6px;
  height: 24px;
  box-sizing: border-box;
  min-width: 160px;
  max-width: 240px;
}
.wp-dbg-filter:focus-within { border-color: var(--wp-accent); }
.wp-dbg-filter__icon {
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-dbg-filter__input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--wp-text);
  font: 500 11px var(--wp-font-sans);
  min-width: 0;
}
.wp-dbg-filter__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.wp-dbg-filter__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0;
  width: 14px;
  height: 14px;
}
.wp-dbg-filter__clear:hover { color: var(--wp-text); }
.wp-dbg-filter__clear .pi { font-size: 9px; }

/* Pinned row marker — small star next to the label. Row also gets
 * a subtle left-edge accent so pinned rows visually anchor the eye
 * when filtering hides their unpinned neighbors. */
.wp-dbg-row-pin {
  font-size: 9px;
  color: var(--wp-amber, var(--wp-accent));
  margin-right: 4px;
}
.wp-dbg-row--pinned {
  box-shadow: inset 2px 0 0 0 color-mix(in srgb, var(--wp-amber, var(--wp-accent)) 65%, transparent);
}
.wp-dbg-pre {
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 8px 10px;
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  font: 11px/1.5 var(--wp-font-mono, monospace);
  white-space: pre;
  tab-size: 2;
  word-break: normal;
}
/* Right-click target highlight — when a ctxmenu opens on a row or
 * ref chip, paint a subtle accent ring so the user reads which
 * entity the menu is for. Clears when the menu closes. */
.wp-dbg-row--ctx-active {
  outline: 1px solid var(--wp-accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--wp-accent) 7%, transparent) !important;
}
.wp-dbg-ref--ctx-active {
  outline: 1px solid var(--wp-accent);
  outline-offset: 1px;
}

.wp-debug__empty {
  color: var(--wp-text3);
  font-style: italic;
  font-family: var(--wp-font-sans, sans-serif);
  text-align: center;
  margin: auto 0;
}
/* Empty-state ghost — vertical stack with a giant pi-icon over a
 * primary line + secondary hint. Mirrors the injector widget's
 * `.wp-inj-ghost` shape so every empty-state in the extension reads
 * the same way: the user sees an iconic affordance for "this panel
 * has nothing yet" instead of a single grey italic line. */
.wp-debug__empty--state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 16px;
  font-style: normal;
}
.wp-debug__empty-icon {
  font-size: 28px;
  color: color-mix(in srgb, var(--wp-accent) 65%, var(--wp-text3));
  opacity: 0.65;
}
.wp-debug__empty-icon--ok {
  color: color-mix(in srgb, var(--wp-green) 75%, var(--wp-text3));
}
.wp-debug__empty-line {
  font: 600 12px var(--wp-font-sans);
  color: var(--wp-text2);
}
.wp-debug__empty-hint {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text3);
}

/* Pane — shared container for trace/picks/warnings tab bodies. Same
 * frame as `.wp-dbg-pre` so the panel doesn't reflow when switching
 * tabs. Uses overflow auto so long lists scroll inside the frame. */
.wp-dbg-pane {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 6px;
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* Trace — variable-first 5-col table (variable / type / status /
 * value / seed). The `variable` column reads `$varname` not the raw
 * uuid — pulled from `writes[0].variable` so the user scans the
 * bindings they wrote, not module-ids they didn't. Status renders as
 * a color pill (green/grey/red) for at-a-glance scanning. Density-
 * aware: padding + gap pulled from --wp-pad-row / --wp-row-gap so the
 * table tightens up alongside Context module rows when user picks
 * compact/minimal density. */
.wp-dbg-trace {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-dbg-trace-row {
  display: grid;
  /* Seed column widened from 70 → 170px so 18-digit seeds render in
   * full without ellipsis. Tabular-nums lines them up vertically. */
  grid-template-columns: 28px minmax(110px, 1fr) 80px 80px minmax(120px, 2fr) 170px;
  gap: var(--wp-row-gap, 10px);
  padding: var(--wp-pad-row, 5px 8px);
  font: 500 11px/1.4 var(--wp-font-mono, monospace);
  color: var(--wp-text);
  border-radius: var(--wp-radius-sm);
  align-items: baseline;
}
/* Run-order column — leading numeric cell. Mono digits for tabular
 * alignment, dim color so the index reads as metadata rather than
 * primary content. Disambiguates duplicate variables (chain rolls
 * `$chain_a` twice → two rows with distinct run order). */
.wp-dbg-trace-seq {
  font: 500 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.wp-dbg-trace-row:not(.wp-dbg-trace-row--head) .wp-dbg-trace-seq {
  align-self: center;
}
.wp-dbg-trace-row--head {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim, var(--wp-text3));
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  padding-bottom: 4px;
  margin-bottom: 2px;
}
.wp-dbg-trace-row:not(.wp-dbg-trace-row--head):nth-child(odd) {
  /* `background-color` (not the `background` shorthand) so the
   * disabled-row diagonal stripes below (declared as `background-image`)
   * layer on top instead of getting cleared by the shorthand reset.
   * Specificity here is (0,3,0) vs (0,1,0) on the disabled rule, so
   * without splitting properties zebra would win the cascade on every
   * odd disabled row and the slashes would disappear in a 1-on-1-off
   * pattern. */
  background-color: color-mix(in srgb, var(--wp-bg2) 50%, transparent);
}
/* Status-aware row tint — error rows get a soft red wash + red strip,
 * skipped rows dim slightly so the eye snaps to "ok" rows. */
.wp-dbg-trace-row--error {
  background: color-mix(in srgb, var(--wp-red) 14%, transparent) !important;
  border-left: 2px solid var(--wp-red);
  padding-left: 6px;
}
.wp-dbg-trace-row--skipped { opacity: 0.6; }
/* Disabled module — same dim as `--skipped` (it IS a skip variant)
 * but with a diagonal stripe pattern matching ContextWidget's
 * `.wp-module--disabled` so the user instantly recognises the row as
 * the module they manually toggled off. Uses `background-image` so the
 * zebra `background-color` above remains visible on odd rows (see
 * specificity comment on the zebra rule). Bumped contrast: stripes
 * use `--wp-bg4`/`--wp-bg2` (16-level diff in dark theme) instead of
 * `--wp-bg3`/`--wp-bg2` (7-level diff) because the old pair was so
 * subtle the slashes read as zebra striping. */
.wp-dbg-trace-row--disabled {
  opacity: 0.55;
  background-image: repeating-linear-gradient(
    45deg,
    var(--wp-bg4),
    var(--wp-bg4) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}
.wp-dbg-trace-row--disabled .wp-dbg-trace-value {
  font-style: italic;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-dbg-trace-label {
  color: var(--wp-amber);
  font-weight: 600;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-dbg-trace-flag {
  font-size: 10px;
  color: var(--wp-warn);
  cursor: help;
}
/* PrimeIcon flags — share the warn color but icons need their own
 * font-size since `pi pi-*` pulls from the icon font, not the row's
 * mono font. Slight letter-spacing breather so they don't crowd the
 * variable label. */
.wp-dbg-trace-label .pi {
  font-size: 9px;
  margin-left: 2px;
}
/* Internal (globe) → accent — same color ContextWidget's
 * `row-action-internal` button gets when active (`.is-active` class
 * resolves to `--wp-accent-text`). */
.wp-dbg-trace-label .pi-globe {
  color: var(--wp-accent);
}
/* Locked seed (lock) → warn (amber) — matches ContextWidget's
 * `.wp-btn--icon-sm.is-locked` color for the seed-lock toggle. */
.wp-dbg-trace-label .pi-lock {
  color: var(--wp-warn);
}
/* Type cell is also a `wp-kind-chip` (from theme.css) — the chip
 * provides the colored background + text. Override font size +
 * uppercase here so the chip reads as a tight inline tag. Fallback
 * `--unknown` variant for non-engine traces (injector) tints with
 * the accent color. */
.wp-dbg-trace-type {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 6px;
  border-radius: 3px;
  text-align: center;
  justify-self: start;
}
.wp-dbg-trace-type.wp-kind-chip--unknown {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
}
/* Type cell wrapper — keeps the kind chip + optional subtype + TPL
 * badges inside ONE grid cell so they don't spill into adjacent
 * columns. Chips stack vertically when the cell's 80px column would
 * overflow (injector traces get 3 chips: INJECTOR + STR + TPL). */
.wp-dbg-trace-type-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
/* Injector value-type secondary chip — companion to the kind chip
 * in the type cell. Smaller + neutral grey so the eye reads the
 * kind (`injector`) first, then the value type (STR/INT/FLOAT/BOOL)
 * as a qualifier. Always badge-styled regardless of the global
 * icon-mode preference; the type cell needs to communicate the
 * value-type and there's no paired icon. */
.wp-dbg-trace-subtype {
  font: 600 9px/1 var(--wp-font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--wp-text3) 18%, transparent);
  color: var(--wp-text2);
}
/* Per-value-type tinting — mirrors the injector row's per-type
 * palette in InjectorRow.vue so a STR / INT / FLOAT / BOOL chip reads
 * with the same color whether it's surfaced inside an injector row's
 * type chip or here in Debug's trace table. */
.wp-dbg-trace-subtype--str          { background: color-mix(in oklab, var(--wp-amber)  22%, transparent); color: var(--wp-amber); }
.wp-dbg-trace-subtype--int          { background: color-mix(in oklab, var(--wp-green)  22%, transparent); color: var(--wp-green); }
.wp-dbg-trace-subtype--float        { background: color-mix(in oklab, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-dbg-trace-subtype--bool,
.wp-dbg-trace-subtype--boolean      { background: color-mix(in oklab, var(--wp-var-5) 22%, transparent); color: var(--wp-var-5); }
.wp-dbg-trace-subtype--image        { background: color-mix(in oklab, var(--wp-var-1) 22%, transparent); color: var(--wp-var-1); }
.wp-dbg-trace-subtype--mask         { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-dbg-trace-subtype--latent       { background: color-mix(in oklab, var(--wp-var-4) 22%, transparent); color: var(--wp-var-4); }
.wp-dbg-trace-subtype--conditioning { background: color-mix(in oklab, var(--wp-var-2) 22%, transparent); color: var(--wp-var-2); }
.wp-dbg-trace-subtype--model        { background: color-mix(in oklab, var(--wp-var-8) 22%, transparent); color: var(--wp-var-8); }
.wp-dbg-trace-subtype--clip         { background: color-mix(in oklab, var(--wp-var-3) 22%, transparent); color: var(--wp-var-3); }
.wp-dbg-trace-subtype--vae          { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-dbg-trace-subtype--audio        { background: color-mix(in oklab, var(--wp-var-7) 22%, transparent); color: var(--wp-var-7); }
.wp-dbg-trace-subtype--video        { background: color-mix(in oklab, var(--wp-var-4) 22%, transparent); color: var(--wp-var-4); }
.wp-dbg-trace-subtype--noise        { background: color-mix(in oklab, var(--wp-var-6) 22%, transparent); color: var(--wp-var-6); }
.wp-dbg-trace-subtype--sigmas       { background: color-mix(in oklab, var(--wp-var-1) 22%, transparent); color: var(--wp-var-1); }
.wp-dbg-trace-subtype--guider       { background: color-mix(in oklab, var(--wp-var-3) 22%, transparent); color: var(--wp-var-3); }
.wp-dbg-trace-subtype--sampler      { background: color-mix(in oklab, var(--wp-var-2) 22%, transparent); color: var(--wp-var-2); }
/* Template marker — same visual as the row's `tpl` summary badge. */
.wp-dbg-trace-tpl {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
}
/* Status pill — green/red/grey background tint matching --wp-green /
 * --wp-red / --wp-text3, so a quick eye-sweep down the column groups
 * the run by outcome. */
.wp-dbg-trace-pill {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 6px;
  border-radius: 3px;
  text-align: center;
  cursor: help;
}
.wp-dbg-trace-pill--ok {
  background: color-mix(in srgb, var(--wp-green) 18%, transparent);
  color: var(--wp-green);
}
.wp-dbg-trace-pill--error {
  background: color-mix(in srgb, var(--wp-red) 22%, transparent);
  color: var(--wp-red);
}
.wp-dbg-trace-pill--skipped {
  background: var(--wp-bg2);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-dbg-trace-pill--unknown {
  background: color-mix(in srgb, var(--wp-amber) 18%, transparent);
  color: var(--wp-amber);
}
.wp-dbg-trace-value {
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
/* Only long values get the click affordance + hover tint — short
 * values would land in a sticky expanded background otherwise. */
.wp-dbg-trace-value--expandable {
  cursor: pointer;
}
.wp-dbg-trace-value--expandable:hover { color: var(--wp-accent); }
.wp-dbg-trace-value--expanded {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  background: color-mix(in srgb, var(--wp-accent) 8%, transparent);
  border-radius: 2px;
  padding: 2px 4px;
  margin: -2px -4px;
}
.wp-dbg-trace-seed {
  color: var(--wp-text-dim, var(--wp-text3));
  text-align: right;
  font-variant-numeric: tabular-nums;
  font: 500 10px/1.4 var(--wp-font-mono, monospace);
}
/* Clickable seed cell — borderless button with hover affordance.
 * Uses `--wp-bg2` background only on hover so the table stays clean
 * when not interacting. Shows "✓ copied" inside the cell for 1.2s
 * after click, with a green tint to confirm the clipboard write. */
.wp-dbg-trace-seed--clickable {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 2px 6px;
  cursor: pointer;
  text-align: right;
  transition: background var(--wp-motion-quick), border-color var(--wp-motion-quick), color var(--wp-motion-quick);
}
.wp-dbg-trace-seed--clickable:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-border-soft, var(--wp-border));
  color: var(--wp-text);
}
.wp-dbg-trace-seed--clickable.is-copied {
  background: color-mix(in srgb, var(--wp-green) 18%, transparent);
  border-color: color-mix(in srgb, var(--wp-green) 40%, transparent);
  color: var(--wp-green);
}
.wp-dbg-trace-seed--clickable:focus-visible {
  outline: 2px solid var(--wp-accent);
  outline-offset: 1px;
}

/* Picks — `$varname` → value table with optional sub-category chip.
 * Variable column tinted accent so the `$` handle reads as a code
 * variable; value column gets the prominent main text color since
 * that's what the user is checking. Sub-category as a tiny pill on
 * the right — only renders when present. */
.wp-dbg-picks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-dbg-pick-row {
  display: grid;
  grid-template-columns: minmax(140px, max-content) 1fr auto;
  gap: var(--wp-row-gap, 10px);
  padding: var(--wp-pad-row, 5px 8px);
  font: 500 11px/1.4 var(--wp-font-mono, monospace);
  border-radius: var(--wp-radius-sm);
  align-items: baseline;
}
.wp-dbg-pick-row:nth-child(odd) {
  background: color-mix(in srgb, var(--wp-bg2) 50%, transparent);
}
/* Header row — uppercase dim label band above the picks table. Same
 * shape as `.wp-dbg-trace-row--head` so picks reads as part of the
 * same table family. */
.wp-dbg-pick-row--head {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim, var(--wp-text3));
  padding-bottom: 6px;
  padding-top: 6px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  background: transparent !important;
}
.wp-dbg-pick-row--head:hover { background: transparent !important; }
.wp-dbg-pick-key {
  color: var(--wp-accent);
  font-weight: 600;
}
.wp-dbg-pick-val {
  color: var(--wp-text);
  word-break: break-word;
  white-space: pre-wrap;
}
.wp-dbg-pick-cat {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--wp-violet, var(--wp-accent)) 18%, transparent);
  color: var(--wp-violet, var(--wp-accent));
  flex-shrink: 0;
}

/* Inline `@varname` reference chip — wraps wildcard refs that
 * originated as `@{uuid}` in the engine's text output. Used inside
 * picks values + warning messages so refs render as distinct entities
 * from surrounding plain text instead of blending in.
 *   - default `--ref` variant (resolved): accent tint
 *   - `--unknown` variant (no matching trace entry): warn tint
 * The user can still hover for the full uuid via the `title` tooltip
 * on each chip. */
.wp-dbg-ref {
  display: inline-block;
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--wp-accent) 16%, transparent);
  color: var(--wp-accent);
  font-weight: 600;
  cursor: help;
}
.wp-dbg-ref--unknown {
  background: color-mix(in srgb, var(--wp-warn) 16%, transparent);
  color: var(--wp-warn);
}

/* Warnings — severity dot + type + binding + message. Same color
 * tokens as conflict scanner so warnings here read as the same
 * design family. Border-left strip in severity color visually
 * groups same-severity rows when scrolling. */
.wp-dbg-warnings {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.wp-dbg-warn-row {
  display: grid;
  grid-template-columns: auto auto auto 1fr;
  gap: var(--wp-row-gap, 8px);
  padding: var(--wp-pad-row, 5px 8px);
  font: 500 11px/1.4 var(--wp-font-sans);
  border-radius: var(--wp-radius-sm);
  align-items: center;
  border-left: 2px solid transparent;
}
.wp-dbg-warn-row--info    { border-left-color: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 7%, transparent); }
.wp-dbg-warn-row--warning { border-left-color: var(--wp-amber);  background: color-mix(in srgb, var(--wp-amber)  7%, transparent); }
.wp-dbg-warn-row--error   { border-left-color: var(--wp-red);    background: color-mix(in srgb, var(--wp-red)    7%, transparent); }
.wp-dbg-warn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid transparent;
}
.wp-dbg-warn-dot--info {
  background:   color-mix(in oklab, var(--wp-accent) 14%, transparent);
  border-color: var(--wp-accent);
}
.wp-dbg-warn-dot--warning {
  background:   color-mix(in oklab, var(--wp-amber) 14%, transparent);
  border-color: var(--wp-amber);
}
.wp-dbg-warn-dot--error {
  background:   color-mix(in oklab, var(--wp-red) 14%, transparent);
  border-color: var(--wp-red);
}
.wp-dbg-warn-type {
  font: 600 9px/1 var(--wp-font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-muted, var(--wp-text2));
  padding: 2px 5px;
  border-radius: 2px;
  background: var(--wp-bg2);
}
.wp-dbg-warn-binding {
  font: 600 11px/1 var(--wp-font-mono);
  color: var(--wp-amber);
}
.wp-dbg-warn-msg {
  color: var(--wp-text);
  word-break: break-word;
}

/* JSON syntax highlight — spans emitted by `highlightJson` inside the
 * `v-html` <pre>. Use :deep() so scoped styles pierce into raw HTML
 * (the spans are not template-rendered, so the data-v-* attribute
 * the scoped compiler relies on is missing). */
.wp-debug :deep(.wp-jh-k) { color: var(--wp-accent); }
.wp-debug :deep(.wp-jh-s) { color: var(--wp-amber); }
.wp-debug :deep(.wp-jh-n) { color: var(--wp-green); }
.wp-debug :deep(.wp-jh-b) { color: var(--wp-violet, #b48aff); font-weight: 600; }
.wp-debug :deep(.wp-jh-p) { color: var(--wp-text-dim, var(--wp-text3)); }
</style>
