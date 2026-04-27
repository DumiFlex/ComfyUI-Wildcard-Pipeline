<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Icon from "../components/ui/Icon.vue";
import Input from "../components/ui/Input.vue";
import ColorPicker from "../components/ColorPicker.vue";
import { useCategoryStore } from "../stores/categoryStore";
import { useModuleStore } from "../stores/moduleStore";
import { ApiError } from "../api/client";
import { useToast } from "../composables/useToast";
import type { CategoryRow } from "../api/types";

const store = useCategoryStore();
const moduleStore = useModuleStore();
const toast = useToast();

const newName = ref("");
const newColor = ref("#a78bfa");

// Inline-edit state for the name column.
const editingId = ref<string | null>(null);
const editingName = ref("");

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

function reportError(e: unknown, summary: string) {
  const msg = e instanceof ApiError ? e.message : String(e);
  toast.push({ severity: "error", summary, detail: msg, life: 4000 });
}

async function add() {
  const name = newName.value.trim();
  if (!name) return;
  try {
    await store.create({ name, color: newColor.value });
    newName.value = "";
    newColor.value = "#a78bfa";
    toast.push({ severity: "success", summary: "Created", life: 2000 });
  } catch (e) {
    reportError(e, "Failed");
  }
}

async function remove(row: CategoryRow) {
  try {
    await store.remove(row.id);
    toast.push({ severity: "success", summary: "Deleted", life: 2000 });
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

async function changeSortOrder(row: CategoryRow, value: number) {
  if (value === row.sort_order) return;
  try {
    await store.update(row.id, { sort_order: value });
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
    toast.push({ severity: "success", summary: "Renamed", life: 1500 });
  } catch (e) {
    reportError(e, "Rename failed");
  } finally {
    cancelInlineEdit();
  }
}
</script>

<template>
  <div class="wp-page wp-page--fill wp-cat-page">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Categories</h1>
        <p class="wp-page__subtitle">
          Tag groups for filtering modules. Color appears on category chips in the DataTable.
        </p>
      </div>
    </div>

    <Card title="New category">
      <div class="wp-cat-newrow">
        <Field label="Name" class="wp-cat-newrow__name">
          <Input
            v-model="newName"
            placeholder="Style"
            aria-label="New category name"
            data-test="new-cat-name"
            @keydown.enter="add"
          />
        </Field>
        <Field label="Color">
          <ColorPicker v-model="newColor" aria-label="New category color" />
        </Field>
        <Button
          variant="primary"
          icon="pi-plus"
          data-test="add-category-btn"
          @click="add"
        >Add</Button>
      </div>
    </Card>

    <div class="wp-table-wrap wp-table-wrap--scroll">
      <table class="wp-table wp-table--sticky-head wp-cat-table">
        <thead>
          <tr>
            <th>Name</th>
            <th class="wp-cat-col--color">Color</th>
            <th class="wp-cat-col--sort">Sort</th>
            <th class="wp-cat-col--count">Modules</th>
            <th class="wp-cat-col--actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.items.length === 0">
            <td colspan="5">
              <div class="wp-empty">
                <div class="wp-empty__icon"><Icon name="pi-bookmark" /></div>
                <div class="wp-dim">No categories yet.</div>
              </div>
            </td>
          </tr>
          <tr
            v-for="row in store.items"
            :key="row.id"
            class="wp-cat-row"
            :data-test="`cat-row-${row.id}`"
          >
            <td>
              <template v-if="editingId === row.id">
                <Input
                  v-model="editingName"
                  :data-test="`cat-name-input-${row.id}`"
                  aria-label="Edit category name"
                  @keydown.enter="commitInlineEdit(row)"
                  @keydown.esc="cancelInlineEdit"
                  @blur="commitInlineEdit(row)"
                />
              </template>
              <template v-else>
                <span
                  class="wp-cat-name"
                  :data-test="`cat-name-${row.id}`"
                  tabindex="0"
                  role="button"
                  :aria-label="`Edit ${row.name}`"
                  :style="{ background: row.color || 'var(--wp-bg-3)' }"
                  @click="startInlineEdit(row)"
                  @keydown.enter.prevent="startInlineEdit(row)"
                >{{ row.name }}</span>
              </template>
            </td>
            <td>
              <div class="wp-cat-color">
                <ColorPicker
                  :model-value="row.color || '#a78bfa'"
                  :aria-label="`Edit color for ${row.name}`"
                  @update:model-value="(v) => changeColor(row, v)"
                />
                <span class="wp-mono wp-dim wp-cat-color__hex">{{ row.color || '—' }}</span>
              </div>
            </td>
            <td>
              <Input
                type="number"
                size="sm"
                :model-value="row.sort_order"
                aria-label="Sort order"
                :data-test="`cat-sort-${row.id}`"
                @blur="(e) => changeSortOrder(row, Number((e.target as HTMLInputElement).value) || 0)"
              />
            </td>
            <td>
              <span class="wp-cat-count" :data-test="`cat-count-${row.id}`">
                {{ moduleCount(row) }}
              </span>
            </td>
            <td class="wp-cat-col--actions">
              <Button
                variant="ghost"
                size="sm"
                icon="pi-trash"
                :aria-label="`Delete ${row.name}`"
                :data-test="`cat-delete-${row.id}`"
                @click="remove(row)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.wp-cat-page { padding: 18px 22px 40px; max-width: 1200px; margin: 0 auto; }

.wp-cat-newrow {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.wp-cat-newrow__name { flex: 1; min-width: 200px; }

.wp-table-wrap--scroll {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-1);
}

.wp-cat-table thead th {
  text-align: left;
  font-weight: 500;
  color: var(--wp-text-muted);
  padding: 9px 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--wp-border-strong);
}
.wp-cat-table tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--wp-border);
  vertical-align: middle;
  font-size: 13px;
}
.wp-cat-table tbody tr:last-child td { border-bottom: none; }

.wp-cat-col--color { width: 240px; }
.wp-cat-col--sort  { width: 90px; }
.wp-cat-col--count { width: 90px; }
.wp-cat-col--actions { width: 80px; text-align: right; }

.wp-cat-name {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  outline: none;
}
.wp-cat-name:focus-visible {
  box-shadow: 0 0 0 2px var(--wp-bg-1), 0 0 0 4px var(--wp-accent-500);
}

.wp-cat-color { display: inline-flex; align-items: center; gap: 8px; }
.wp-cat-color__hex { font-size: 11.5px; }

.wp-cat-count {
  display: inline-block;
  min-width: 2rem;
  padding: 0 8px;
  text-align: center;
  background: var(--wp-bg-3);
  border-radius: 999px;
  font-size: 12px;
  color: var(--wp-text-muted);
}
</style>
