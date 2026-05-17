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
import { catChipStyle } from "../utils/catChip";
import type { CategoryRow } from "../api/types";

const store = useCategoryStore();
const moduleStore = useModuleStore();
const toast = useToast();

const newName = ref("");
const newColor = ref("#a78bfa");

/** Single-row edit state — matches prototype's pencil → save/cancel flow. */
interface EditingState { id: string; name: string; color: string }
const editing = ref<EditingState | null>(null);

const countsByCategory = computed(() => {
  const map = new Map<string, number>();
  for (const m of moduleStore.items) {
    if (m.category_id) map.set(m.category_id, (map.get(m.category_id) ?? 0) + 1);
  }
  return map;
});

async function refresh() {
  try {
    await Promise.all([store.fetchAll(), moduleStore.fetchCatalog()]);
  } catch (e) {
    reportError(e, "Refresh failed");
  }
}

onMounted(refresh);

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
  } catch (e) { reportError(e, "Failed"); }
}

async function remove(row: CategoryRow) {
  try {
    await store.remove(row.id);
    toast.push({ severity: "success", summary: "Deleted", life: 2000 });
  } catch (e) { reportError(e, "Delete failed"); }
}

function startEdit(row: CategoryRow) {
  editing.value = { id: row.id, name: row.name, color: row.color || "#a78bfa" };
  nextTick(() => {
    const el = document.querySelector<HTMLInputElement>(
      `[data-test="cat-name-input-${row.id}"]`,
    );
    el?.focus();
    el?.select();
  });
}

function cancelEdit() {
  editing.value = null;
}

async function saveEdit() {
  if (!editing.value) return;
  const { id, name, color } = editing.value;
  const trimmed = name.trim();
  if (!trimmed) { cancelEdit(); return; }
  try {
    await store.update(id, { name: trimmed, color });
    toast.push({ severity: "success", summary: "Saved", life: 1500 });
  } catch (e) {
    reportError(e, "Update failed");
  } finally {
    cancelEdit();
  }
}
</script>

<template>
  <div class="wp-page wp-page--fill">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Categories</h1>
        <p class="wp-page__subtitle">
          Tag groups for filtering modules. Color appears on category chips.
        </p>
      </div>
      <div class="wp-page__actions">
        <Button
          variant="ghost"
          icon="pi pi-refresh"
          aria-label="Refresh categories"
          :disabled="store.loading"
          :class="{ 'wp-refresh-btn--spin': store.loading }"
          @click="refresh"
        >Refresh</Button>
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
      <table class="wp-table wp-table--sticky-head">
        <thead>
          <tr>
            <th>Name</th>
            <th class="wp-cat-col--color">Color</th>
            <th class="wp-cat-col--count">Modules</th>
            <th class="wp-cat-col--actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.items.length === 0">
            <td colspan="4">
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
              <template v-if="editing && editing.id === row.id">
                <Input
                  v-model="editing.name"
                  :data-test="`cat-name-input-${row.id}`"
                  aria-label="Edit category name"
                  @keydown.enter="saveEdit"
                  @keydown.esc="cancelEdit"
                />
              </template>
              <template v-else>
                <span
                  class="wp-cat-chip"
                  :data-test="`cat-name-${row.id}`"
                  :style="catChipStyle(row.color)"
                >{{ row.name }}</span>
              </template>
            </td>
            <td>
              <template v-if="editing && editing.id === row.id">
                <ColorPicker
                  v-model="editing.color"
                  :aria-label="`Edit color for ${row.name}`"
                />
              </template>
              <template v-else>
                <span class="wp-mono wp-dim wp-cat-hex">{{ row.color || "—" }}</span>
              </template>
            </td>
            <td>
              <span class="wp-mono" :data-test="`cat-count-${row.id}`">{{ moduleCount(row) }}</span>
            </td>
            <td class="wp-cat-col--actions">
              <template v-if="editing && editing.id === row.id">
                <Button
                  variant="primary"
                  size="sm"
                  icon="pi-check"
                  :aria-label="`Save ${row.name}`"
                  :data-test="`cat-save-${row.id}`"
                  @click="saveEdit"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="pi-times"
                  :aria-label="`Cancel editing ${row.name}`"
                  :data-test="`cat-cancel-${row.id}`"
                  @click="cancelEdit"
                />
              </template>
              <template v-else>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="pi-pencil"
                  :aria-label="`Edit ${row.name}`"
                  :data-test="`cat-edit-${row.id}`"
                  @click="startEdit(row)"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon="pi-trash"
                  :aria-label="`Delete ${row.name}`"
                  :data-test="`cat-delete-${row.id}`"
                  @click="remove(row)"
                />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.wp-cat-newrow {
  display: flex;
  align-items: flex-end;
  gap: var(--wp-space-5);
  flex-wrap: wrap;
}
.wp-cat-newrow__name { flex: 1; min-width: 200px; }

.wp-cat-col--color   { width: 360px; }
.wp-cat-col--count   { width: 110px; }
.wp-cat-col--actions { width: 110px; text-align: right; white-space: nowrap; }
.wp-cat-col--actions .wp-btn + .wp-btn { margin-left: var(--wp-space-2); }

.wp-cat-hex { font-size: 11.5px; }
</style>
