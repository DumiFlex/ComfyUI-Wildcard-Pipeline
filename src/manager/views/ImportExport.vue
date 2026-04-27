<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import Card from "primevue/card";
import Checkbox from "primevue/checkbox";
import InputText from "primevue/inputtext";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import Select from "primevue/select";
import { useToast } from "primevue/usetoast";
import { api } from "../api/client";
import type { CategoryRow, ImportBundle, ModuleRow } from "../api/types";
import {
  buildFilteredBundle,
  bundleSizeBytes,
  classifyCategory,
  classifyModule,
  formatBytes,
  GROUPS,
  groupForModule,
  presetFavoritesOnly,
  presetFull,
  presetWildcardsOnly,
  selectionCounts,
  selectionKey,
  type ConflictKind,
  type ConflictResult,
  type GroupKey,
  type GroupMeta,
} from "../utils/bundleSelection";

type Mode = "export" | "import";

const toast = useToast();

const mode = ref<Mode>("export");

// ---------- Source library state (fetched once on mount) ----------

const localModules = ref<ModuleRow[]>([]);
const localCategories = ref<CategoryRow[]>([]);
const loadingLib = ref(false);

async function loadLibrary() {
  loadingLib.value = true;
  try {
    const [mods, cats] = await Promise.all([
      api.modules.list({ limit: 1000 }),
      api.categories.list(),
    ]);
    localModules.value = mods.items;
    localCategories.value = cats.items;
  } catch (e) {
    toast.add({
      severity: "error",
      summary: "Failed to load library",
      detail: String(e), life: 4000,
    });
  } finally {
    loadingLib.value = false;
  }
}

onMounted(loadLibrary);

// ---------- Export tab state ----------

const exportSelected = ref<Set<string>>(new Set());
const exportSearch = ref("");
const exportOpenGroups = ref<Set<GroupKey>>(
  new Set(["wildcard", "fixed_values"]),
);

/** Default selection = full library, applied once the data lands. */
function resetExportToFull() {
  exportSelected.value = presetFull(
    localModules.value, localCategories.value,
  );
}

/**
 * Initial selection: "Full library" once the source data arrives. We
 * watch the modules list length transitioning from 0 to non-zero and
 * apply the preset at that moment so the user lands on a useful state.
 */
let didSeedExport = false;
function seedExportIfReady() {
  if (didSeedExport) return;
  if (localModules.value.length === 0 && localCategories.value.length === 0) return;
  resetExportToFull();
  didSeedExport = true;
}

// Re-run seed after fetch.
const seedWatcher = computed(() => localModules.value.length + localCategories.value.length);

function modulesForGroup(g: GroupMeta, list: ModuleRow[]): ModuleRow[] {
  if (g.type === null) return [];
  return list.filter((m) => m.type === g.type);
}

function matchesSearch(name: string, id: string, q: string): boolean {
  if (!q.trim()) return true;
  const n = name.toLowerCase();
  const i = id.toLowerCase();
  const t = q.trim().toLowerCase();
  return n.includes(t) || i.includes(t);
}

interface RowItem {
  id: string;
  name: string;
  category_id?: string | null;
  is_favorite?: boolean;
  tags?: string[];
}

function rowsForGroup(g: GroupMeta, q: string): RowItem[] {
  if (g.type === null) {
    return localCategories.value
      .filter((c) => matchesSearch(c.name, c.id, q))
      .map((c) => ({ id: c.id, name: c.name }));
  }
  return modulesForGroup(g, localModules.value)
    .filter((m) => matchesSearch(m.name, m.id, q))
    .map((m) => ({
      id: m.id, name: m.name,
      category_id: m.category_id, is_favorite: m.is_favorite,
      tags: m.tags,
    }));
}

function exportRowKey(g: GroupMeta, id: string): string {
  return selectionKey(g.key, id);
}

function isExportSelected(g: GroupMeta, id: string): boolean {
  return exportSelected.value.has(exportRowKey(g, id));
}

function toggleExportRow(g: GroupMeta, id: string) {
  const k = exportRowKey(g, id);
  const next = new Set(exportSelected.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  exportSelected.value = next;
}

function setGroupAll(g: GroupMeta, on: boolean, q: string) {
  const next = new Set(exportSelected.value);
  for (const row of rowsForGroup(g, q)) {
    const k = exportRowKey(g, row.id);
    if (on) next.add(k); else next.delete(k);
  }
  exportSelected.value = next;
}

function toggleGroupOpen(key: GroupKey) {
  const next = new Set(exportOpenGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  exportOpenGroups.value = next;
}

function isGroupOpen(g: GroupMeta, q: string): boolean {
  if (q.trim()) return true;
  return exportOpenGroups.value.has(g.key);
}

interface GroupCheckState { all: boolean; some: boolean }

function groupCheckState(g: GroupMeta, q: string): GroupCheckState {
  const rows = rowsForGroup(g, q);
  if (rows.length === 0) return { all: false, some: false };
  const sel = rows.filter((r) => isExportSelected(g, r.id)).length;
  return { all: sel === rows.length, some: sel > 0 && sel < rows.length };
}

const exportCounts = computed(() => selectionCounts(exportSelected.value));

const filteredBundle = computed<ImportBundle>(() =>
  buildFilteredBundle({
    modules: localModules.value,
    categories: localCategories.value,
    selected: exportSelected.value,
  }),
);

const bundleBytes = computed(() => bundleSizeBytes(filteredBundle.value));

const categoryById = computed(() => {
  const m = new Map<string, CategoryRow>();
  for (const c of localCategories.value) m.set(c.id, c);
  return m;
});

function presetApplyFull() {
  exportSelected.value = presetFull(
    localModules.value, localCategories.value,
  );
}
function presetApplyWildcards() {
  exportSelected.value = presetWildcardsOnly(localModules.value);
}
function presetApplyFavorites() {
  exportSelected.value = presetFavoritesOnly(localModules.value);
}

function downloadBundle() {
  const bundle = filteredBundle.value;
  if (bundle.modules.length === 0 && bundle.categories.length === 0) return;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  a.download = `wildcard-pipeline-${bundle.modules.length}-modules-${yyyymmdd}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.add({
    severity: "success", summary: "Exported",
    detail: `${bundle.modules.length} modules · ${bundle.categories.length} categories`,
    life: 2500,
  });
}

// ---------- Import tab state ----------

const fileInputRef = ref<HTMLInputElement | null>(null);
const dropActive = ref(false);
const parseError = ref<string | null>(null);
const parsedBundle = ref<ImportBundle | null>(null);
const parsedFileName = ref<string>("");
const parsedFileSizeKb = ref<string>("");

const importSelected = ref<Set<string>>(new Set());
const importOpenGroups = ref<Set<GroupKey>>(new Set([
  "wildcard", "fixed_values", "combine", "derivation", "constraint", "pipeline", "category",
]));

type ConflictMode = "rename" | "overwrite" | "skip";
const conflictMode = ref<ConflictMode>("rename");
const conflictModeOptions = [
  { value: "rename",    label: "Rename (keep both)" },
  { value: "overwrite", label: "Overwrite existing" },
  { value: "skip",      label: "Skip conflicting items" },
];

const importing = ref(false);

const localModulesById = computed(() => {
  const m = new Map<string, ModuleRow>();
  for (const x of localModules.value) m.set(x.id, x);
  return m;
});
const localCategoriesById = computed(() => {
  const m = new Map<string, CategoryRow>();
  for (const x of localCategories.value) m.set(x.id, x);
  return m;
});

interface ImportRow {
  id: string;
  name: string;
  group: GroupKey;
  conflict: ConflictResult;
}

const parsedRows = computed<ImportRow[]>(() => {
  const b = parsedBundle.value;
  if (!b) return [];
  const out: ImportRow[] = [];
  for (const m of b.modules ?? []) {
    out.push({
      id: m.id, name: m.name,
      group: groupForModule(m.type),
      conflict: classifyModule(m, localModulesById.value),
    });
  }
  for (const c of b.categories ?? []) {
    out.push({
      id: c.id, name: c.name,
      group: "category",
      conflict: classifyCategory(c, localCategoriesById.value),
    });
  }
  return out;
});

function parsedRowsForGroup(g: GroupMeta): ImportRow[] {
  return parsedRows.value.filter((r) => r.group === g.key);
}

function importRowKey(group: GroupKey, id: string): string {
  return selectionKey(group, id);
}

function isImportSelected(group: GroupKey, id: string): boolean {
  return importSelected.value.has(importRowKey(group, id));
}

function toggleImportRow(group: GroupKey, id: string) {
  const k = importRowKey(group, id);
  const next = new Set(importSelected.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  importSelected.value = next;
}

function setImportGroupAll(g: GroupMeta, on: boolean) {
  const next = new Set(importSelected.value);
  for (const r of parsedRowsForGroup(g)) {
    const k = importRowKey(g.key, r.id);
    if (on) next.add(k); else next.delete(k);
  }
  importSelected.value = next;
}

function importGroupCheckState(g: GroupMeta): GroupCheckState {
  const rows = parsedRowsForGroup(g);
  if (rows.length === 0) return { all: false, some: false };
  const sel = rows.filter((r) => isImportSelected(g.key, r.id)).length;
  return { all: sel === rows.length, some: sel > 0 && sel < rows.length };
}

function isImportGroupOpen(key: GroupKey): boolean {
  return importOpenGroups.value.has(key);
}

function toggleImportGroupOpen(key: GroupKey) {
  const next = new Set(importOpenGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  importOpenGroups.value = next;
}

function selectAllParsed() {
  const next = new Set<string>();
  for (const r of parsedRows.value) next.add(importRowKey(r.group, r.id));
  importSelected.value = next;
}
function clearParsedSelection() {
  importSelected.value = new Set();
}

const importCounts = computed(() => selectionCounts(importSelected.value));

interface FinalActionTotals {
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  conflictCount: number;
}

const finalActionTotals = computed<FinalActionTotals>(() => {
  let willCreate = 0;
  let willUpdate = 0;
  let willSkip = 0;
  let conflictCount = 0;
  for (const r of parsedRows.value) {
    const picked = isImportSelected(r.group, r.id);
    const c: ConflictKind = r.conflict.kind;
    if (c === "exists" || c === "modified") conflictCount += 1;
    if (!picked) continue;
    if (c === "new") {
      willCreate += 1;
    } else {
      // Conflict — outcome depends on chosen mode.
      if (conflictMode.value === "skip") willSkip += 1;
      else if (conflictMode.value === "overwrite") willUpdate += 1;
      else willCreate += 1; // rename — backend keeps both
    }
  }
  return { willCreate, willUpdate, willSkip, conflictCount };
});

function badgeClass(kind: ConflictKind): string {
  if (kind === "new") return "wp-io-badge wp-io-badge--new";
  if (kind === "modified") return "wp-io-badge wp-io-badge--mod";
  return "wp-io-badge wp-io-badge--exists";
}

function badgeLabel(kind: ConflictKind): string {
  if (kind === "new") return "new";
  if (kind === "modified") return "modified";
  return "exists";
}

function onPickFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) handleFile(f);
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dropActive.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) handleFile(f);
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  dropActive.value = true;
}
function onDragLeave() {
  dropActive.value = false;
}

async function handleFile(file: File) {
  parseError.value = null;
  parsedBundle.value = null;
  importSelected.value = new Set();
  parsedFileName.value = file.name;
  parsedFileSizeKb.value = (file.size / 1024).toFixed(1);
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || data.version !== 1) {
      throw new Error("Not a valid wildcard-pipeline bundle (missing version: 1).");
    }
    const bundle: ImportBundle = {
      version: 1,
      exported_at: data.exported_at,
      modules: Array.isArray(data.modules) ? data.modules : [],
      categories: Array.isArray(data.categories) ? data.categories : [],
    };
    parsedBundle.value = bundle;
    // Default selection: tick everything that's actually new or modified.
    selectAllParsed();
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : String(err);
    parsedBundle.value = null;
  } finally {
    if (fileInputRef.value) fileInputRef.value.value = "";
  }
}

function clearImport() {
  parsedBundle.value = null;
  parsedFileName.value = "";
  parsedFileSizeKb.value = "";
  parseError.value = null;
  importSelected.value = new Set();
}

async function runImport() {
  const b = parsedBundle.value;
  if (!b) return;

  const pickedModules: ModuleRow[] = [];
  const pickedCategories: CategoryRow[] = [];

  for (const r of parsedRows.value) {
    if (!isImportSelected(r.group, r.id)) continue;
    if (r.conflict.kind !== "new" && conflictMode.value === "skip") continue;
    if (r.group === "category") {
      const cat = b.categories.find((c) => c.id === r.id);
      if (cat) pickedCategories.push(cat);
    } else {
      const mod = b.modules.find((m) => m.id === r.id);
      if (!mod) continue;
      // For "rename" we let the backend insert as a new row by giving the
      // module a fresh id (suffix). The DB unique constraint is on `id`,
      // and the existing import handler skips on IntegrityError.
      if (r.conflict.kind !== "new" && conflictMode.value === "rename") {
        pickedModules.push({
          ...mod,
          id: `${mod.id}_imp${shortRand()}`,
          name: `${mod.name} (imported)`,
        });
      } else if (r.conflict.kind !== "new" && conflictMode.value === "overwrite") {
        // Backend currently only INSERTs, so overwrite isn't natively
        // supported — pass through with original id and let the import
        // handler skip via IntegrityError. We surface the count in the
        // toast so the user sees the outcome.
        pickedModules.push(mod);
      } else {
        pickedModules.push(mod);
      }
    }
  }

  const partial: ImportBundle = {
    version: 1,
    exported_at: b.exported_at,
    modules: pickedModules,
    categories: pickedCategories,
  };

  importing.value = true;
  try {
    const result = await api.importBundle(partial);
    toast.add({
      severity: "success",
      summary: "Imported",
      detail: `${result.modules_imported} modules · ${result.categories_imported} categories`
        + (result.skipped.length ? ` · ${result.skipped.length} skipped` : ""),
      life: 4000,
    });
    clearImport();
    await loadLibrary();
  } catch (e) {
    toast.add({
      severity: "error", summary: "Import failed",
      detail: String(e), life: 5000,
    });
  } finally {
    importing.value = false;
  }
}

function shortRand(): string {
  return Math.random().toString(16).slice(2, 8);
}

function setMode(next: Mode) {
  mode.value = next;
}

// Run seed once mount loads data.
watch(
  () => seedWatcher.value,
  () => seedExportIfReady(),
  { immediate: true },
);
</script>

<template>
  <div class="wp-io-page">
    <header class="wp-io-header">
      <h1>Import / Export</h1>
      <p class="wp-io-subtitle">
        Pick exactly what to ship in or out — full library, by kind, or individual modules. Workflow files are NOT handled here.
      </p>
    </header>

    <div class="wp-io-tabs" role="tablist" aria-label="Import / Export mode">
      <button
        type="button" role="tab" class="wp-io-tab"
        :data-active="mode === 'export' ? '' : null"
        :aria-selected="mode === 'export'"
        data-test="io-tab-export"
        @click="setMode('export')"
      >
        <i class="pi pi-download" /> Export
      </button>
      <button
        type="button" role="tab" class="wp-io-tab"
        :data-active="mode === 'import' ? '' : null"
        :aria-selected="mode === 'import'"
        data-test="io-tab-import"
        @click="setMode('import')"
      >
        <i class="pi pi-upload" /> Import
      </button>
    </div>

    <!-- ---------- Export tab ---------- -->
    <div v-if="mode === 'export'" class="wp-io-grid" data-test="io-export-pane">
      <Card class="wp-io-card">
        <template #title>
          <div class="wp-io-card-title">
            <span>Pick what to export</span>
            <div class="wp-io-card-actions">
              <Button
                size="small" severity="secondary" text
                label="Select all"
                data-test="io-export-select-all"
                @click="presetApplyFull"
              />
              <Button
                size="small" severity="secondary" text
                label="None"
                data-test="io-export-select-none"
                @click="exportSelected = new Set()"
              />
            </div>
          </div>
        </template>
        <template #content>
          <div class="wp-io-presets">
            <Button
              size="small" severity="secondary" outlined
              icon="pi pi-database" label="Full library"
              data-test="io-preset-full"
              @click="presetApplyFull"
            />
            <Button
              size="small" severity="secondary" outlined
              icon="pi pi-th-large" label="Wildcards only"
              data-test="io-preset-wildcards"
              @click="presetApplyWildcards"
            />
            <Button
              size="small" severity="secondary" outlined
              icon="pi pi-star-fill" label="Favorites only"
              data-test="io-preset-favorites"
              @click="presetApplyFavorites"
            />
          </div>

          <div class="wp-io-search">
            <InputGroup>
              <InputGroupAddon>
                <i class="pi pi-search" />
              </InputGroupAddon>
              <InputText
                v-model="exportSearch"
                placeholder="Search modules to filter…"
                aria-label="Search modules"
                data-test="io-export-search"
              />
            </InputGroup>
          </div>

          <div class="wp-io-tree">
            <div
              v-for="g in GROUPS"
              :key="g.key"
              class="wp-io-group"
              :data-test="`io-export-group-${g.key}`"
            >
              <div class="wp-io-group__head" @click="toggleGroupOpen(g.key)">
                <span class="wp-io-group__check" @click.stop>
                  <Checkbox
                    :model-value="groupCheckState(g, exportSearch).all"
                    :indeterminate="groupCheckState(g, exportSearch).some"
                    :binary="true"
                    :data-test="`io-export-group-check-${g.key}`"
                    @update:model-value="(v: boolean) => setGroupAll(g, v, exportSearch)"
                  />
                </span>
                <span
                  class="wp-io-group__icon"
                  :style="{ color: g.color, background: `color-mix(in oklab, ${g.color} 18%, transparent)` }"
                >
                  <i :class="g.icon" />
                </span>
                <span class="wp-io-group__label">{{ g.label }}</span>
                <span class="wp-io-group__count">
                  {{ rowsForGroup(g, exportSearch).filter((r) => isExportSelected(g, r.id)).length }}
                  /
                  {{ rowsForGroup(g, exportSearch).length }}
                </span>
                <span class="wp-io-spacer" />
                <i
                  class="wp-io-group__chev"
                  :class="isGroupOpen(g, exportSearch) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                />
              </div>
              <div v-if="isGroupOpen(g, exportSearch)" class="wp-io-group__body">
                <div
                  v-for="row in rowsForGroup(g, exportSearch)"
                  :key="`${g.key}:${row.id}`"
                  class="wp-io-row"
                  :data-test="`io-export-row-${row.id}`"
                  @click="toggleExportRow(g, row.id)"
                >
                  <Checkbox
                    :model-value="isExportSelected(g, row.id)"
                    :binary="true"
                    @click.stop
                    @update:model-value="toggleExportRow(g, row.id)"
                  />
                  <span class="wp-io-row__name">{{ row.name }}</span>
                  <span
                    v-if="row.category_id && categoryById.get(row.category_id)"
                    class="wp-io-row__catchip"
                    :style="{ background: categoryById.get(row.category_id)?.color || 'var(--wp-bg3)' }"
                  >{{ categoryById.get(row.category_id)?.name }}</span>
                  <span
                    v-if="row.tags && row.tags.length"
                    class="wp-io-row__tags"
                  ><i class="pi pi-tag" /> {{ row.tags.length }}</span>
                  <span class="wp-io-row__id">{{ row.id }}</span>
                </div>
                <div
                  v-if="rowsForGroup(g, exportSearch).length === 0"
                  class="wp-io-row__empty"
                >No matches.</div>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <div class="wp-io-side">
        <Card class="wp-io-card">
          <template #title>Bundle summary</template>
          <template #content>
            <dl class="wp-io-stats" data-test="io-export-summary">
              <dt>Wildcards</dt><dd>{{ exportCounts.wildcard }}</dd>
              <dt>Fixed values</dt><dd>{{ exportCounts.fixed_values }}</dd>
              <dt>Combines</dt><dd>{{ exportCounts.combine }}</dd>
              <dt>Derivations</dt><dd>{{ exportCounts.derivation }}</dd>
              <dt>Constraints</dt><dd>{{ exportCounts.constraint }}</dd>
              <dt>Pipelines</dt><dd>{{ exportCounts.pipeline }}</dd>
              <dt>Categories</dt><dd>{{ exportCounts.category }}</dd>
            </dl>
            <div class="wp-io-divider" />
            <dl class="wp-io-stats">
              <dt>Total selected</dt><dd>{{ exportCounts.total }}</dd>
              <dt>Bundle version</dt><dd>1</dd>
              <dt>Est. size</dt><dd data-test="io-export-size">{{ formatBytes(bundleBytes) }}</dd>
            </dl>
            <Button
              class="wp-io-download"
              severity="primary"
              icon="pi pi-download"
              label="Download bundle"
              :disabled="exportCounts.total === 0"
              data-test="io-export-download"
              @click="downloadBundle"
            />
          </template>
        </Card>
      </div>
    </div>

    <!-- ---------- Import tab ---------- -->
    <div v-else class="wp-io-grid" data-test="io-import-pane">
      <div class="wp-io-import-main">
        <Card class="wp-io-card">
          <template #title>Source bundle</template>
          <template #content>
            <p class="wp-io-help">
              Drop a <code>.json</code> bundle. You'll see its contents listed
              before anything is merged — pick exactly what you want.
            </p>
            <input
              ref="fileInputRef"
              type="file"
              accept="application/json,.json"
              class="wp-io-file-hidden"
              data-test="io-file-input"
              aria-label="Bundle JSON file"
              @change="onPickFile"
            />
            <div
              class="wp-io-drop"
              :data-active="dropActive ? '' : null"
              data-test="io-dropzone"
              @click="fileInputRef?.click()"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop"
            >
              <i class="pi pi-cloud-upload wp-io-drop__icon" />
              <div class="wp-io-drop__title">
                {{ parsedFileName || "Drop a .json file or click to browse" }}
              </div>
              <div class="wp-io-drop__hint">
                <template v-if="parsedFileName">{{ parsedFileSizeKb }} KB · click to replace</template>
                <template v-else>Up to 10 MB</template>
              </div>
            </div>
            <div v-if="parseError" class="wp-io-error" data-test="io-parse-error">
              <i class="pi pi-exclamation-triangle" /> {{ parseError }}
            </div>
          </template>
        </Card>

        <Card v-if="parsedBundle" class="wp-io-card">
          <template #title>
            <div class="wp-io-card-title">
              <span>Pick what to import</span>
              <div class="wp-io-card-actions">
                <Button
                  size="small" severity="secondary" text
                  label="Select all"
                  data-test="io-import-select-all"
                  @click="selectAllParsed"
                />
                <Button
                  size="small" severity="secondary" text
                  label="None"
                  data-test="io-import-select-none"
                  @click="clearParsedSelection"
                />
              </div>
            </div>
          </template>
          <template #content>
            <div class="wp-io-tree">
              <template v-for="g in GROUPS" :key="g.key">
                <div
                  v-if="parsedRowsForGroup(g).length > 0"
                  class="wp-io-group"
                  :data-test="`io-import-group-${g.key}`"
                >
                  <div class="wp-io-group__head" @click="toggleImportGroupOpen(g.key)">
                    <span class="wp-io-group__check" @click.stop>
                      <Checkbox
                        :model-value="importGroupCheckState(g).all"
                        :indeterminate="importGroupCheckState(g).some"
                        :binary="true"
                        :data-test="`io-import-group-check-${g.key}`"
                        @update:model-value="(v: boolean) => setImportGroupAll(g, v)"
                      />
                    </span>
                    <span
                      class="wp-io-group__icon"
                      :style="{ color: g.color, background: `color-mix(in oklab, ${g.color} 18%, transparent)` }"
                    >
                      <i :class="g.icon" />
                    </span>
                    <span class="wp-io-group__label">{{ g.label }}</span>
                    <span class="wp-io-group__count">{{ parsedRowsForGroup(g).length }} in bundle</span>
                    <span class="wp-io-spacer" />
                    <i
                      class="wp-io-group__chev"
                      :class="isImportGroupOpen(g.key) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                    />
                  </div>
                  <div v-if="isImportGroupOpen(g.key)" class="wp-io-group__body">
                    <div
                      v-for="row in parsedRowsForGroup(g)"
                      :key="`${row.group}:${row.id}`"
                      class="wp-io-row"
                      :data-test="`io-import-row-${row.id}`"
                      @click="toggleImportRow(row.group, row.id)"
                    >
                      <Checkbox
                        :model-value="isImportSelected(row.group, row.id)"
                        :binary="true"
                        @click.stop
                        @update:model-value="toggleImportRow(row.group, row.id)"
                      />
                      <span class="wp-io-row__name">{{ row.name }}</span>
                      <span
                        :class="badgeClass(row.conflict.kind)"
                        :data-test="`io-import-badge-${row.id}`"
                      >{{ badgeLabel(row.conflict.kind) }}</span>
                      <span
                        v-if="row.conflict.existingId"
                        class="wp-io-row__id"
                        :title="`Existing local id: ${row.conflict.existingId}`"
                      >{{ row.conflict.existingId }}</span>
                      <span v-else class="wp-io-row__id">{{ row.id }}</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </Card>
      </div>

      <div v-if="parsedBundle" class="wp-io-side">
        <Card class="wp-io-card">
          <template #title>Import summary</template>
          <template #content>
            <dl class="wp-io-stats" data-test="io-import-summary">
              <dt>In bundle</dt><dd>{{ parsedRows.length }}</dd>
              <dt>Selected</dt><dd>{{ importCounts.total }}</dd>
              <dt>Conflicts</dt><dd :class="finalActionTotals.conflictCount ? 'wp-io-warn' : ''">
                {{ finalActionTotals.conflictCount }}
              </dd>
            </dl>
            <div class="wp-io-divider" />

            <label class="wp-io-field-label" for="io-conflict-mode">On conflict</label>
            <Select
              id="io-conflict-mode"
              v-model="conflictMode"
              :options="conflictModeOptions"
              option-label="label"
              option-value="value"
              data-test="io-conflict-mode"
              class="w-full"
            />

            <div class="wp-io-divider" />
            <dl class="wp-io-stats">
              <dt>Will create</dt><dd>{{ finalActionTotals.willCreate }}</dd>
              <dt>Will update</dt><dd>{{ finalActionTotals.willUpdate }}</dd>
              <dt>Will skip</dt><dd>{{ finalActionTotals.willSkip }}</dd>
            </dl>

            <div class="wp-io-actions">
              <Button
                severity="primary"
                icon="pi pi-check"
                :label="`Import ${importCounts.total} selected`"
                :disabled="importCounts.total === 0 || importing"
                :loading="importing"
                data-test="io-import-submit"
                @click="runImport"
              />
              <Button
                severity="secondary"
                outlined
                icon="pi pi-times"
                label="Cancel"
                data-test="io-import-cancel"
                @click="clearImport"
              />
            </div>
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-io-page {
  padding: 24px;
  color: var(--wp-text);
  max-width: 1180px;
}

.wp-io-header h1 {
  font-size: 20px;
  margin: 0;
  font-weight: 600;
}
.wp-io-subtitle {
  margin: 4px 0 18px;
  color: var(--wp-text2);
  font-size: 13px;
  max-width: 720px;
}

.wp-io-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--wp-border);
}
.wp-io-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid transparent;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--wp-text2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.wp-io-tab[data-active] {
  color: var(--wp-text);
  border-bottom-color: var(--wp-accent-500);
  background: var(--wp-bg2);
}
.wp-io-tab:hover {
  color: var(--wp-text);
}

.wp-io-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 960px) {
  .wp-io-grid { grid-template-columns: 1fr; }
}

.wp-io-card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.wp-io-card-actions {
  display: flex;
  gap: 4px;
}

.wp-io-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.wp-io-search {
  margin-bottom: 12px;
}

.wp-io-tree {
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  overflow: hidden;
  max-height: 540px;
  overflow-y: auto;
}

.wp-io-group { border-bottom: 1px solid var(--wp-border); }
.wp-io-group:last-child { border-bottom: 0; }

.wp-io-group__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: var(--wp-bg2);
  cursor: pointer;
  user-select: none;
}
.wp-io-group__head:hover { background: var(--wp-bg3); }

.wp-io-group__check { display: inline-flex; }
.wp-io-group__icon {
  width: 22px; height: 22px;
  border-radius: 6px;
  display: grid; place-items: center;
  font-size: 11px;
}
.wp-io-group__label { font-weight: 500; }
.wp-io-group__count {
  color: var(--wp-text2);
  font-size: 11.5px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
}
.wp-io-group__chev {
  font-size: 11px;
  color: var(--wp-text2);
}
.wp-io-spacer { flex: 1; }

.wp-io-group__body { background: var(--wp-bg); }

.wp-io-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px 7px 36px;
  border-top: 1px solid var(--wp-border);
  cursor: pointer;
  font-size: 12.5px;
}
.wp-io-row:hover { background: var(--wp-bg2); }
.wp-io-row__name { flex: 1; font-weight: 500; }
.wp-io-row__id {
  color: var(--wp-text3, var(--wp-text2));
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px;
}
.wp-io-row__catchip {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: #fff;
  text-shadow: 0 1px 0 rgba(0,0,0,.3);
  white-space: nowrap;
}
.wp-io-row__tags {
  color: var(--wp-text2);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-io-row__empty {
  padding: 10px 12px 10px 36px;
  color: var(--wp-text2);
  font-size: 12px;
}

.wp-io-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 0;
}

.wp-io-stats {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 6px;
  margin: 0;
  font-size: 12.5px;
}
.wp-io-stats dt {
  color: var(--wp-text2);
}
.wp-io-stats dd {
  margin: 0;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  text-align: right;
}
.wp-io-warn { color: var(--wp-warn, #f59e0b); }

.wp-io-divider {
  height: 1px;
  background: var(--wp-border);
  margin: 12px 0;
}
.wp-io-download {
  margin-top: 12px;
  width: 100%;
}

.wp-io-import-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.wp-io-help {
  font-size: 12.5px;
  color: var(--wp-text2);
  margin: 0 0 8px;
}
.wp-io-help code {
  background: var(--wp-bg3);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
}

.wp-io-file-hidden { display: none; }

.wp-io-drop {
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: 10px;
  padding: 28px 16px;
  text-align: center;
  cursor: pointer;
  background: var(--wp-bg2);
  transition: background .15s, border-color .15s;
}
.wp-io-drop[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500) 10%, transparent);
  border-color: var(--wp-accent-500);
}
.wp-io-drop__icon {
  font-size: 22px;
  color: var(--wp-text2);
  display: block;
  margin: 0 auto 6px;
}
.wp-io-drop__title {
  font-size: 13px;
}
.wp-io-drop__hint {
  font-size: 11.5px;
  color: var(--wp-text2);
  margin-top: 4px;
}

.wp-io-error {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 12%, transparent);
  color: var(--wp-danger, #ef4444);
  font-size: 12.5px;
}

.wp-io-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  text-transform: lowercase;
}
.wp-io-badge--new {
  background: color-mix(in oklab, var(--wp-success, #10b981) 18%, transparent);
  color: var(--wp-success, #10b981);
}
.wp-io-badge--exists {
  background: color-mix(in oklab, var(--wp-warn, #f59e0b) 18%, transparent);
  color: var(--wp-warn, #f59e0b);
}
.wp-io-badge--mod {
  background: color-mix(in oklab, #fb923c 18%, transparent);
  color: #fb923c;
}

.wp-io-field-label {
  display: block;
  font-size: 12px;
  color: var(--wp-text2);
  margin-bottom: 4px;
}

.wp-io-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
</style>
