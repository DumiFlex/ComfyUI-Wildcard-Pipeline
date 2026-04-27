<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import ModuleListView from "../components/ModuleListView.vue";
import Button from "../components/ui/Button.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import Select from "../components/ui/Select.vue";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import type {
  CategoryRow,
  ModuleRow,
  ModuleType,
  PipelinePayload,
  PipelineStep,
} from "../api/types";

const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const categoryById = computed(() => {
  const map = new Map<string, CategoryRow>();
  for (const c of categoryStore.items) map.set(c.id, c);
  return map;
});

const moduleById = computed(() => {
  const map = new Map<string, ModuleRow>();
  for (const m of store.items) map.set(m.id, m);
  return map;
});

const allTags = computed(() => {
  const set = new Set<string>();
  for (const m of store.items) for (const t of m.tags ?? []) set.add(t);
  return Array.from(set).sort();
});

const categoryOptions = computed(() => [
  { value: null, label: "All categories" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name })),
]);

onMounted(async () => {
  store.filter.type = "pipeline";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "pipeline";
  try {
    await store.fetchAll();
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "pipelines-edit", params: { id: row.id } });
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.push({ severity: "info", summary: "ID copied", detail: id, life: 1500 });
  } catch {
    toast.push({ severity: "error", summary: "Copy failed", life: 2000 });
  }
}

async function dup(row: ModuleRow) {
  try {
    await store.duplicate(row.id);
    toast.push({ severity: "success", summary: "Duplicated", detail: row.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Duplicate failed", detail: String(e), life: 4000 });
  }
}

async function fav(row: ModuleRow) {
  try { await store.toggleFavorite(row.id); }
  catch (e) { toast.push({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 }); }
}

async function del(row: ModuleRow) {
  try {
    await store.remove(row.id);
    toast.push({ severity: "success", summary: "Deleted", detail: row.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Delete failed", detail: String(e), life: 4000 });
  }
}

async function bulkDel(items: ModuleRow[]) {
  for (const item of items) await del(item);
}

function toggleTag(t: string, currentTags: string[] | undefined): string[] {
  const cur = currentTags ?? [];
  return cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
}

const KIND_ICON: Record<ModuleType, string> = {
  wildcard: "pi pi-th-large",
  fixed_values: "pi pi-tag",
  combine: "pi pi-share-alt",
  derivation: "pi pi-code",
  constraint: "pi pi-sitemap",
  pipeline: "pi pi-list",
};

const KIND_LABEL: Record<ModuleType, string> = {
  wildcard: "Wildcard",
  fixed_values: "Fixed Values",
  combine: "Combine",
  derivation: "Derivation",
  constraint: "Constraint",
  pipeline: "Pipeline",
};

const KIND_COLOR_VAR: Record<ModuleType, string> = {
  wildcard: "var(--wp-kind-wildcard, #c026d3)",
  fixed_values: "var(--wp-kind-fixed_values, #ec4899)",
  combine: "var(--wp-kind-combine, #8b5cf6)",
  derivation: "var(--wp-kind-derivation, #14b8a6)",
  constraint: "var(--wp-kind-constraint, #f59e0b)",
  pipeline: "var(--wp-kind-pipeline, #6aa1ff)",
};

function steps(row: ModuleRow): PipelineStep[] {
  return ((row.payload as Partial<PipelinePayload>).steps ?? []);
}
function stepCount(row: ModuleRow): number { return steps(row).length; }

function stepLabel(step: PipelineStep): { name: string; kind: ModuleType | null } {
  const m = moduleById.value.get(step.module_id);
  return { name: m?.name ?? step.module_id, kind: m?.type ?? null };
}

function iconFor(kind: ModuleType | null): string {
  if (!kind) return "pi pi-circle";
  return KIND_ICON[kind] ?? "pi pi-circle";
}

interface MixCount { kind: ModuleType; count: number; label: string; color: string; icon: string; }

function mixCounts(row: ModuleRow): MixCount[] {
  const counts: Partial<Record<ModuleType, number>> = {};
  for (const s of steps(row)) {
    const m = moduleById.value.get(s.module_id);
    const k = m?.type;
    if (!k) continue;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const order: ModuleType[] = ["wildcard", "fixed_values", "combine", "constraint", "derivation"];
  return order
    .filter((k) => counts[k])
    .map((k) => ({
      kind: k,
      count: counts[k]!,
      label: KIND_LABEL[k],
      color: KIND_COLOR_VAR[k],
      icon: KIND_ICON[k],
    }));
}

function pad2(n: number): string { return String(n + 1).padStart(2, "0"); }
</script>

<template>
  <ModuleListView
    title="Pipelines"
    subtitle="Pipelines are ordered presets of modules. They run top-to-bottom — each step appends to the resolved context the next step sees."
    new-label="New Pipeline"
    new-route="/pipelines/new"
    :items="store.items"
    :loading="store.loading"
    :filter="store.filter"
    :mid-cols="3"
    empty-message="No pipelines yet. Group modules into reusable presets."
    @fetch="fetch"
    @delete="del"
    @bulk-delete="bulkDel"
  >
    <template #filter-panel="{ filter, emitFetch }">
      <div class="wp-filters-grid">
        <div class="wp-field">
          <label class="wp-field__label">Category</label>
          <Select
            :model-value="filter.category ?? null"
            :options="categoryOptions"
            placeholder="Any category"
            aria-label="Filter by category"
            @update:model-value="(v) => { filter.category = v as string | null; emitFetch(); }"
          />
        </div>
        <div class="wp-field">
          <label class="wp-field__label">Favorites</label>
          <label class="wp-fav-toggle">
            <Checkbox
              :model-value="!!filter.favorites"
              @update:model-value="(v) => { filter.favorites = v; emitFetch(); }"
            />
            <span>Favorites only</span>
          </label>
        </div>
        <div class="wp-field wp-field--full">
          <label class="wp-field__label">
            Tags{{ filter.tags?.length ? ` (${filter.tags.length})` : "" }}
          </label>
          <div v-if="!allTags.length" class="wp-dim wp-tags-empty">No tags in this collection.</div>
          <div v-else class="wp-tags-row">
            <button
              v-for="t in allTags" :key="t"
              type="button"
              class="wp-tag-chip"
              :data-active="(filter.tags ?? []).includes(t) ? 'true' : 'false'"
              @click="filter.tags = toggleTag(t, filter.tags); emitFetch()"
            >
              {{ t }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <template #favorite="{ row }">
      <button
        type="button"
        class="wp-row-fav-btn"
        :data-on="row.is_favorite ? 'true' : 'false'"
        :aria-label="row.is_favorite ? 'Unfavorite' : 'Favorite'"
        @click.stop="fav(row)"
      >
        <i :class="row.is_favorite ? 'pi pi-star-fill' : 'pi pi-star'" />
      </button>
    </template>

    <template #name="{ row }">
      <div class="wp-row-name">
        <span class="wp-row-name__text" @click="edit(row)">{{ row.name }}</span>
        <span
          class="wp-id"
          :title="`Click to copy ${row.id}`"
          @click.stop="copyId(row.id)"
        >{{ row.id }}</span>
      </div>
    </template>

    <template #columns-head>
      <th style="width: 130px">Category</th>
      <th style="width: 70px">Steps</th>
      <th style="width: 140px">Mix</th>
    </template>

    <template #columns="{ row }">
      <td>
        <span
          v-if="row.category_id && categoryById.get(row.category_id)"
          class="wp-cat-chip"
          :style="{ background: categoryById.get(row.category_id)!.color || 'var(--wp-bg-3)' }"
        >
          {{ categoryById.get(row.category_id)!.name }}
        </span>
        <span v-else class="wp-dim">—</span>
      </td>
      <td><span class="wp-mono">{{ stepCount(row) }}</span></td>
      <td>
        <div class="wp-mix-cell">
          <span
            v-for="m in mixCounts(row)" :key="m.kind"
            class="wp-mix-chip"
            :title="`${m.count} × ${m.label}`"
            :style="{ color: m.color, background: `color-mix(in oklab, ${m.color} 14%, transparent)` }"
          >
            <i :class="m.icon" />
            {{ m.count }}
          </span>
        </div>
      </td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="edit(row)" />
      <Button variant="ghost" size="sm" icon="pi-clone" aria-label="Duplicate" @click="dup(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div class="wp-row-expand__title">
        {{ stepCount(row) }} step{{ stepCount(row) === 1 ? "" : "s" }} — top to bottom
      </div>
      <div v-if="!stepCount(row)" class="wp-dim">No steps defined.</div>
      <div v-else class="wp-step-list">
        <div
          v-for="(step, idx) in steps(row).slice(0, 6)" :key="step.id ?? idx"
          class="wp-step"
          :class="{ 'wp-step--disabled': step.enabled === false }"
        >
          <span class="wp-step__index">{{ pad2(idx) }}</span>
          <span
            class="wp-step__icon"
            :style="{ color: stepLabel(step).kind ? KIND_COLOR_VAR[stepLabel(step).kind!] : 'var(--wp-text-dim)',
                       background: stepLabel(step).kind ? `color-mix(in oklab, ${KIND_COLOR_VAR[stepLabel(step).kind!]} 18%, transparent)` : 'transparent' }"
          >
            <i :class="iconFor(stepLabel(step).kind)" />
          </span>
          <span class="wp-step__kind">
            {{ stepLabel(step).kind ? KIND_LABEL[stepLabel(step).kind!] : "—" }}
          </span>
          <span class="wp-step__name">{{ stepLabel(step).name }}</span>
          <i
            v-if="step.enabled === false"
            class="pi pi-eye-slash wp-step__toggle wp-step__toggle--off"
            title="Disabled"
          />
          <i
            v-else
            class="pi pi-check-circle wp-step__toggle"
            title="Enabled"
          />
        </div>
      </div>
      <div v-if="stepCount(row) > 6" class="wp-dim wp-opts-more">
        … and {{ stepCount(row) - 6 }} more
      </div>
    </template>
  </ModuleListView>
</template>

<style scoped>
.wp-tags-row { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-tags-empty { font-size: 12px; }
.wp-tag-chip[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}

.wp-mix-cell { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.wp-mix-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 6px; border-radius: 5px;
  font-size: 11px;
  font-family: var(--wp-font-mono);
}
.wp-mix-chip .pi { font-size: 9px; }

.wp-step-list {
  display: grid;
  gap: 4px;
  max-width: 540px;
}
.wp-step {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; border-radius: 6px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  font-size: 12px; min-width: 0;
}
.wp-step--disabled { opacity: 0.55; }
.wp-step__index {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  width: 18px;
}
.wp-step__icon {
  width: 18px; height: 18px;
  border-radius: 4px;
  display: grid; place-items: center;
  font-size: 10px;
  flex-shrink: 0;
}
.wp-step__kind {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
  flex-shrink: 0;
}
.wp-step__name {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-step__toggle { color: var(--wp-text-dim); margin-left: auto; }
.wp-step__toggle--off { color: var(--wp-warn, #fcd34d); }
.wp-opts-more { margin-top: 6px; font-size: 11.5px; }
</style>
