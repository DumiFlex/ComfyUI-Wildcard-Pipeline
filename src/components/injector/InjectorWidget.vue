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
  }>(),
  { connectedSlots: () => [], slotTypes: () => ({}), upstreamVars: () => [] },
);

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
  emit("change", serializeWidgetJson(value.value));
}

function updateRow(uid: string, patch: Partial<InjectorRow>): void {
  value.value = {
    ...value.value,
    rows: value.value.rows.map((r) => (r._uid === uid ? { ...r, ...patch } : r)),
  };
  persist();
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
watch(
  () => props.connectedSlots,
  (next) => {
    const connectedSet = new Set(next);
    const known = new Set(value.value.rows.map((r) => r.slot_name));
    const toAdd = next.filter((slot) => !known.has(slot));
    const survivors = value.value.rows.filter((r) => connectedSet.has(r.slot_name));
    const removed = survivors.length !== value.value.rows.length;
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
      ],
    };
    persist();
  },
  { immediate: true },
);

defineExpose({ addRow, removeRow });
</script>

<template>
  <div class="wp-inj-widget">
    <div class="wp-inj-toolbar">
      <button
        type="button"
        class="wp-inj-collapse-btn"
        :title="collapsed ? 'Expand rows' : 'Collapse rows'"
        :aria-label="collapsed ? 'Expand injector rows' : 'Collapse injector rows'"
        data-test="inj-toolbar-collapse"
        @click="collapsed = !collapsed"
      ><i :class="['pi', collapsed ? 'pi-caret-right' : 'pi-caret-down']" aria-hidden="true" /></button>
      <span data-test="inj-toolbar-label" class="wp-inj-toolbar-label">
        injected variables
      </span>
      <span data-test="inj-toolbar-count" class="wp-inj-toolbar-count">
        {{ enabledCount }} / {{ value.rows.length }}
      </span>
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
}
.wp-inj-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--wp-bg2);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-inj-collapse-btn {
  background: transparent;
  border: none;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0 2px;
  font-size: 10px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}
.wp-inj-collapse-btn:hover { color: var(--wp-text); }
.wp-inj-toolbar-label { flex: 0 0 auto; }
.wp-inj-toolbar-count {
  background: var(--wp-bg3);
  border-radius: 8px;
  padding: 1px 6px;
  font: 600 9px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  margin-left: auto;
}
.wp-inj-list { display: flex; flex-direction: column; }
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
