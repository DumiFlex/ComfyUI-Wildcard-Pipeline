<script setup lang="ts">
import { computed } from "vue";
import { encodeKey } from "../keys";

type ConstraintMatrix = Record<string, Record<string, boolean>>;

const props = defineProps<{
  matrix: ConstraintMatrix;
  sourceSubs: string[];
  targetSubs: string[];
  modelValue: string[] | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: string[] | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function isCellPresent(src: string, tgt: string): boolean {
  return Boolean(props.matrix?.[src]?.[tgt]);
}

function isCellDisabled(src: string, tgt: string): boolean {
  if (!props.modelValue) return false;
  return props.modelValue.includes(encodeKey([src, tgt]));
}

function emitList(keys: string[]): void {
  if (keys.length === 0) {
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", keys);
}

function onCellClick(src: string, tgt: string): void {
  if (!isCellPresent(src, tgt)) return;
  const key = encodeKey([src, tgt]);
  const current = new Set(props.modelValue ?? []);
  if (current.has(key)) current.delete(key);
  else current.add(key);
  // Preserve src x tgt traversal order for stable diffing.
  const ordered: string[] = [];
  for (const s of props.sourceSubs) {
    for (const t of props.targetSubs) {
      const k = encodeKey([s, t]);
      if (current.has(k)) ordered.push(k);
    }
  }
  emitList(ordered);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Disabled matrix cells</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="dm-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <table class="wp-instance-matrix">
        <thead>
          <tr>
            <th class="wp-instance-matrix-corner"></th>
            <th
              v-for="t in targetSubs"
              :key="t"
              class="wp-instance-matrix-th"
            >{{ t }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in sourceSubs"
            :key="s"
          >
            <th class="wp-instance-matrix-th">{{ s }}</th>
            <td
              v-for="t in targetSubs"
              :key="`${s}-${t}`"
              class="wp-instance-matrix-cell"
              :class="{
                'is-empty': !isCellPresent(s, t),
                'is-disabled': isCellDisabled(s, t),
              }"
              :data-test="`dm-cell-${s}-${t}`"
              @click="() => onCellClick(s, t)"
            >
              <span v-if="isCellPresent(s, t)">&#x25CF;</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.wp-instance-section {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.wp-instance-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.wp-instance-section-title {
  font: 600 10px/1 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.wp-instance-section-modified {
  background: rgba(251, 146, 60, 0.18);
  color: var(--wp-status-modified, #fb923c);
  padding: 1px 5px;
  border-radius: 2px;
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
}
.wp-instance-section-reset {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
  padding: 2px 6px;
  font: 9px/1 var(--wp-font-sans);
  cursor: pointer;
  border-radius: 3px;
}
.wp-instance-section-body {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-instance-section-body-col {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}
.wp-instance-matrix {
  border-collapse: collapse;
  font: 11px/1.3 var(--wp-font-mono);
  color: var(--wp-text);
}
.wp-instance-matrix-th {
  font: 600 10px/1 var(--wp-font-mono);
  color: var(--wp-text-muted);
  padding: 3px 6px;
  text-align: center;
  border: 1px solid var(--wp-border-soft, var(--wp-border));
}
.wp-instance-matrix-corner {
  border: 1px solid transparent;
}
.wp-instance-matrix-cell {
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  width: 28px;
  height: 28px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.wp-instance-matrix-cell:hover {
  border-color: var(--wp-accent);
}
.wp-instance-matrix-cell.is-empty {
  cursor: default;
  background: transparent;
  color: transparent;
}
.wp-instance-matrix-cell.is-disabled {
  text-decoration: line-through;
  color: var(--wp-text-muted);
  background: rgba(251, 146, 60, 0.18);
}
</style>
