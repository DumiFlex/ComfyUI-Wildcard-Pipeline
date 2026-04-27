<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import Card from "primevue/card";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import Dialog from "primevue/dialog";
import { useToast } from "primevue/usetoast";
import { useCategoryStore } from "../stores/categoryStore";
import { useModuleStore } from "../stores/moduleStore";
import { ApiError } from "../api/client";
import type { CategoryRow } from "../api/types";
import ColorPicker from "../components/ColorPicker.vue";
import RelativeDate from "../components/RelativeDate.vue";

const store = useCategoryStore();
const moduleStore = useModuleStore();
const toast = useToast();

const newName = ref("");
const newColor = ref("#a78bfa");

// Inline-edit state for the name column.
const editingId = ref<string | null>(null);
const editingName = ref("");

// Edit-modal state for the pencil action.
const modalOpen = ref(false);
const modalRow = ref<CategoryRow | null>(null);
const modalName = ref("");
const modalColor = ref("#a78bfa");

// Module counts keyed by category id, derived from the loaded module list.
const countsByCategory = computed(() => {
  const map = new Map<string, number>();
  for (const m of moduleStore.items) {
    if (m.category_id) {
      map.set(m.category_id, (map.get(m.category_id) ?? 0) + 1);
    }
  }
  return map;
});

onMounted(async () => {
  await Promise.all([store.fetchAll(), moduleStore.fetchAll()]);
});

function moduleCount(row: CategoryRow): number {
  return countsByCategory.value.get(row.id) ?? 0;
}

// CategoryRow doesn't formally include updated_at, but the backend may
// include it; expose a helper that reads it defensively for the column.
function rowUpdatedAt(row: CategoryRow): string | undefined {
  return (row as CategoryRow & { updated_at?: string }).updated_at;
}

function reportError(e: unknown, summary: string) {
  const msg = e instanceof ApiError ? e.message : String(e);
  toast.add({ severity: "error", summary, detail: msg, life: 4000 });
}

async function add() {
  const name = newName.value.trim();
  if (!name) return;
  try {
    await store.create({ name, color: newColor.value });
    newName.value = "";
    newColor.value = "#a78bfa";
    toast.add({ severity: "success", summary: "Created", life: 2000 });
  } catch (e) {
    reportError(e, "Failed");
  }
}

async function remove(row: CategoryRow) {
  try {
    await store.remove(row.id);
    toast.add({ severity: "success", summary: "Deleted", life: 2000 });
  } catch (e) {
    reportError(e, "Delete failed");
  }
}

async function changeColor(row: CategoryRow, value: string) {
  if (value === row.color) return;
  try {
    await store.update(row.id, { color: value });
  } catch (e) {
    reportError(e, "Update failed");
  }
}

function startInlineEdit(row: CategoryRow) {
  editingId.value = row.id;
  editingName.value = row.name;
  // Focus the input on the next tick once it has rendered.
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>(
      `[data-test="cat-name-input-${row.id}"]`,
    );
    el?.focus();
    el?.select();
  });
}

function cancelInlineEdit() {
  editingId.value = null;
  editingName.value = "";
}

async function commitInlineEdit(row: CategoryRow) {
  const name = editingName.value.trim();
  if (!name || name === row.name) {
    cancelInlineEdit();
    return;
  }
  try {
    await store.update(row.id, { name });
    toast.add({ severity: "success", summary: "Renamed", life: 1500 });
  } catch (e) {
    reportError(e, "Rename failed");
  } finally {
    cancelInlineEdit();
  }
}

function openEditModal(row: CategoryRow) {
  modalRow.value = row;
  modalName.value = row.name;
  modalColor.value = row.color ?? "#a78bfa";
  modalOpen.value = true;
}

function closeEditModal() {
  modalOpen.value = false;
  modalRow.value = null;
}

async function saveEditModal() {
  if (!modalRow.value) return;
  const id = modalRow.value.id;
  const name = modalName.value.trim();
  if (!name) {
    toast.add({ severity: "warn", summary: "Name is required", life: 2000 });
    return;
  }
  try {
    await store.update(id, { name, color: modalColor.value });
    toast.add({ severity: "success", summary: "Saved", life: 1500 });
    closeEditModal();
  } catch (e) {
    reportError(e, "Save failed");
  }
}
</script>

<template>
  <div class="categories-page">
    <header class="categories-page__header">
      <h1 class="text-xl font-semibold m-0 text-wp-text">Categories</h1>
      <p class="text-sm text-wp-text2 m-0 mt-1">
        Group modules into categories. Each category has a name and a color used as a chip in lists.
      </p>
    </header>

    <Card class="categories-page__new">
      <template #title>
        <span class="text-sm font-medium">New category</span>
      </template>
      <template #content>
        <div class="categories-new-row">
          <InputText
            id="cat-name"
            v-model="newName"
            placeholder="Style"
            class="flex-1"
            aria-label="New category name"
            data-test="new-cat-name"
            @keydown.enter="add"
          />
          <ColorPicker
            v-model="newColor"
            aria-label="New category color"
          />
          <Button
            label="Add"
            icon="pi pi-plus"
            severity="primary"
            data-test="add-category-btn"
            @click="add"
          />
        </div>
      </template>
    </Card>

    <div class="categories-page__table-wrap">
      <table class="categories-table">
        <thead>
          <tr>
            <th class="categories-table__col-color">
              Color
            </th>
            <th>Name</th>
            <th class="categories-table__col-count">
              Modules
            </th>
            <th class="categories-table__col-updated">
              Updated
            </th>
            <th class="categories-table__col-actions">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.items.length === 0">
            <td colspan="5" class="categories-table__empty">
              No categories yet.
            </td>
          </tr>
          <tr
            v-for="row in store.items"
            :key="row.id"
            class="wp-cat-row"
            :data-test="`cat-row-${row.id}`"
          >
            <td>
              <ColorPicker
                :model-value="row.color || '#a78bfa'"
                :aria-label="`Edit color for ${row.name}`"
                @update:model-value="(v) => changeColor(row, v)"
              />
            </td>
            <td>
              <template v-if="editingId === row.id">
                <InputText
                  v-model="editingName"
                  :data-test="`cat-name-input-${row.id}`"
                  aria-label="Edit category name"
                  class="w-full"
                  @keydown.enter="commitInlineEdit(row)"
                  @keydown.esc="cancelInlineEdit"
                  @blur="commitInlineEdit(row)"
                />
              </template>
              <template v-else>
                <span
                  class="categories-table__name"
                  :data-test="`cat-name-${row.id}`"
                  tabindex="0"
                  role="button"
                  :aria-label="`Edit ${row.name}`"
                  @dblclick="startInlineEdit(row)"
                  @keydown.enter.prevent="startInlineEdit(row)"
                >
                  <Tag
                    :value="row.name"
                    :style="{ background: row.color || 'var(--wp-bg-3)', color: '#fff' }"
                  />
                </span>
              </template>
            </td>
            <td>
              <span class="categories-table__count" :data-test="`cat-count-${row.id}`">
                {{ moduleCount(row) }}
              </span>
            </td>
            <td class="text-wp-text2 text-xs">
              <RelativeDate
                v-if="rowUpdatedAt(row)"
                :value="rowUpdatedAt(row)!"
              />
              <span v-else>—</span>
            </td>
            <td>
              <div class="categories-table__actions">
                <Button
                  icon="pi pi-pencil"
                  text
                  rounded
                  size="small"
                  :aria-label="`Edit ${row.name}`"
                  :data-test="`cat-edit-${row.id}`"
                  @click="openEditModal(row)"
                />
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  :aria-label="`Delete ${row.name}`"
                  :data-test="`cat-delete-${row.id}`"
                  @click="remove(row)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <Dialog
      v-model:visible="modalOpen"
      modal
      header="Edit category"
      :style="{ width: '24rem' }"
      :draggable="false"
      @hide="closeEditModal"
    >
      <div class="flex flex-col gap-3">
        <div>
          <label class="block text-xs text-wp-text2 mb-1" for="modal-cat-name">Name</label>
          <InputText
            id="modal-cat-name"
            v-model="modalName"
            class="w-full"
            data-test="modal-cat-name"
            @keydown.enter="saveEditModal"
          />
        </div>
        <div>
          <label class="block text-xs text-wp-text2 mb-1">Color</label>
          <ColorPicker v-model="modalColor" aria-label="Edit category color" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" text @click="closeEditModal" />
        <Button
          label="Save"
          icon="pi pi-check"
          severity="primary"
          data-test="modal-save"
          @click="saveEditModal"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.categories-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 1.25rem;
  gap: 1rem;
  color: var(--wp-text);
}

.categories-page__header {
  flex: 0 0 auto;
}

.categories-page__new {
  flex: 0 0 auto;
}
.categories-page__new :deep(.p-card-body) {
  padding: 0.75rem 1rem;
}
.categories-page__new :deep(.p-card-content) {
  padding: 0;
}

.categories-new-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.categories-new-row > .flex-1 { flex: 1 1 auto; }

/* Sticky-header scroll wrap. The container claims the remaining space so
 * the header + new-category card stay anchored when categories grow.
 */
.categories-page__table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-1);
}

.categories-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.categories-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--wp-bg-2);
  border-bottom: 1px solid var(--wp-border-strong);
  text-align: left;
  font-weight: 500;
  color: var(--wp-text-muted);
  padding: 0.5rem 0.75rem;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.categories-table tbody td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--wp-border);
  vertical-align: middle;
}
.categories-table tbody tr:last-child td {
  border-bottom: none;
}

.categories-table__col-color { width: 80px; }
.categories-table__col-count { width: 6rem; }
.categories-table__col-updated { width: 8rem; }
.categories-table__col-actions { width: 7rem; text-align: right; }

.categories-table__col-actions { text-align: right; }
.categories-table__actions {
  display: inline-flex;
  gap: 0.25rem;
  justify-content: flex-end;
}

.categories-table__count {
  display: inline-block;
  min-width: 2rem;
  padding: 0 0.5rem;
  text-align: center;
  background: var(--wp-bg-3);
  border-radius: 999px;
  font-size: 12px;
  color: var(--wp-text-muted);
}

.categories-table__empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--wp-text-dim);
  font-style: italic;
}

.categories-table__name {
  cursor: text;
  display: inline-flex;
  align-items: center;
  outline: none;
}
.categories-table__name:focus-visible {
  box-shadow: 0 0 0 2px var(--wp-accent-500);
  border-radius: 4px;
}
</style>
