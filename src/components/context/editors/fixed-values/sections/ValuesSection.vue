<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { newModuleId } from "../../../../../widgets/_shared";
import {
  rowOverrideKind,
  rowEnabled,
  shapeValuesPatch,
  type DraftRow,
  type LibraryRow,
} from "../defaults";
import ValueRow from "./ValueRow.vue";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const payload = computed(() => (props.module.payload ?? {}) as { values?: LibraryRow[] });
const libraryRows = computed<LibraryRow[]>(() => payload.value.values ?? []);
const instance = computed(() => props.module.instance ?? {});
const overrides = computed<LibraryRow[] | null>(() => {
  const ov = instance.value.values_overrides;
  return Array.isArray(ov) ? (ov as LibraryRow[]) : null;
});
const enabledOptions = computed(() =>
  Array.isArray(instance.value.enabled_options) ? instance.value.enabled_options : null,
);

const libraryById = computed(() => new Map(libraryRows.value.map((r) => [r.id, r])));

/**
 * Build the displayable draft rows. Source of truth:
 *   - When instance.values_overrides is set, it IS the row list (engine ignores payload.values).
 *   - When unset, render library rows directly.
 *   - Either way, mark each row's libraryId based on whether the id appears in payload.values.
 */
const draftRows = computed<DraftRow[]>(() => {
  const source = overrides.value ?? libraryRows.value;
  const libIds = new Set(libraryRows.value.map((r) => r.id));
  return source.map((r) => ({
    id: r.id,
    name: r.name,
    value: r.value,
    enabled: rowEnabled(r.id, enabledOptions.value),
    libraryId: libIds.has(r.id) ? r.id : null,
  }));
});

function emitDraft(next: DraftRow[]): void {
  const valuesOverrides = shapeValuesPatch(next, libraryRows.value);
  // Collapse enabled_options the same way: only emit a non-null array
  // when at least one row is disabled.
  const allEnabled = next.every((r) => r.enabled);
  const nextEnabledOptions = allEnabled
    ? null
    : next.filter((r) => r.enabled).map((r) => r.id);
  const nextInstance = {
    ...instance.value,
    values_overrides: valuesOverrides,
    enabled_options: nextEnabledOptions,
  };
  // Keep `entries` in sync with the draft rows so the v1 save()
  // reconciliation in ModuleEditModal can re-derive the same patch
  // shape we just emitted. Without this sync, the existing
  // entries→values conversion would clobber our values_overrides on
  // save (entries would still hold the original library values from
  // the picker's hoist step).
  const nextEntries = next.map((r) => ({
    variable_name: r.name,
    value: r.value,
  }));
  emit("update", { instance: nextInstance, entries: nextEntries });
}

function onToggle(rowId: string): void {
  const next = draftRows.value.map((r) =>
    r.id === rowId ? { ...r, enabled: !r.enabled } : r,
  );
  emitDraft(next);
}

function onUpdate(rowId: string, patch: { name?: string; value?: string }): void {
  const next = draftRows.value.map((r) =>
    r.id === rowId ? { ...r, ...patch } : r,
  );
  emitDraft(next);
}

function onReset(rowId: string): void {
  const lib = libraryById.value.get(rowId);
  if (!lib) return;
  const next = draftRows.value.map((r) =>
    r.id === rowId ? { ...r, name: lib.name, value: lib.value } : r,
  );
  emitDraft(next);
}

function onDelete(rowId: string): void {
  const next = draftRows.value.filter((r) => r.id !== rowId);
  emitDraft(next);
}

function onAddRow(): void {
  const next: DraftRow[] = [
    ...draftRows.value,
    { id: newModuleId(), name: "", value: "", enabled: true, libraryId: null },
  ];
  emitDraft(next);
}

const enabledCount = computed(() => draftRows.value.filter((r) => r.enabled).length);
const totalCount = computed(() => draftRows.value.length);
const overrideCount = computed(() =>
  draftRows.value.filter((r) => {
    if (r.libraryId === null) return false;
    const kind = rowOverrideKind(libraryById.value.get(r.libraryId), r);
    return kind !== "none";
  }).length,
);
const addedCount = computed(() => draftRows.value.filter((r) => r.libraryId === null).length);
</script>

<template>
  <section class="vals-sec">
    <div class="vals-sec__label">Values · what each $var resolves to</div>

    <div class="vals">
      <div class="vals__head">
        <span></span>
        <span class="vals__head-cell">Variable</span>
        <span class="vals__head-cell">Value</span>
        <span></span>
        <span></span>
      </div>
      <ValueRow
        v-for="row in draftRows"
        :key="row.id"
        :row="row"
        :library="row.libraryId ? libraryById.get(row.libraryId) : undefined"
        @toggle="onToggle"
        @update="onUpdate"
        @reset="onReset"
        @delete="onDelete"
      />
      <button
        type="button"
        class="vals__add"
        data-test="vals-add"
        @click="onAddRow"
      >
        <i class="pi pi-plus" aria-hidden="true" />
        Add new $var for this instance
      </button>
    </div>

    <div class="vals__summary" data-test="vals-summary">
      <strong>{{ enabledCount }} of {{ totalCount }}</strong> enabled
      <template v-if="overrideCount > 0">
        <span class="vals__summary-dot">·</span>
        <strong>{{ overrideCount }} override<template v-if="overrideCount !== 1">s</template></strong>
      </template>
      <template v-if="addedCount > 0">
        <span class="vals__summary-dot">·</span>
        <span class="vals__summary-added"><strong>{{ addedCount }} added</strong></span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.vals-sec {
  padding: 12px 16px;
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.vals-sec__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 8px;
}
.vals {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
}
.vals__head {
  display: grid;
  grid-template-columns: 22px 180px 1fr 28px 28px;
  gap: 10px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
.vals__head-cell {
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.vals__add {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: 0;
  border-top: 1px dashed var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
  font: 10px var(--wp-font-sans);
  text-align: left;
}
.vals__add:hover {
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.05);
}
.vals__add .pi { font-size: 9px; }
.vals__summary {
  margin-top: 10px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  display: flex;
  align-items: center;
  gap: 6px;
}
.vals__summary strong { color: var(--wp-accent-text, var(--wp-text)); font-weight: 600; }
.vals__summary-dot { color: var(--wp-border-soft, var(--wp-border)); }
.vals__summary-added strong { color: var(--wp-green); }
</style>
