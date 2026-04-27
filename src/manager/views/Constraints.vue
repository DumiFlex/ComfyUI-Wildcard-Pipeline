<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";
import Column from "primevue/column";
import Button from "primevue/button";
import Badge from "primevue/badge";
import Checkbox from "primevue/checkbox";
import MultiSelect from "primevue/multiselect";
import Select from "primevue/select";
import EntityListView from "../components/EntityListView.vue";
import RelativeDate from "../components/RelativeDate.vue";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import type {
  CategoryRow,
  ConstraintCell,
  ConstraintMatrix,
  ConstraintPayload,
  ModuleRow,
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

// All loaded modules — used for wildcard-name lookup. We rely on whatever
// wildcards happen to be in the moduleStore at the moment; if they're not
// present we fall back to the raw id. NOTE: a future moduleStore.lookupById
// helper that fetches a single record on-demand would be cleaner.
const moduleNameById = computed(() => {
  const map = new Map<string, ModuleRow>();
  for (const m of store.items) map.set(m.id, m);
  return map;
});

const allTags = computed(() => {
  const set = new Set<string>();
  for (const m of store.items) for (const t of m.tags ?? []) set.add(t);
  return Array.from(set).sort();
});

onMounted(async () => {
  store.filter.type = "constraint";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "constraint";
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "constraints-edit", params: { id: row.id } });
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.add({ severity: "info", summary: "ID copied", detail: id, life: 1500 });
  } catch {
    toast.add({ severity: "error", summary: "Copy failed", life: 2000 });
  }
}

async function dup(row: ModuleRow) {
  try {
    await store.duplicate(row.id);
    toast.add({ severity: "success", summary: "Duplicated", detail: row.name, life: 2000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "Duplicate failed", detail: String(e), life: 4000 });
  }
}

async function fav(row: ModuleRow) {
  try { await store.toggleFavorite(row.id); }
  catch (e) { toast.add({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 }); }
}

async function del(row: ModuleRow) {
  try {
    await store.remove(row.id);
    toast.add({ severity: "success", summary: "Deleted", detail: row.name, life: 2000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "Delete failed", detail: String(e), life: 4000 });
  }
}

async function bulkDel(items: ModuleRow[]) {
  for (const item of items) await del(item);
}

function payloadOf(row: ModuleRow): ConstraintPayload {
  const p = row.payload as Partial<ConstraintPayload> & {
    // Backwards-compat: tolerate older array-of-arrays payloads silently.
    matrix?: ConstraintMatrix | unknown[];
  };
  const matrix: ConstraintMatrix =
    p.matrix && !Array.isArray(p.matrix) ? (p.matrix as ConstraintMatrix) : {};
  return {
    source_wildcard_id: p.source_wildcard_id ?? null,
    target_wildcard_id: p.target_wildcard_id ?? null,
    matrix,
    exceptions: p.exceptions ?? [],
  };
}

function lookupName(id: string | null): string {
  if (!id) return "—";
  return moduleNameById.value.get(id)?.name ?? id;
}

function exceptionCount(row: ModuleRow): number { return payloadOf(row).exceptions.length; }

interface MatrixSample { source: string; target: string; mode: string; factor: number; }

function matrixSamples(row: ModuleRow, max = 5): MatrixSample[] {
  const p = payloadOf(row);
  const out: MatrixSample[] = [];
  for (const [sourceVal, byTarget] of Object.entries(p.matrix)) {
    if (out.length >= max) break;
    if (!byTarget || typeof byTarget !== "object") continue;
    for (const [targetSub, cellRaw] of Object.entries(byTarget)) {
      if (out.length >= max) break;
      const cell = cellRaw as Partial<ConstraintCell>;
      const mode = cell?.mode ?? "allow";
      const factor =
        typeof cell?.factor === "number"
          ? cell.factor
          : mode === "boost"
            ? 2
            : mode === "reduce"
              ? 0.5
              : 1;
      // Skip plain "allow" cells from the preview to surface meaningful entries.
      if (mode === "allow") continue;
      out.push({ source: sourceVal, target: targetSub, mode, factor });
    }
  }
  return out;
}

function formatFactor(f: number): string {
  if (!Number.isFinite(f)) return "1";
  if (f >= 10) return f.toFixed(0);
  return f.toFixed(2).replace(/\.?0+$/, "");
}
</script>

<template>
  <EntityListView
    title="Constraints"
    subtitle="Constraint modules apply rules between two wildcards' categories."
    new-label="New Constraint"
    new-route="/constraints/new"
    :items="store.items"
    :loading="store.loading"
    :filter="store.filter"
    empty-message="No constraints yet. Use these to set rules between wildcards."
    @fetch="fetch"
    @delete="del"
    @bulk-delete="bulkDel"
  >
    <template #filter-panel="{ filter, emitFetch }">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-wp-text2 mb-1">Category</label>
          <Select
            v-model="filter.category"
            :options="categoryStore.items" option-label="name" option-value="id"
            placeholder="All categories" show-clear class="w-full"
            aria-label="Filter by category"
            @change="emitFetch"
          />
        </div>
        <div>
          <label class="block text-xs text-wp-text2 mb-1">Tags</label>
          <MultiSelect
            v-model="filter.tags"
            :options="allTags"
            placeholder="Any tag" display="chip" filter class="w-full"
            @change="emitFetch"
          />
        </div>
        <div class="col-span-2 flex items-center gap-4 pt-1">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox v-model="filter.favorites" :binary="true" @change="emitFetch" />
            Favorites only
          </label>
        </div>
      </div>
    </template>

    <template #columns>
      <Column selection-mode="multiple" header-style="width:3rem" />
      <Column expander header-style="width:3rem" />
      <Column header-style="width:3rem">
        <template #body="{ data }">
          <Button
            :icon="data.is_favorite ? 'pi pi-star-fill' : 'pi pi-star'"
            text rounded size="small"
            :severity="data.is_favorite ? 'warning' : 'secondary'"
            aria-label="Toggle favorite"
            @click.stop="fav(data)"
          />
        </template>
      </Column>
      <Column field="name" header="Name" sortable>
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <i class="wp-kind-constraint pi pi-sitemap text-wp-amber" aria-hidden="true" />
            <div class="flex flex-col">
              <span class="cursor-pointer font-medium hover:text-white" @click="edit(data)">{{ data.name }}</span>
              <span
                class="text-xs text-wp-text3 font-mono cursor-pointer hover:text-wp-text2 select-all"
                :title="`Click to copy ${data.id}`"
                @click.stop="copyId(data.id)"
              >{{ data.id }}</span>
            </div>
          </div>
        </template>
      </Column>
      <Column field="category_id" header="Category" header-style="width:9rem" sortable>
        <template #body="{ data }">
          <span
            v-if="data.category_id && categoryById.get(data.category_id)"
            class="category-chip"
            :style="{ background: categoryById.get(data.category_id)!.color || 'var(--wp-bg3)' }"
          >
            {{ categoryById.get(data.category_id)!.name }}
          </span>
          <span v-else class="text-wp-text3 text-sm">—</span>
        </template>
      </Column>
      <Column header="Source" header-style="width:11rem">
        <template #body="{ data }">
          <span class="text-sm">{{ lookupName(payloadOf(data).source_wildcard_id) }}</span>
        </template>
      </Column>
      <Column header="Target" header-style="width:11rem">
        <template #body="{ data }">
          <span class="text-sm">{{ lookupName(payloadOf(data).target_wildcard_id) }}</span>
        </template>
      </Column>
      <Column header="Exceptions" header-style="width:7rem">
        <template #body="{ data }">
          <Badge :value="String(exceptionCount(data))" severity="secondary" />
        </template>
      </Column>
      <Column field="tags" header="Tags" header-style="width:13rem">
        <template #body="{ data }">
          <div v-if="data.tags?.length" class="flex flex-wrap gap-1">
            <span v-for="(t, i) in data.tags.slice(0, 3)" :key="i" class="tag-chip">{{ t }}</span>
            <span v-if="data.tags.length > 3" class="text-xs text-wp-text3">+{{ data.tags.length - 3 }}</span>
          </div>
          <span v-else class="text-wp-text3 text-sm">—</span>
        </template>
      </Column>
      <Column field="updated_at" header="Updated" sortable header-style="width:9rem">
        <template #body="{ data }">
          <RelativeDate :value="data.updated_at" />
        </template>
      </Column>
      <Column header="Actions" header-style="width:11rem">
        <template #body="{ data }">
          <div class="flex gap-1" @click.stop>
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="edit(data)" />
            <Button icon="pi pi-copy" text rounded size="small" aria-label="Duplicate" @click="dup(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="del(data)" />
          </div>
        </template>
      </Column>
    </template>

    <template #expansion="{ data }">
      <div class="px-6 py-3">
        <h5 class="text-xs font-semibold mb-2 uppercase tracking-wider text-wp-text2">
          Sample matrix entries for <span class="text-wp-rose">{{ data.name }}</span>
        </h5>
        <div v-if="matrixSamples(data).length === 0" class="text-sm text-wp-text3">
          No non-default matrix cells defined.
        </div>
        <ul v-else class="matrix-list">
          <li
            v-for="(s, i) in matrixSamples(data)" :key="i"
            class="matrix-list__item font-mono text-xs"
          >
            <span class="text-wp-text2">{{ s.source }}</span>
            <span class="text-wp-text3 mx-2">→</span>
            <span class="text-wp-text2">{{ s.target }}</span>
            <span class="text-wp-text3 mx-2">:</span>
            <span class="text-wp-violet">{{ s.mode }}</span>
            <span v-if="s.mode === 'boost' || s.mode === 'reduce'" class="ml-2 text-wp-text3">
              ×{{ formatFactor(s.factor) }}
            </span>
          </li>
        </ul>
        <div v-if="exceptionCount(data)" class="mt-2 text-xs text-wp-text3">
          {{ exceptionCount(data) }} per-pair exception{{ exceptionCount(data) === 1 ? "" : "s" }}
        </div>
      </div>
    </template>
  </EntityListView>
</template>

<style scoped>
.category-chip {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 9px;
  color: #fff;
  font-weight: 500;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
}
.tag-chip {
  font-size: 10px;
  padding: 1px 6px;
  background: var(--wp-bg3);
  color: var(--wp-text2);
  border-radius: 3px;
}
.matrix-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.text-wp-amber { color: var(--wp-kind-constraint, var(--wp-amber, #f7b955)); }
.text-wp-violet { color: var(--wp-violet, #b4a0ff); }
</style>
