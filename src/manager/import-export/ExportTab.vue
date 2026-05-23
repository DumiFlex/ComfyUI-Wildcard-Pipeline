<script setup lang="ts">
/**
 * Export tab — v2 picker UI.
 *
 * Loads the live library on mount, shows one PickerSection per bucket
 * (7 buckets: bundles, wildcards, fixed_values, combines, derivations,
 * constraints, categories), tracks selection in seven independent
 * Sets, and POSTs the picked UUIDs to /wp/api/export/build. The
 * response payload is JSON-stringified and offered to the user as a
 * file download.
 *
 * Bucket naming is locked to the engine's 7-bucket schema — wildcards,
 * fixed_values, combines, derivations, constraints are five separate
 * module-type buckets, NOT a flat "variables" array. The request body
 * keys (`*_uuids`) match the Python endpoint exactly.
 */
import { computed, onMounted, ref } from "vue";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import { useToast } from "../composables/useToast";
import { api, ApiError, type ExportBuildRequest } from "../api/client";
import type { BundleRow, CategoryRow, ModuleRow, ModuleType } from "../api/types";
import PickerSection from "./PickerSection.vue";
import PickerRow from "./PickerRow.vue";
import { liveLibraryToRawPayload } from "./live-library-adapter";
import { buildDepGraph, transitiveClosure, constraintsBothSidesIn } from "./dep-graph";

const toast = useToast();

/**
 * Bucket key — matches the 7-bucket schema. `wildcard`, `fixed_values`,
 * `combine`, `derivation`, `constraint` are module subtypes (filtered
 * from `api.modules.list()` by `row.type`); `bundle` and `category`
 * come from their own endpoints.
 */
type BucketKey =
  | "bundle"
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint"
  | "category";

interface BucketMeta {
  key: BucketKey;
  title: string;
  /** Body key to send to /wp/api/export/build for this bucket. */
  requestKey: keyof ExportBuildRequest;
}

const BUCKETS: BucketMeta[] = [
  { key: "bundle",       title: "Bundles",       requestKey: "bundle_uuids" },
  { key: "wildcard",     title: "Wildcards",     requestKey: "wildcard_uuids" },
  { key: "fixed_values", title: "Fixed values",  requestKey: "fixed_values_uuids" },
  { key: "combine",      title: "Combines",      requestKey: "combine_uuids" },
  { key: "derivation",   title: "Derivations",   requestKey: "derivation_uuids" },
  { key: "constraint",   title: "Constraints",   requestKey: "constraint_uuids" },
  { key: "category",     title: "Categories",    requestKey: "category_uuids" },
];

/** Map ModuleType (from api.modules.list) → BucketKey. */
const MODULE_TYPE_TO_BUCKET: Record<ModuleType, BucketKey> = {
  wildcard:     "wildcard",
  fixed_values: "fixed_values",
  combine:      "combine",
  derivation:   "derivation",
  constraint:   "constraint",
};

// ---------- Library state ----------

const modules = ref<ModuleRow[]>([]);
const bundles = ref<BundleRow[]>([]);
const categories = ref<CategoryRow[]>([]);

const loading = ref<boolean>(false);
const exporting = ref<boolean>(false);

async function loadLibrary() {
  loading.value = true;
  try {
    // Single modules.list() call returns ALL types; client-side split
    // into 5 buckets via row.type. Five parallel filtered requests
    // would be 5 needless network roundtrips.
    const [mods, buns, cats] = await Promise.all([
      api.modules.list({ limit: 1000 }),
      api.bundles.list({ limit: 1000 }),
      api.categories.list(),
    ]);
    modules.value = mods.items;
    bundles.value = buns.items;
    categories.value = cats.items;
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Failed to load library",
      detail: err instanceof Error ? err.message : String(err),
      life: 4000,
    });
  } finally {
    loading.value = false;
  }
}

onMounted(loadLibrary);

// ---------- Selection state ----------

/**
 * Per-bucket selection. Keyed by BucketKey → Set<uuid>. One Record
 * keeps reactivity-tracked state in a single ref so the per-section
 * computed values can derive from it without seven separate watchers.
 */
const selection = ref<Record<BucketKey, Set<string>>>({
  bundle:       new Set(),
  wildcard:     new Set(),
  fixed_values: new Set(),
  combine:      new Set(),
  derivation:   new Set(),
  constraint:   new Set(),
  category:     new Set(),
});

function modulesForBucket(b: BucketKey): ModuleRow[] {
  if (b === "bundle" || b === "category") return [];
  return modules.value.filter((m) => MODULE_TYPE_TO_BUCKET[m.type] === b);
}

interface RowItem {
  id: string;
  name: string;
  /** Entity kind, for PickerRow's tinted glyph. For modules this is the
   *  module subtype; for bundles always `"bundle"`; for categories the
   *  row IS a category so we surface `"category"` for icon consistency
   *  even though we suppress the category chip on those rows. */
  kind: string;
  categoryName?: string;
  categoryColor?: string;
}

/**
 * Resolve a `category_id` against the loaded categories list and return
 * `{name, color}` (color may be undefined if the user never picked one).
 * Returns `undefined` when the id is null or unmatched — caller treats
 * that as "no category chip on this row".
 */
function lookupCategory(
  categoryId: string | null | undefined,
): { name: string; color?: string } | undefined {
  if (!categoryId) return undefined;
  const cat = categories.value.find((c) => c.id === categoryId);
  if (!cat) return undefined;
  return { name: cat.name, color: cat.color ?? undefined };
}

function rowsForBucket(b: BucketKey): RowItem[] {
  if (b === "bundle") {
    return bundles.value.map((x) => {
      const cat = lookupCategory(x.category_id);
      return {
        id: x.id,
        name: x.name,
        kind: "bundle",
        categoryName: cat?.name,
        categoryColor: cat?.color,
      };
    });
  }
  if (b === "category") {
    // Categories ARE the category — surface kind for the icon but skip
    // the category chip since it would duplicate the row name.
    return categories.value.map((x) => ({ id: x.id, name: x.name, kind: "category" }));
  }
  return modulesForBucket(b).map((x) => {
    const cat = lookupCategory(x.category_id);
    return {
      id: x.id,
      name: x.name,
      kind: x.type,
      categoryName: cat?.name,
      categoryColor: cat?.color,
    };
  });
}

function bucketTotalCount(b: BucketKey): number {
  return rowsForBucket(b).length;
}

function bucketSelectedCount(b: BucketKey): number {
  return selection.value[b].size;
}

function isRowSelected(b: BucketKey, id: string): boolean {
  return selection.value[b].has(id);
}

function toggleRow(b: BucketKey, id: string, on: boolean) {
  const next = new Set(selection.value[b]);
  if (on) next.add(id); else next.delete(id);
  selection.value = { ...selection.value, [b]: next };
}

function toggleAllInBucket(b: BucketKey, on: boolean) {
  const next = new Set<string>();
  if (on) {
    for (const r of rowsForBucket(b)) next.add(r.id);
  }
  selection.value = { ...selection.value, [b]: next };
}

const totalSelected = computed<number>(() => {
  let n = 0;
  for (const b of BUCKETS) n += selection.value[b.key].size;
  return n;
});

// ---------- Select with dependencies ----------

/**
 * Apply a closure of entity ids back into per-bucket selection.
 * Walks each bucket's rows and adds matching ids; ids not present in
 * any bucket are silently dropped (defensive — stale ids from a
 * future closure shouldn't crash).
 */
function applyClosureToSelection(closure: Set<string>): void {
  const next: Record<BucketKey, Set<string>> = {
    bundle:       new Set(selection.value.bundle),
    wildcard:     new Set(selection.value.wildcard),
    fixed_values: new Set(selection.value.fixed_values),
    combine:      new Set(selection.value.combine),
    derivation:   new Set(selection.value.derivation),
    constraint:   new Set(selection.value.constraint),
    category:     new Set(selection.value.category),
  };
  for (const b of BUCKETS) {
    const ids = new Set(rowsForBucket(b.key).map((r) => r.id));
    for (const id of closure) if (ids.has(id)) next[b.key].add(id);
  }
  selection.value = next;
}

/**
 * Expand selection to include all transitively-referenced entities
 * plus any constraints whose source AND target are both selected.
 * Disabled when nothing is selected (no seed to walk from).
 */
function selectWithDependencies(): void {
  if (totalSelected.value === 0) return;
  const payload = liveLibraryToRawPayload(modules.value, bundles.value, categories.value);
  const graph = buildDepGraph(payload);
  const seed = new Set<string>();
  for (const b of BUCKETS) for (const id of selection.value[b.key]) seed.add(id);
  const closure = transitiveClosure(graph, seed);
  for (const cid of constraintsBothSidesIn(payload, closure)) closure.add(cid);
  applyClosureToSelection(closure);
}

// ---------- Export ----------

function buildRequest(): ExportBuildRequest {
  return {
    bundle_uuids:       [...selection.value.bundle],
    wildcard_uuids:     [...selection.value.wildcard],
    fixed_values_uuids: [...selection.value.fixed_values],
    combine_uuids:      [...selection.value.combine],
    derivation_uuids:   [...selection.value.derivation],
    constraint_uuids:   [...selection.value.constraint],
    category_uuids:     [...selection.value.category],
  };
}

/**
 * Trigger a browser file download of `payload` as JSON. Standard
 * blob → object-URL → synthetic anchor click → revoke pattern; mirrors
 * the legacy `downloadBundle` in ImportExport.vue (lines 213-242).
 */
function downloadPayload(payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    const d = new Date();
    const stamp =
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}` +
      `-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
    a.download = `wildcard-pipeline-export-${stamp}.json`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runExport() {
  if (totalSelected.value === 0) return;
  exporting.value = true;
  try {
    const payload = await api.importExport.build(buildRequest());
    downloadPayload(payload);
    toast.push({
      severity: "success",
      summary: "Export ready",
      detail: `${totalSelected.value} items packaged`,
      life: 3000,
    });
  } catch (err) {
    const detail = err instanceof ApiError
      ? `${err.message} (HTTP ${err.status})`
      : err instanceof Error
        ? err.message
        : String(err);
    toast.push({
      severity: "error",
      summary: "Export failed",
      detail,
      life: 5000,
    });
  } finally {
    exporting.value = false;
  }
}

function clearAll() {
  selection.value = {
    bundle:       new Set(),
    wildcard:     new Set(),
    fixed_values: new Set(),
    combine:      new Set(),
    derivation:   new Set(),
    constraint:   new Set(),
    category:     new Set(),
  };
}

// ---------- Quick filter presets ----------

/**
 * Select every entity across all 7 buckets. Equivalent to clicking the
 * select-all checkbox in each section, but in one click. Does NOT walk
 * the dep graph — the user already has everything, so closure is a
 * no-op.
 */
function presetFullLibrary(): void {
  selection.value = {
    bundle:       new Set(bundles.value.map((b) => b.id)),
    wildcard:     new Set(modulesForBucket("wildcard").map((m) => m.id)),
    fixed_values: new Set(modulesForBucket("fixed_values").map((m) => m.id)),
    combine:      new Set(modulesForBucket("combine").map((m) => m.id)),
    derivation:   new Set(modulesForBucket("derivation").map((m) => m.id)),
    constraint:   new Set(modulesForBucket("constraint").map((m) => m.id)),
    category:     new Set(categories.value.map((c) => c.id)),
  };
}

/**
 * Clear everything and select only wildcard modules. Common quick path
 * when the user wants to share just their prompt vocabulary without
 * combines/derivations/constraints attached.
 */
function presetWildcardsOnly(): void {
  selection.value = {
    bundle:       new Set(),
    wildcard:     new Set(modulesForBucket("wildcard").map((m) => m.id)),
    fixed_values: new Set(),
    combine:      new Set(),
    derivation:   new Set(),
    constraint:   new Set(),
    category:     new Set(),
  };
}

/**
 * Clear everything then select all entities flagged `is_favorite`. Only
 * modules and bundles carry the favorite bit — categories don't, so
 * that bucket stays empty regardless.
 */
function presetFavoritesOnly(): void {
  const favModules = modules.value.filter((m) => m.is_favorite);
  const favBundles = bundles.value.filter((b) => b.is_favorite);
  selection.value = {
    bundle:       new Set(favBundles.map((b) => b.id)),
    wildcard:     new Set(favModules.filter((m) => m.type === "wildcard").map((m) => m.id)),
    fixed_values: new Set(favModules.filter((m) => m.type === "fixed_values").map((m) => m.id)),
    combine:      new Set(favModules.filter((m) => m.type === "combine").map((m) => m.id)),
    derivation:   new Set(favModules.filter((m) => m.type === "derivation").map((m) => m.id)),
    constraint:   new Set(favModules.filter((m) => m.type === "constraint").map((m) => m.id)),
    category:     new Set(),
  };
}
</script>

<template>
  <div class="wp-export-tab" data-test="export-tab-v2">
    <Card title="Pick what to export" :padding="false">
      <template #actions>
        <Button
          variant="ghost"
          size="sm"
          data-test="export-tab-clear"
          :disabled="totalSelected === 0"
          @click="clearAll"
        >Clear all</Button>
        <Button
          variant="ghost"
          size="sm"
          icon="pi-share-alt"
          data-test="export-select-deps"
          :disabled="totalSelected === 0"
          @click="selectWithDependencies"
        >Select with dependencies</Button>
      </template>

      <div
        class="wp-export-tab__presets"
        role="group"
        aria-label="Quick selection presets"
      >
        <span class="wp-export-tab__presets-label">Quick select:</span>
        <button
          class="wp-export-tab__preset"
          data-test="preset-full"
          type="button"
          @click="presetFullLibrary"
        >Full library</button>
        <button
          class="wp-export-tab__preset"
          data-test="preset-wildcards"
          type="button"
          @click="presetWildcardsOnly"
        >Wildcards only</button>
        <button
          class="wp-export-tab__preset"
          data-test="preset-favorites"
          type="button"
          @click="presetFavoritesOnly"
        >Favorites only</button>
      </div>

      <div class="wp-export-tab__sections">
        <PickerSection
          v-for="bucket in BUCKETS"
          :key="bucket.key"
          :title="bucket.title"
          :total-count="bucketTotalCount(bucket.key)"
          :selected-count="bucketSelectedCount(bucket.key)"
          :default-open="false"
          :data-test="`export-tab-section-${bucket.key}`"
          @toggle-all="(v: boolean) => toggleAllInBucket(bucket.key, v)"
        >
          <PickerRow
            v-for="row in rowsForBucket(bucket.key)"
            :key="`${bucket.key}:${row.id}`"
            :uuid="row.id"
            :name="row.name"
            :kind="row.kind"
            :category-name="row.categoryName"
            :category-color="row.categoryColor"
            :show-id="true"
            :checked="isRowSelected(bucket.key, row.id)"
            :status-badges="[]"
            :unselected-deps="[]"
            :missing-deps="[]"
            :data-test="`export-tab-row-${bucket.key}-${row.id}`"
            @update:checked="(v: boolean) => toggleRow(bucket.key, row.id, v)"
          />
          <div
            v-if="bucketTotalCount(bucket.key) === 0"
            class="wp-export-tab__empty"
          >
            <em>No {{ bucket.title.toLowerCase() }} in library.</em>
          </div>
        </PickerSection>
      </div>
    </Card>

    <div class="wp-export-tab__side">
      <Card title="Summary">
        <dl class="wp-export-tab__stats" data-test="export-tab-summary">
          <dt>Bundles</dt><dd>{{ bucketSelectedCount("bundle") }}</dd>
          <dt>Wildcards</dt><dd>{{ bucketSelectedCount("wildcard") }}</dd>
          <dt>Fixed values</dt><dd>{{ bucketSelectedCount("fixed_values") }}</dd>
          <dt>Combines</dt><dd>{{ bucketSelectedCount("combine") }}</dd>
          <dt>Derivations</dt><dd>{{ bucketSelectedCount("derivation") }}</dd>
          <dt>Constraints</dt><dd>{{ bucketSelectedCount("constraint") }}</dd>
          <dt>Categories</dt><dd>{{ bucketSelectedCount("category") }}</dd>
        </dl>
        <div class="wp-export-tab__divider" />
        <dl class="wp-export-tab__stats">
          <dt>Total selected</dt><dd>{{ totalSelected }}</dd>
        </dl>
        <Button
          variant="primary"
          icon="pi-download"
          class="wp-export-tab__submit"
          :disabled="totalSelected === 0 || exporting"
          :loading="exporting"
          data-test="export-tab-submit"
          @click="runExport"
        >Export {{ totalSelected }} selected</Button>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.wp-export-tab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--wp-space-6);
  align-items: start;
}
@media (max-width: 960px) {
  .wp-export-tab { grid-template-columns: 1fr; }
}
.wp-export-tab__presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-4) var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
}
.wp-export-tab__presets-label {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  margin-right: var(--wp-space-2);
}
.wp-export-tab__preset {
  font-size: var(--wp-text-sm);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  color: var(--wp-text);
  cursor: pointer;
  font-family: var(--wp-font-sans);
  line-height: 1.4;
}
.wp-export-tab__preset:hover {
  background: var(--wp-bg-3);
  border-color: var(--wp-border-strong);
}
.wp-export-tab__preset:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}
.wp-export-tab__sections {
  padding: var(--wp-space-5);
  max-height: 540px;
  overflow-y: auto;
}
.wp-export-tab__empty {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  padding: var(--wp-space-3) var(--wp-space-5);
}
.wp-export-tab__side {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  position: sticky;
  top: 0;
}
.wp-export-tab__stats {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: var(--wp-space-3);
  margin: 0;
  font-size: var(--wp-text-sm);
}
.wp-export-tab__stats dt { color: var(--wp-text-muted); }
.wp-export-tab__stats dd {
  margin: 0;
  font-family: var(--wp-font-mono);
  text-align: right;
}
.wp-export-tab__divider {
  border-top: 1px solid var(--wp-border);
  margin: var(--wp-space-5) 0;
}
.wp-export-tab__submit {
  width: 100%;
  margin-top: var(--wp-space-5);
}
</style>
