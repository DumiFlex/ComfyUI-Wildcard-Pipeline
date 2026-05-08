<script setup lang="ts">
import { computed } from "vue";
import {
  rowOverrideKind,
  type DraftRow,
  type LibraryRow,
} from "../defaults";

const props = defineProps<{
  row: DraftRow;
  library: LibraryRow | undefined;
}>();

const emit = defineEmits<{
  "toggle": [rowId: string];
  "update": [rowId: string, patch: { name?: string; value?: string }];
  "reset": [rowId: string];
  "delete": [rowId: string];
}>();

const overrideKind = computed(() =>
  rowOverrideKind(
    props.library,
    { id: props.row.id, name: props.row.name, value: props.row.value },
  ),
);

const nameOverridden = computed(
  () => overrideKind.value === "name" || overrideKind.value === "both",
);
const valueOverridden = computed(
  () => overrideKind.value === "value" || overrideKind.value === "both",
);
const isAdded = computed(() => overrideKind.value === "added");
const showReset = computed(
  () => !isAdded.value && (nameOverridden.value || valueOverridden.value),
);

function onToggle(): void {
  emit("toggle", props.row.id);
}
function onNameInput(ev: Event): void {
  emit("update", props.row.id, { name: (ev.target as HTMLInputElement).value });
}
function onValueInput(ev: Event): void {
  emit("update", props.row.id, { value: (ev.target as HTMLInputElement).value });
}
function onReset(): void {
  emit("reset", props.row.id);
}
function onDelete(): void {
  emit("delete", props.row.id);
}
</script>

<template>
  <div
    class="row"
    :class="{
      'row--on': row.enabled,
      'row--off': !row.enabled,
      'row--added': isAdded,
    }"
  >
    <span
      class="row__check"
      :class="{ 'row__check--on': row.enabled }"
      data-test="row-check"
      role="checkbox"
      :aria-checked="row.enabled"
      tabindex="0"
      @click="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <svg
        v-if="row.enabled"
        width="8"
        height="8"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M2.5 6.5 L5 9 L9.5 3.5"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>

    <span
      class="row__name-wrap"
      :class="{ 'row__name-wrap--mod': nameOverridden }"
      data-test="row-name-wrap"
    >
      <span class="row__name-prefix" data-test="row-name-prefix">$</span>
      <input
        class="row__name"
        data-test="row-name"
        type="text"
        :value="row.name"
        :disabled="!row.enabled"
        :aria-label="`Variable name for row ${row.id}`"
        @input="onNameInput"
      />
    </span>

    <span
      class="row__value-wrap"
      :class="{ 'row__value-wrap--mod': valueOverridden }"
      data-test="row-value-wrap"
    >
      <input
        class="row__value"
        data-test="row-value"
        type="text"
        :value="row.value"
        :disabled="!row.enabled"
        :aria-label="`Value for row ${row.id}`"
        @input="onValueInput"
      />
    </span>

    <button
      v-if="showReset"
      type="button"
      class="row__reset"
      data-test="row-reset"
      :aria-label="`Reset row $${library?.name ?? row.id} to library default`"
      title="Restore this row to library default"
      @click="onReset"
    ><i class="pi pi-replay" aria-hidden="true" /></button>
    <span v-else></span>

    <button
      v-if="isAdded"
      type="button"
      class="row__delete"
      data-test="row-delete"
      :aria-label="`Remove instance-only row $${row.name}`"
      title="Remove this instance-only row"
      @click="onDelete"
    ><i class="pi pi-times" aria-hidden="true" /></button>
    <span v-else></span>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 22px 180px 1fr 28px 28px;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.row:last-child { border-bottom: none; }
.row:hover { background: rgba(255, 255, 255, 0.02); }
.row__check {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wp-border-soft, var(--wp-border));
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: var(--wp-bg);
  cursor: pointer;
}
.row__check--on { background: var(--wp-accent); border-color: var(--wp-accent); }
.row__check svg { display: block; }

.row__name-wrap, .row__value-wrap {
  display: flex;
  align-items: stretch;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  overflow: hidden;
}
.row__name-wrap:focus-within, .row__value-wrap:focus-within { border-color: var(--wp-accent); }
.row__name-wrap--mod, .row__value-wrap--mod { border-color: var(--wp-accent); }
.row__name-wrap--mod .row__name,
.row__name-wrap--mod .row__name-prefix,
.row__value-wrap--mod .row__value { color: var(--wp-accent-text, var(--wp-text)); }

.row__name-prefix {
  background: var(--wp-bg2);
  color: var(--wp-text-dim, var(--wp-text3));
  padding: 3px 6px;
  border-right: 1px solid var(--wp-border);
  font: 11px var(--wp-font-mono);
  display: flex;
  align-items: center;
}
.row__name, .row__value {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 3px 6px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  min-width: 0;
}
.row__name:focus, .row__value:focus { outline: none; }

.row--off { color: var(--wp-text-dim, var(--wp-text3)); }
.row--off .row__name-wrap, .row--off .row__value-wrap { opacity: 0.5; }
.row--off .row__name, .row--off .row__value { text-decoration: line-through; }

.row--added .row__name-wrap, .row--added .row__value-wrap { border-color: var(--wp-green); }
.row--added .row__name,
.row--added .row__value,
.row--added .row__name-prefix { color: var(--wp-green); }

.row__reset, .row__delete {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
}
.row__reset:hover {
  border-color: var(--wp-border);
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.10);
}
.row__delete:hover {
  border-color: var(--wp-border);
  color: var(--wp-status-modified, var(--wp-text));
  background: rgba(251, 146, 60, 0.10);
}
.row__reset .pi, .row__delete .pi { font-size: 10px; }
</style>
