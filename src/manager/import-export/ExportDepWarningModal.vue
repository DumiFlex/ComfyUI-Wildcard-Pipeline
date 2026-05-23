<script setup lang="ts">
/**
 * Pre-export confirmation when selected rows carry outgoing refs to
 * UNSELECTED entities. Three exits:
 *
 *   - `cancel`            — bail out, stay on the picker.
 *   - `include-deps`      — caller runs `selectWithDependencies` and
 *                           reopens the user on the picker so they can
 *                           click Export again with a clean selection.
 *   - `export-anyway`     — proceed with the broken-ref export.
 *
 * Listing the affected rows + their missing deps is optional; the modal
 * surfaces the names so the user can decide without scrolling back to
 * the picker to figure out what's missing.
 */
import Modal from "../components/ui/Modal.vue";

export interface ExportDepWarningRow {
  /** Display name of the row whose deps are unsatisfied. */
  name: string;
  /** Short 8-hex id (already sliced; the modal renders it verbatim). */
  id: string;
  /** Entity kind for the type-icon tint. Same slug rules as PickerRow. */
  kind?: string;
  /** Names of the unsatisfied targets. The modal trims long lists. */
  missing: { name: string; id: string }[];
}

interface Props {
  open: boolean;
  rows: ExportDepWarningRow[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "cancel"): void;
  (e: "include-deps"): void;
  (e: "export-anyway"): void;
}>();

const KIND_CLASS: Record<string, string> = {
  wildcard:     "wildcard",
  fixed_values: "fixed",
  combine:      "combine",
  derivation:   "derivation",
  constraint:   "constraint",
  bundle:       "bundle",
  category:     "category",
};

function iconForKind(kind: string | undefined): string {
  if (kind === "wildcard")     return "pi pi-sparkles";
  if (kind === "fixed_values") return "pi pi-tag";
  if (kind === "combine")      return "pi pi-link";
  if (kind === "derivation")   return "pi pi-arrow-right-arrow-left";
  if (kind === "constraint")   return "pi pi-filter";
  if (kind === "bundle")       return "pi pi-box";
  if (kind === "category")     return "pi pi-folder";
  return "pi pi-circle";
}

function kindClass(kind: string | undefined): string {
  if (!kind) return "bundle";
  return KIND_CLASS[kind] ?? "bundle";
}

function onModalUpdateOpen(v: boolean): void {
  emit("update:open", v);
  if (!v) emit("cancel");
}

function onCancel(): void {
  emit("update:open", false);
  emit("cancel");
}
function onIncludeDeps(): void {
  emit("update:open", false);
  emit("include-deps");
}
function onExportAnyway(): void {
  emit("update:open", false);
  emit("export-anyway");
}
</script>

<template>
  <Modal
    :open="props.open"
    title="Unresolved dependencies"
    size="md"
    @update:open="onModalUpdateOpen"
  >
    <template #header>
      <span class="wp-export-dep-modal__title-count" data-test="export-dep-count">
        {{ props.rows.length }}
        {{ props.rows.length === 1 ? "item" : "items" }}
      </span>
    </template>

    <div class="wp-export-dep-modal" data-test="export-dep-modal">
      <p class="wp-export-dep-modal__lede">
        <strong>{{ props.rows.length }}</strong> selected
        {{ props.rows.length === 1 ? "item references entities" : "items reference entities" }}
        not in your selection. Exporting now leaves those references
        dangling — the importer will flag them as missing deps.
      </p>

      <div class="wp-export-dep-modal__list">
        <div
          v-for="row in props.rows"
          :key="row.id"
          class="wp-export-dep-modal__row"
          :data-test="`export-dep-row-${row.id}`"
        >
          <span
            class="wp-row-type-icon"
            :class="`wp-row-type-icon--${kindClass(row.kind)}`"
            aria-hidden="true"
          >
            <i :class="iconForKind(row.kind)" />
          </span>
          <div class="wp-export-dep-modal__row-body">
            <div class="wp-export-dep-modal__row-head">
              <span class="wp-export-dep-modal__row-name">{{ row.name }}</span>
              <span class="wp-id">{{ row.id }}</span>
              <span class="wp-mod-badge wp-mod-badge--missing">
                MISSING {{ row.missing.length }}
              </span>
            </div>
            <div class="wp-export-dep-modal__row-deps">
              <span
                v-for="d in row.missing.slice(0, 4)"
                :key="d.id"
                class="wp-export-dep-modal__chip"
              >
                <span>{{ d.name }}</span>
                <span class="wp-export-dep-modal__chip-id">{{ d.id.slice(0, 8) }}</span>
              </span>
              <span
                v-if="row.missing.length > 4"
                class="wp-export-dep-modal__chip wp-export-dep-modal__chip--more"
              >+{{ row.missing.length - 4 }} more</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button
        type="button"
        class="wp-btn wp-btn--ghost"
        data-test="export-dep-cancel"
        @click="onCancel"
      >Cancel</button>
      <span class="wp-export-dep-modal__spacer" />
      <button
        type="button"
        class="wp-btn"
        data-test="export-dep-export-anyway"
        @click="onExportAnyway"
      >Export anyway</button>
      <button
        type="button"
        class="wp-btn wp-btn--primary"
        data-test="export-dep-include"
        @click="onIncludeDeps"
      >
        <i class="pi pi-sitemap" aria-hidden="true" /> Include dependencies
      </button>
    </template>
  </Modal>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wp-export-dep-modal {
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
}
.wp-export-dep-modal__title-count {
  margin-left: auto;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  font-weight: 500;
  font-family: var(--wp-font-mono);
}
.wp-export-dep-modal__lede {
  margin: 0 0 14px;
  color: var(--wp-text-muted);
  line-height: 1.5;
}
.wp-export-dep-modal__lede strong {
  color: var(--wp-warn);
  font-weight: 700;
}

.wp-export-dep-modal__list {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  max-height: 340px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.wp-export-dep-modal__list::-webkit-scrollbar { width: 10px; }
.wp-export-dep-modal__list::-webkit-scrollbar-track { background: transparent; }
.wp-export-dep-modal__list::-webkit-scrollbar-thumb {
  background: var(--wp-scrollbar-thumb, rgba(255, 255, 255, 0.08));
  border-radius: 999px;
}

.wp-export-dep-modal__row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  align-items: flex-start;
  padding: 9px 12px;
  border-bottom: 1px solid color-mix(in oklab, var(--wp-border) 50%, transparent);
}
.wp-export-dep-modal__row:last-child { border-bottom: none; }
.wp-export-dep-modal__row .wp-row-type-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--wp-radius-sm);
  margin-top: 1px;
}
.wp-export-dep-modal__row .wp-row-type-icon .pi { font-size: 11px; }

.wp-export-dep-modal__row-body {
  min-width: 0;
}
.wp-export-dep-modal__row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.wp-export-dep-modal__row-name {
  font-weight: 500;
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-id {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  font-weight: 500;
  flex-shrink: 0;
}
.wp-export-dep-modal__row-head .wp-mod-badge {
  font-family: var(--wp-font);
  font-weight: 700;
  font-size: 9.5px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 2px;
  margin-left: auto;
  flex-shrink: 0;
}
.wp-export-dep-modal__row-deps {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.wp-export-dep-modal__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-warn) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 26%, transparent);
  color: var(--wp-warn);
  font-size: var(--wp-text-xs);
  font-weight: 500;
}
.wp-export-dep-modal__chip-id {
  font-family: var(--wp-font-mono);
  font-size: 9.5px;
  color: color-mix(in oklab, var(--wp-warn) 70%, var(--wp-text-muted));
  letter-spacing: 0;
}
.wp-export-dep-modal__chip--more {
  background: var(--wp-bg-3);
  border-color: var(--wp-border);
  color: var(--wp-text-muted);
  font-weight: 600;
}

.wp-export-dep-modal__spacer { flex: 1; }
</style>
