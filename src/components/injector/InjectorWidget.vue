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
  }>(),
  { connectedSlots: () => [], slotTypes: () => ({}) },
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

// Reconcile rows array against the polled `connectedSlots` prop. Adds
// rows for newly-connected slots; rows for severed connections stay
// (per design — user trashes manually so binding intent isn't lost).
watch(
  () => props.connectedSlots,
  (next) => {
    const known = new Set(value.value.rows.map((r) => r.slot_name));
    const toAdd = next.filter((slot) => !known.has(slot));
    if (toAdd.length === 0) return;
    value.value = {
      ...value.value,
      rows: [
        ...value.value.rows,
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
      <span data-test="inj-toolbar-label" class="wp-inj-toolbar-label">
        injected variables
      </span>
      <span data-test="inj-toolbar-count" class="wp-inj-toolbar-count">
        {{ enabledCount }} / {{ value.rows.length }}
      </span>
    </div>

    <div class="wp-inj-list">
      <InjectorRowComp
        v-for="row in value.rows"
        :key="row._uid"
        :row="row"
        :is-connected="isConnected(row.slot_name)"
        :value-type="slotTypes[row.slot_name]"
        @update="(patch) => updateRow(row._uid, patch)"
        @remove="(uid: string) => removeRow(uid)"
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
