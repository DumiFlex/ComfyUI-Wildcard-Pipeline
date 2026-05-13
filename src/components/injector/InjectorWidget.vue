<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  emptyInjectorRowsValue,
  newRowUid,
  parseWidgetJsonWithRecovery,
  serializeWidgetJson,
  type InjectorRow,
  type InjectorRowsValue,
} from "../../widgets/_shared";
import { labelFor, scanInjectorConflicts } from "../../extension/conflicts";
import InjectorRowComp from "./InjectorRow.vue";

const props = withDefaults(
  defineProps<{
    nodeId: number;
    initialJson: string;
    /** Names of `input_*` socket slots with a live wire on the node.
     *  Polled from the outer mount glue and reconciled into rows. */
    connectedSlots?: string[];
    /** Per-slot type label — `STRING` / `INT` / `FLOAT` / `BOOLEAN`. */
    slotTypes?: Record<string, string>;
    /** Variables produced by anything upstream of this injector. Used
     *  by the conflict scanner to flag shadows_upstream when an
     *  injector binding overrides an upstream Context output. */
    upstreamVars?: string[];
    /** Litegraph node mode — 0=ALWAYS, 2=NEVER (mute), 4=BYPASS.
     *  Drives the dim overlay so muted/bypassed state reads at a
     *  glance, matching ContextWidget's pattern. */
    nodeMode?: number;
  }>(),
  { connectedSlots: () => [], slotTypes: () => ({}), upstreamVars: () => [], nodeMode: 0 },
);

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const emit = defineEmits<{
  (e: "change", json: string): void;
}>();

const value = ref<InjectorRowsValue>(
  parseWidgetJsonWithRecovery(props.initialJson, emptyInjectorRowsValue()).value,
);

watch(
  () => props.initialJson,
  (next) => {
    value.value = parseWidgetJsonWithRecovery(next, emptyInjectorRowsValue()).value;
  },
);

const enabledCount = computed(
  () => value.value.rows.filter((r) => r.enabled).length,
);

const connectedSet = computed(() => new Set(props.connectedSlots));

function isConnected(slotName: string): boolean {
  return connectedSet.value.has(slotName);
}

/** Per-row conflict map keyed by `_uid`. Recomputes from row state
 *  + connection set; warn-class + tooltip surface in InjectorRow. */
interface RowConflict {
  severity: "info" | "warning" | "error";
  label: string;
}

/** Per-row conflict info keyed by `_uid`. Picks highest severity if a
 *  row has multiple conflicts (warning > info; error reserved for
 *  future). Drives the `wp-conflict-dot--*` + `wp-conflict-badge--*`
 *  cluster in each row, matching ContextWidget's pattern. */
const conflictByUid = computed<Record<string, RowConflict>>(() => {
  const out: Record<string, RowConflict> = {};
  const conflicts = scanInjectorConflicts(
    value.value,
    props.connectedSlots ?? [],
    props.upstreamVars ?? [],
  );
  const rank: Record<RowConflict["severity"], number> = { info: 0, warning: 1, error: 2 };
  for (const c of conflicts) {
    const next: RowConflict = { severity: c.severity, label: labelFor(c.type) };
    const prev = out[c.moduleId];
    if (!prev || rank[next.severity] > rank[prev.severity]) out[c.moduleId] = next;
  }
  return out;
});

/** Collapse toggle — hides the rows list. Mirrors the per-module
 *  collapse pattern from ContextWidget where collapsing a row hides
 *  its summary. Persists in widget JSON via the same persist() so
 *  reload restores collapsed state. */
const collapsed = ref<boolean>(false);

function persist(): void {
  const serialized = serializeWidgetJson(value.value);
  emit("change", serialized);
}

// Debounce binding-only edits so persist() doesn't fire on every
// keystroke. 250ms timeout — short enough that disconnect / save
// shortly after typing still sees the latest binding (the timer
// fires well before any realistic graph mutation). Non-binding
// patches (enabled / internal toggle) persist immediately.
let bindingDebounce: number | null = null;
function updateRow(uid: string, patch: Partial<InjectorRow>): void {
  value.value = {
    ...value.value,
    rows: value.value.rows.map((r) => (r._uid === uid ? { ...r, ...patch } : r)),
  };
  const onlyBinding = Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, "binding");
  if (onlyBinding) {
    if (bindingDebounce != null) window.clearTimeout(bindingDebounce);
    bindingDebounce = window.setTimeout(() => {
      bindingDebounce = null;
      persist();
    }, 250);
  } else {
    if (bindingDebounce != null) {
      window.clearTimeout(bindingDebounce);
      bindingDebounce = null;
    }
    persist();
  }
}

function removeRow(uid: string): void {
  value.value = {
    ...value.value,
    rows: value.value.rows.filter((r) => r._uid !== uid),
  };
  persist();
}

function addRow(slotName: string): void {
  if (value.value.rows.some((r) => r.slot_name === slotName)) return;
  value.value = {
    ...value.value,
    rows: [
      ...value.value.rows,
      {
        _uid: newRowUid(),
        slot_name: slotName,
        binding: "",
        enabled: true,
        internal: false,
      },
    ],
  };
  persist();
}

// Reconcile rows array against the polled `connectedSlots` prop.
// Adds rows for newly-connected slots; auto-removes rows whose slots
// have been severed. (Earlier design kept severed rows with a warn
// badge; user feedback flipped it to auto-cleanup since the row is
// useless without a wire and re-creating it is just re-connecting.)
//
// C.1b note: read rows from `props.initialJson` (latest source-of-
// truth) rather than `value.value.rows` (potentially stale). When
// the slot reindexer in injector.ts mutates socket names AND row
// JSON in the same tick, this watcher and the initialJson watcher
// can race — if connectedSlots fires first, value.value.rows still
// holds the pre-rename state and we'd false-positive every row as
// severed. Parsing initialJson here breaks the race.
function slotOrderIndex(slotName: string): number {
  const m = slotName.match(/^input_(\d+)$/);
  return m ? parseInt(m[1], 10) : 999;
}

watch(
  () => props.connectedSlots,
  (next) => {
    const freshRows = parseWidgetJsonWithRecovery(props.initialJson, emptyInjectorRowsValue()).value.rows;
    console.log("[WP injector] watcher fired", {
      nextConnected: next,
      freshRows: freshRows.map((r) => ({ slot: r.slot_name, binding: r.binding })),
      currentValueRows: value.value.rows.map((r) => ({ slot: r.slot_name, binding: r.binding })),
    });
    const connectedSet = new Set(next);
    const known = new Set(freshRows.map((r) => r.slot_name));
    const toAdd = next.filter((slot) => !known.has(slot));
    const survivors = freshRows.filter((r) => connectedSet.has(r.slot_name));
    const removed = survivors.length !== freshRows.length;
    if (toAdd.length === 0 && !removed) return;
    value.value = {
      ...value.value,
      rows: [
        ...survivors,
        ...toAdd.map((slot) => ({
          _uid: newRowUid(),
          slot_name: slot,
          binding: "",
          enabled: true,
          internal: false,
        })),
      // Always order rows by slot index so the visual list matches
      // the socket pin order on the node body, regardless of when
      // each row was added (toAdd appends at end; without this sort
      // a newly-connected lower-numbered slot would render below
      // already-known higher-numbered rows).
      ].sort((a, b) => slotOrderIndex(a.slot_name) - slotOrderIndex(b.slot_name)),
    };
    persist();
  },
  { immediate: true },
);

defineExpose({ addRow, removeRow });
</script>

<template>
  <div class="wp-inj-widget" :class="{ 'wp-inj-widget--skipped': isSkipped }">
    <div class="wp-inj-header">
      <button
        type="button"
        class="wp-inj-caret"
        :title="collapsed ? 'Expand rows' : 'Collapse rows'"
        :aria-label="collapsed ? 'Expand injector rows' : 'Collapse injector rows'"
        data-test="inj-toolbar-collapse"
        @click="collapsed = !collapsed"
      ><i :class="['pi', collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true" /></button>
      <span data-test="inj-toolbar-label" class="wp-inj-header-label">injected variables</span>
      <span data-test="inj-toolbar-count" class="wp-inj-header-count">{{ enabledCount }} / {{ value.rows.length }}</span>
    </div>

    <div v-if="!collapsed" class="wp-inj-list">
      <InjectorRowComp
        v-for="row in value.rows"
        :key="row._uid"
        :row="row"
        :is-connected="isConnected(row.slot_name)"
        :value-type="slotTypes[row.slot_name]"
        :conflict-severity="conflictByUid[row._uid]?.severity"
        :conflict-label="conflictByUid[row._uid]?.label"
        @update="(patch) => updateRow(row._uid, patch)"
      />
      <div
        v-if="value.rows.length === 0"
        data-test="inj-ghost"
        class="wp-inj-ghost"
      >
        ↓ Connect any node output to "+ new input" → new variable row appears here
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-inj-widget {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: var(--wp-radius);
  font-family: var(--wp-font-sans);
  color: var(--wp-text);
  overflow: hidden;
  transition: opacity 120ms ease;
}
/* Mute (mode 2) / bypass (mode 4) — dim entire widget body so the
 * muted state mirrors litegraph's title/border dimming. Pointer-events
 * stay on so the user can still edit binding names while the node
 * is paused; engine-side ComfyUI skips execute() outright. */
.wp-inj-widget--skipped { opacity: 0.45; }
.wp-inj-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px;
  font: 500 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-inj-caret {
  background: transparent;
  border: none;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0;
  font-size: 10px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.wp-inj-caret:hover { color: var(--wp-text); }
.wp-inj-caret .pi { font-size: 10px; }
.wp-inj-header-label { flex: 0 0 auto; }
.wp-inj-header-count {
  margin-left: auto;
  font: 600 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-inj-list {
  display: flex;
  flex-direction: column;
  /* Match Context's .wp-modules padding so rows have breathing room
   * on all sides of the list, not just between each other. */
  padding: 6px 8px;
}
.wp-inj-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: var(--wp-text-dim, var(--wp-text3));
  font: italic 11px var(--wp-font-sans);
  background: rgba(255, 255, 255, 0.015);
}
</style>
