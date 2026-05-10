<script setup lang="ts">
import { computed, ref } from "vue";
import { highlightJson } from "./highlight";

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
  binding?: string;             // injector-trace shape
  writes?: TraceWrite[];        // engine-trace shape
  internal?: boolean;
  error?: string | { type?: string; message?: string } | null;
  seed?: number;
}

interface WarningEntry {
  type?: string;
  binding?: string;
  message?: string;
  severity?: "info" | "warning" | "error";
}

/** A `module_id → variable_name` lookup built from the trace. Used to
 *  re-key the raw `__wp_picks__` map (which is keyed by uuid) into a
 *  human-readable `$variable_name` view in the Picks tab. Falls back
 *  to the uuid when no trace entry mentions that module — defensive
 *  for older snapshots / unusual graph shapes. */
const moduleIdToVar = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {};
  for (const t of traceEntriesRaw.value) {
    const id = typeof t.id === "string" ? t.id : "";
    const firstWrite = Array.isArray(t.writes) ? t.writes[0] : undefined;
    if (id && firstWrite && typeof firstWrite.variable === "string") {
      map[id] = firstWrite.variable;
    }
  }
  return map;
});

/** Raw trace as the engine emits it. Kept separate from `traceRows`
 *  so the picks-tab lookup can scan unfiltered entries. */
const traceEntriesRaw = computed<TraceEntry[]>(() => {
  const trace = parsed.value?.__wp_trace__;
  return Array.isArray(trace) ? (trace as TraceEntry[]) : [];
});

interface TraceRow {
  id: string;                   // raw module_id (kept for `key` / debugging)
  shortId: string;              // first 6 chars of `id` for the table cell
  label: string;                // friendly label — variable name when available, else short id
  type: string;
  status: "ok" | "skipped" | "error" | "unknown";
  statusLabel: string;
  binding: string;
  value: string;                // formatted string of writes[0].value (or empty)
  seed: string;                 // last-6-digit slice of the seed for compactness
  errorMessage: string | null;
  overwrite: boolean;
}

function shortenSeed(seed: number | undefined): string {
  if (typeof seed !== "number" || !Number.isFinite(seed)) return "";
  // Last 6 digits — keeps the seed identifiable at a glance without
  // hogging table real estate for the full 18-digit number.
  const s = String(seed);
  return s.length <= 6 ? s : "…" + s.slice(-6);
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

/** Trace rows — projection of the raw engine + injector trace into a
 *  table-friendly shape. Pulls `writes[0].variable` for the binding
 *  column (engine modules) or falls back to `entry.binding` (injector
 *  trace). Shortens module-ids + seeds so the table reads at a glance. */
const traceRows = computed<TraceRow[]>(() => {
  return traceEntriesRaw.value.map((t): TraceRow => {
    const id = typeof t.id === "string" ? t.id : "";
    const firstWrite = Array.isArray(t.writes) ? t.writes[0] : undefined;
    const variable = firstWrite?.variable || t.binding || "";
    const hasError = !!t.error;
    const errMsg =
      hasError && typeof t.error === "object" && t.error !== null && "message" in t.error
        ? String((t.error as { message?: string }).message ?? "error")
        : hasError && typeof t.error === "string"
          ? t.error
          : null;
    return {
      id,
      shortId: id ? id.slice(0, 6) : "—",
      label: variable ? `$${variable}` : (id ? id.slice(0, 8) : "—"),
      type: t.type || "—",
      status: categorizeStatus(t.status, hasError),
      statusLabel: statusLabelOf(t.status, hasError),
      binding: variable,
      value: firstWrite ? formatValue(firstWrite.value) : "",
      seed: shortenSeed(t.seed),
      errorMessage: errMsg,
      overwrite: !!firstWrite?.overwrite,
    };
  });
});

interface PickRow {
  /** `$varname` for display, falls back to `$<short-uuid>` when the
   *  trace doesn't carry a variable name for this module. */
  label: string;
  /** The picked option's `value` field (the actual string the user
   *  cares about — usually the prompt fragment that got rolled). */
  value: string;
  /** Sub-category tag — shown as a small chip. Empty = no sub-cat. */
  subCategory: string;
  /** Raw uuid — kept around so power-users can still see which module
   *  the row came from in a tooltip. */
  rawId: string;
}

/** Picks tab — re-key raw `__wp_picks__[module_id]` map into a list of
 *  `$variable_name → value` rows. Splits the option dict's `value` /
 *  `sub_category` into separate columns so the user reads "what got
 *  picked" without parsing JSON. */
const pickRows = computed<PickRow[]>(() => {
  const idMap = moduleIdToVar.value;
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
    return { label, value, subCategory, rawId };
  });
});

const traceCount = computed(() => traceRows.value.length);

/** Typed warnings list — coerce loose dicts into a known shape so
 *  rendering can pull severity / message reliably. Defaults severity
 *  to "warning" when the engine didn't tag one. */
const warningEntries = computed<WarningEntry[]>(() => {
  return warnings.value.map((w) => {
    if (!w || typeof w !== "object") return { type: "unknown", message: String(w) };
    const o = w as Record<string, unknown>;
    return {
      type: typeof o.type === "string" ? o.type : "unknown",
      binding: typeof o.binding === "string" ? o.binding : undefined,
      message: typeof o.message === "string" ? o.message : undefined,
      severity: (o.severity === "info" || o.severity === "warning" || o.severity === "error")
        ? o.severity
        : "warning",
    };
  });
});

async function copyToClipboard(): Promise<void> {
  try { await navigator.clipboard.writeText(bodyText.value); } catch { /* permission denied */ }
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
        <button
          type="button"
          class="wp-btn wp-btn--icon"
          data-test="dbg-copy"
          title="Copy JSON"
          aria-label="Copy JSON"
          @click="copyToClipboard"
        ><i class="pi pi-copy" /></button>
        <button
          type="button"
          class="wp-btn wp-btn--icon"
          data-test="dbg-download"
          title="Download JSON"
          aria-label="Download JSON"
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
          <span>variable</span>
          <span>type</span>
          <span>status</span>
          <span>value</span>
          <span class="wp-dbg-trace-seed">seed</span>
        </div>
        <div
          v-for="(row, i) in traceRows"
          :key="i"
          class="wp-dbg-trace-row"
          :class="`wp-dbg-trace-row--${row.status}`"
          :title="row.id ? `module ${row.id}` : ''"
        >
          <span class="wp-dbg-trace-label">
            {{ row.label }}
            <span v-if="row.overwrite" class="wp-dbg-trace-flag" title="Overwrote upstream value">↻</span>
          </span>
          <span class="wp-dbg-trace-type">{{ row.type }}</span>
          <span
            class="wp-dbg-trace-pill"
            :class="`wp-dbg-trace-pill--${row.status}`"
            :title="row.errorMessage || row.statusLabel"
          >{{ row.statusLabel }}</span>
          <span class="wp-dbg-trace-value" :title="row.value">{{ row.value || "—" }}</span>
          <span class="wp-dbg-trace-seed">{{ row.seed }}</span>
        </div>
      </div>
      <p v-else class="wp-debug__empty">No modules ran yet — try executing the graph.</p>
    </div>

    <!-- Picks — `$variable` → resolved value table. Variable names
         pulled via the trace's `module_id → variable_name` lookup, so
         a wildcard whose pick was `b0219910` reads as `$backdrop`.
         Sub-category surfaces as a small chip when present (carries
         the constraint-aware metadata). -->
    <div v-else-if="parsed && activeTab === 'picks'" class="wp-dbg-pane">
      <div v-if="pickRows.length > 0" class="wp-dbg-picks">
        <div
          v-for="row in pickRows"
          :key="row.rawId"
          class="wp-dbg-pick-row"
          :title="`module ${row.rawId}`"
        >
          <span class="wp-dbg-pick-key">{{ row.label }}</span>
          <span class="wp-dbg-pick-val">{{ row.value }}</span>
          <span
            v-if="row.subCategory"
            class="wp-dbg-pick-cat"
          >{{ row.subCategory }}</span>
        </div>
      </div>
      <p v-else class="wp-debug__empty">No wildcard picks this run.</p>
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
          <span v-if="w.binding" class="wp-dbg-warn-binding">${{ w.binding }}</span>
          <span v-if="w.message" class="wp-dbg-warn-msg">{{ w.message }}</span>
        </div>
      </div>
      <p v-else class="wp-debug__empty">No warnings — all good.</p>
    </div>

    <p v-if="!parsed" class="wp-debug__empty">Run the graph to capture a snapshot.</p>
  </div>
</template>

<style>
@import "../shared/theme.css";
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
  transition: opacity 120ms ease;
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
.wp-btn--icon {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-soft);
  color: var(--wp-text);
  font: 500 11px/1 var(--wp-font-sans);
  padding: 4px 5px;
  border-radius: var(--wp-radius);
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-btn--icon:hover { background: var(--wp-bg-2); }
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
.wp-debug__empty {
  color: var(--wp-text3);
  font-style: italic;
  font-family: var(--wp-font-sans, sans-serif);
  text-align: center;
  margin: auto 0;
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
  grid-template-columns: minmax(110px, 1fr) 80px 80px minmax(120px, 2fr) 70px;
  gap: var(--wp-row-gap, 10px);
  padding: var(--wp-pad-row, 5px 8px);
  font: 500 11px/1.4 var(--wp-font-mono, monospace);
  color: var(--wp-text);
  border-radius: var(--wp-radius-sm);
  align-items: baseline;
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
  background: color-mix(in srgb, var(--wp-bg2) 50%, transparent);
}
/* Status-aware row tint — error rows get a soft red wash + red strip,
 * skipped rows dim slightly so the eye snaps to "ok" rows. */
.wp-dbg-trace-row--error {
  background: color-mix(in srgb, var(--wp-red) 14%, transparent) !important;
  border-left: 2px solid var(--wp-red);
  padding-left: 6px;
}
.wp-dbg-trace-row--skipped { opacity: 0.6; }
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
.wp-dbg-trace-type {
  color: var(--wp-accent);
  font-size: 10px;
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
.wp-dbg-trace-seed    {
  color: var(--wp-text-dim, var(--wp-text3));
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 10px;
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
