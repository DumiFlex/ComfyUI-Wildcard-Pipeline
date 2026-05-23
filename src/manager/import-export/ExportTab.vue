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
import { useToast } from "../composables/useToast";
import { api, ApiError, type ExportBuildRequest } from "../api/client";
import type { BundleRow, CategoryRow, ModuleRow, ModuleType } from "../api/types";
import PickerSection from "./PickerSection.vue";
import PickerRow from "./PickerRow.vue";
import type { DepRef } from "./PickerRow.vue";
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
  /** Surface the favorite-star indicator. Modules + bundles carry it;
   *  categories don't (always false). */
  isFavorite: boolean;
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
        isFavorite: x.is_favorite,
      };
    });
  }
  if (b === "category") {
    // Categories ARE the category — surface kind for the icon but skip
    // the category chip since it would duplicate the row name. Categories
    // don't carry favorites.
    return categories.value.map((x) => ({
      id: x.id, name: x.name, kind: "category", isFavorite: false,
    }));
  }
  return modulesForBucket(b).map((x) => {
    const cat = lookupCategory(x.category_id);
    return {
      id: x.id,
      name: x.name,
      kind: x.type,
      categoryName: cat?.name,
      categoryColor: cat?.color,
      isFavorite: x.is_favorite,
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

/**
 * Total row count across every bucket — the denominator in the footer
 * counter ("N of M selected"). Re-derived on library snapshot changes
 * via the existing reactive refs.
 */
const totalRowsCount = computed<number>(() => {
  let n = 0;
  for (const b of BUCKETS) n += bucketTotalCount(b.key);
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

// ---------- Dep graph + unselected deps ----------
//
// Compute the live library's dep graph ONCE per library snapshot so the
// per-row chip lookup is O(edges) per row instead of rebuilding on every
// selection mutation. Selection changes only flip set membership — they
// don't change the graph structure — so `depGraph` only rebuilds when
// modules/bundles/categories themselves change.

const depGraph = computed(() => {
  const payload = liveLibraryToRawPayload(
    modules.value,
    bundles.value,
    categories.value,
  );
  return buildDepGraph(payload);
});

/**
 * Flat `id → {name, type}` lookup across every loaded entity. Used by
 * `unselectedDepsForId` to surface human-readable name + kind in the
 * expanded dep list. Modules contribute their `type` subtype; bundles +
 * categories supply the bucket kind so the dep list's mini type-icon
 * picks up the right tint.
 */
const libraryRowById = computed<Map<string, { name: string; type: string }>>(() => {
  const m = new Map<string, { name: string; type: string }>();
  for (const mod of modules.value) {
    m.set(mod.id, { name: mod.name, type: mod.type });
  }
  for (const b of bundles.value) {
    m.set(b.id, { name: b.name, type: "bundle" });
  }
  for (const c of categories.value) {
    m.set(c.id, { name: c.name, type: "category" });
  }
  return m;
});

/**
 * Union of every selection set across all 7 buckets. Recomputed on any
 * selection mutation. Used by `unselectedDepsForId` for membership
 * checks — once per chip lookup rather than re-iterating 7 Sets per
 * outgoing edge.
 */
const allSelectedIds = computed<Set<string>>(() => {
  const s = new Set<string>();
  for (const b of BUCKETS) {
    for (const id of selection.value[b.key]) s.add(id);
  }
  return s;
});

/**
 * Outgoing refs from `id` that aren't currently selected. Only surfaced
 * on SELECTED rows — an unchecked row hasn't been picked for export, so
 * its missing-deps would be advisory noise.
 *
 * Targets present in `libraryRowById` resolve through the live library
 * adapter (the user can opt them in via "Select with dependencies");
 * targets absent from BOTH selection AND library are skipped — they
 * can't happen in normal flow since the live library is the source of
 * the dep edges. Defensive skip avoids surfacing a stale-data warning
 * that the user can't act on from the export side.
 */
/**
 * Resolve which of the 7 buckets contains `id` and toggle that row on.
 * Walks `rowsForBucket` for each bucket — O(rows) per click, only fires
 * from the rare `+ select` interaction in the unselected-deps expander
 * so the linear walk is fine. Returns silently if the id isn't found in
 * any bucket (defensive against stale dep refs).
 */
function onSelectDep(id: string): void {
  for (const b of BUCKETS) {
    const rows = rowsForBucket(b.key);
    if (rows.some((r) => r.id === id)) {
      toggleRow(b.key, id, true);
      return;
    }
  }
}

function unselectedDepsForId(id: string): DepRef[] {
  if (!allSelectedIds.value.has(id)) return [];
  const edges = depGraph.value[id] ?? [];
  const out: DepRef[] = [];
  for (const target of edges) {
    if (allSelectedIds.value.has(target)) continue;
    const row = libraryRowById.value.get(target);
    if (!row) continue; // target outside the live library — skip
    out.push({ id: target, name: row.name, type: row.type });
  }
  return out;
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
  // Warn before export when any selected row has unselected deps inside
  // the library. Bypass via `window.confirm` so the user can still ship
  // an intentionally-pruned bundle (e.g. wildcards-only).
  let depWarnCount = 0;
  for (const b of BUCKETS) {
    for (const id of selection.value[b.key]) {
      if (unselectedDepsForId(id).length > 0) depWarnCount += 1;
    }
  }
  if (depWarnCount > 0) {
    const proceed = window.confirm(
      `${depWarnCount} selected ${depWarnCount === 1 ? "item has" : "items have"} unresolved dependencies. Export anyway?`,
    );
    if (!proceed) return;
  }
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
    <div
      class="wp-export-presets"
      role="group"
      aria-label="Quick selection presets"
    >
      <span class="wp-export-presets__label">Quick select</span>
      <button
        class="wp-preset-btn"
        data-test="preset-full"
        type="button"
        @click="presetFullLibrary"
      ><i class="pi pi-database" /> Full library</button>
      <button
        class="wp-preset-btn"
        data-test="preset-wildcards"
        type="button"
        @click="presetWildcardsOnly"
      ><i class="pi pi-sparkles" /> Wildcards only</button>
      <button
        class="wp-preset-btn"
        data-test="preset-favorites"
        type="button"
        @click="presetFavoritesOnly"
      ><i class="pi pi-star-fill" /> Favorites only</button>
    </div>

    <div class="wp-export-tab__sections">
      <PickerSection
        v-for="bucket in BUCKETS"
        :key="bucket.key"
        :title="bucket.title"
        :total-count="bucketTotalCount(bucket.key)"
        :selected-count="bucketSelectedCount(bucket.key)"
        :default-open="false"
        :kind="bucket.key"
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
          :unselected-deps="unselectedDepsForId(row.id)"
          :missing-deps="[]"
          :is-favorite="row.isFavorite"
          :data-test="`export-tab-row-${bucket.key}-${row.id}`"
          @update:checked="(v: boolean) => toggleRow(bucket.key, row.id, v)"
          @select-dep="(id: string) => onSelectDep(id)"
        />
        <div
          v-if="bucketTotalCount(bucket.key) === 0"
          class="wp-export-tab__empty"
        >
          <em>No {{ bucket.title.toLowerCase() }} in library.</em>
        </div>
      </PickerSection>
    </div>

    <div class="wp-picker-footer" data-test="export-tab-footer">
      <Button
        variant="secondary"
        size="sm"
        icon="pi-sitemap"
        data-test="export-select-deps"
        :disabled="totalSelected === 0"
        @click="selectWithDependencies"
      >Select with dependencies</Button>
      <Button
        variant="ghost"
        size="sm"
        data-test="export-tab-clear"
        :disabled="totalSelected === 0"
        @click="clearAll"
      >Deselect all</Button>
      <div class="wp-picker-footer__spacer" />
      <span
        class="wp-picker-footer__counter"
        data-test="export-tab-counter"
      ><strong>{{ totalSelected }}</strong> of {{ totalRowsCount }} selected</span>
      <Button
        variant="primary"
        icon="pi-download"
        :disabled="totalSelected === 0 || exporting"
        :loading="exporting"
        data-test="export-tab-submit"
        @click="runExport"
      >Export</Button>
    </div>
  </div>
</template>

<style scoped>
/* ExportTab — verbatim port from
 * docs/superpowers/ui-prototypes/import-export-redesign.html
 * lines 95-108 (presets) + 226-244 (footer). */

.wp-export-tab {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.wp-export-presets {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  margin-bottom: 10px;
}
.wp-export-presets__label {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
  letter-spacing: 0.06em;
  margin-right: 6px;
  text-transform: uppercase;
  font-weight: 600;
}
.wp-preset-btn {
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  font-family: var(--wp-font);
  font-size: var(--wp-text-sm);
  padding: 4px 11px;
  border-radius: var(--wp-radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.wp-preset-btn:hover {
  background: var(--wp-bg-4);
  border-color: var(--wp-border-strong);
}
.wp-preset-btn .pi {
  font-size: 10px;
  color: var(--wp-text-muted);
}
.wp-preset-btn:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}

.wp-export-tab__sections {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wp-export-tab__empty {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  padding: var(--wp-space-3) var(--wp-space-5);
}

.wp-picker-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  margin-top: 10px;
}
.wp-picker-footer__spacer {
  flex: 1;
}
.wp-picker-footer__counter {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  font-feature-settings: "tnum";
}
.wp-picker-footer__counter strong {
  color: var(--wp-text);
  font-weight: 600;
}
</style>
