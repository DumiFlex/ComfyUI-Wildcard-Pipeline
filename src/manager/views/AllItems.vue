<script setup lang="ts">
/**
 * Unified library view — every module across every kind PLUS every
 * bundle, in one filterable list. Reachable via the Dashboard's
 * "View all →" link on the Recent / Favorites card.
 *
 * ModuleListView is generic over `T extends { id; name?; ... }` so we
 * feed it a synthesized union row (`LibraryRow`) that carries a
 * `kind` discriminator + a `source` pointer back to the original
 * ModuleRow / BundleRow. The list view handles search, category,
 * favorites, tags, sort, pagination, and bulk-select for free; we
 * provide a kind multi-select on top (OR semantics across the 6
 * kinds — modules + bundle) via the `filter-panel` slot, and
 * dispatch the per-kind edit route in the row click handler.
 *
 * Why not extraFilters for the kind selector? ModuleListView's extra
 * filter slot uses AND semantics across active checks (line ~141 of
 * the component), which forces multi-kind selections to filter to
 * the empty set (rows have exactly one kind). Pre-filtering the
 * items array before handing it to ModuleListView gives us the OR
 * we actually want.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useListUrlState } from "../composables/useListUrlState";
import { useLoadError } from "../composables/useLoadError";
import { useBulkActions } from "../composables/useBulkActions";
import { makeMixedKindAdapter, type AnyRow } from "../composables/bulkAdapters";
import ModuleListView from "../components/ModuleListView.vue";
import ValidityIcon from "../components/ValidityIcon.vue";
import { validateBundle, validateModule, type ValidationIssue } from "../utils/validateModule";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useToast } from "../composables/useToast";
import { api } from "../api/client";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import type { BundleRow, CategoryRow, ModuleRow, ModuleType } from "../api/types";

const route = useRoute();
const router = useRouter();
const toast = useToast();
const categoryStore = useCategoryStore();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const loadErr = useLoadError();

const bulkAdapter = makeMixedKindAdapter({ moduleStore, bundleStore });
const bulkActions = useBulkActions(bulkAdapter);

const urlState = useListUrlState<{ kinds: string[] }>(
  { kinds: { type: "csv", default: [] } },
  "all",
);

type LibraryKind = ModuleType | "bundle";

interface KindMeta {
  key: LibraryKind;
  label: string;
  icon: string;
  color: string;
  slug: string;
}

const KIND_META: KindMeta[] = [
  { key: "wildcard",     label: "Wildcards",    icon: "pi pi-sparkles",                color: "var(--wp-kind-wildcard)",   slug: "wildcards" },
  { key: "fixed_values", label: "Fixed Values", icon: "pi pi-tag",                     color: "var(--wp-kind-fixed)",      slug: "fixed-values" },
  { key: "combine",      label: "Combines",     icon: "pi pi-link",                    color: "var(--wp-kind-combine)",    slug: "combines" },
  { key: "derivation",   label: "Derivations",  icon: "pi pi-arrow-right-arrow-left",  color: "var(--wp-kind-derivation)", slug: "derivations" },
  { key: "constraint",   label: "Constraints",  icon: "pi pi-filter",                  color: "var(--wp-kind-constraint)", slug: "constraints" },
  { key: "bundle",       label: "Bundles",      icon: "pi pi-box",                     color: "var(--wp-bundle-default, #6366f1)", slug: "bundles" },
];

const KIND_BY_KEY: Record<LibraryKind, KindMeta> = KIND_META.reduce((acc, k) => {
  acc[k.key] = k;
  return acc;
}, {} as Record<LibraryKind, KindMeta>);

/** Synthesised row — matches ModuleListView's `T extends { id; ... }`
 *  contract. `source` keeps a pointer to the original row for the
 *  expansion drawer + delete path. */
interface LibraryRow {
  id: string;
  name: string;
  kind: LibraryKind;
  category_id: string | null;
  is_favorite: boolean;
  tags: string[];
  updated_at: string;
  description: string;
  source: ModuleRow | BundleRow;
}

const localModules = ref<ModuleRow[]>([]);
const localBundles = ref<BundleRow[]>([]);
// Start `true` so the filter panel can render a stable "Loading…"
// placeholder for the tag section BEFORE the first fetch resolves.
// If we start `false`, the panel briefly renders with an empty tag
// list (the "No tags" branch) and then jumps to a chip row when the
// fetch lands — which reads as two staggered expand animations
// because the filter-collapse Transition interpolates max-height.
const loading = ref(true);
const hasLoaded = ref(false);

/** Filter proxy pointing at urlState — ModuleListView (and its slots)
 *  mutate through this; changes propagate to URL automatically. */
const filter = urlState as {
  q?: string;
  favorites?: boolean;
  category?: string | null;
  tags?: string[];
  sortBy?: string;
};

// Kind multi-select backed by urlState.kinds (csv array).
const selectedKinds = computed<Set<LibraryKind>>({
  get: () => new Set(urlState.kinds as LibraryKind[]),
  set: (next: Set<LibraryKind>) => { urlState.kinds = [...next]; },
});

const categoryById = computed(() => {
  const m = new Map<string, CategoryRow>();
  for (const c of categoryStore.items) m.set(c.id, c);
  return m;
});

const categoryOptions = computed(() => [
  { value: null, label: "All categories" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

/** Bulk-set-category modal options — uses "(none)" for the null choice
 *  since the user is explicitly setting category (not filtering). */
const bulkCategoryOptions = computed(() => [
  { value: null, label: "(none)" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

const allTags = computed(() => {
  const set = new Set<string>();
  for (const r of items.value) for (const t of r.tags ?? []) set.add(t);
  return Array.from(set).sort();
});

function moduleToRow(m: ModuleRow): LibraryRow {
  return {
    id: m.id,
    name: m.name,
    kind: m.type,
    category_id: m.category_id,
    is_favorite: !!m.is_favorite,
    tags: m.tags ?? [],
    updated_at: m.updated_at ?? "",
    description: m.description ?? "",
    source: m,
  };
}

function bundleToRow(b: BundleRow): LibraryRow {
  return {
    id: b.id,
    name: b.name,
    kind: "bundle",
    category_id: b.category_id,
    is_favorite: !!b.is_favorite,
    tags: b.tags ?? [],
    updated_at: b.updated_at ?? "",
    description: b.description ?? "",
    source: b,
  };
}

/** All rows — modules + bundles merged. Filter out any module whose
 *  `type` no longer matches a known kind (e.g. legacy `pipeline` rows
 *  left behind in databases that pre-date the bundle cleanup). They'd
 *  blow up the `KIND_BY_KEY[row.kind]` lookup downstream and there's
 *  no editor to send the user to anyway. */
const items = computed<LibraryRow[]>(() => [
  ...localModules.value
    .filter((m) => KIND_BY_KEY[m.type as LibraryKind] !== undefined)
    .map(moduleToRow),
  ...localBundles.value.map(bundleToRow),
]);

/** Items after kind + category + favorites pre-filter. ModuleListView
 *  applies its own search / tags / sort / pagination on top of what
 *  we hand it, so we only need to do the slices that aren't part of
 *  its standard Filter shape — namely the kind selector and the
 *  category dropdown (since neither category nor favorites pass
 *  through automatically when items come from outside its expected
 *  server-fetch flow). */
const visibleItems = computed<LibraryRow[]>(() => {
  let out = items.value;
  if (selectedKinds.value.size > 0) {
    const wanted = selectedKinds.value;
    out = out.filter((r) => wanted.has(r.kind));
  }
  if (filter.category) {
    out = out.filter((r) => r.category_id === filter.category);
  }
  if (filter.favorites) {
    out = out.filter((r) => r.is_favorite);
  }
  if (filter.q && filter.q.trim()) {
    const q = filter.q.trim().toLowerCase();
    out = out.filter((r) =>
      r.name.toLowerCase().includes(q)
      || r.id.toLowerCase().includes(q)
      || (r.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
  }
  return out;
});

async function fetchAll() {
  loading.value = true;
  try {
    await loadErr.run(async () => {
      const [modRes, bunRes] = await Promise.all([
        api.modules.list({ limit: 1000 }),
        api.bundles.list({ limit: 1000 }),
      ]);
      localModules.value = modRes.items;
      localBundles.value = bunRes.items;
    });
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

onMounted(async () => {
  await Promise.all([fetchAll(), categoryStore.fetchAll()]);
});

function issuesFor(row: LibraryRow): ValidationIssue[] {
  if (row.kind === "bundle") {
    return validateBundle(row.source as BundleRow, moduleStore.catalog, bundleStore.items);
  }
  return validateModule(row.source as ModuleRow, moduleStore.catalog);
}

function editRow(row: LibraryRow) {
  const returnTo = encodeURIComponent(route.fullPath);
  if (row.kind === "bundle") {
    router.push({ name: "bundles-edit", params: { id: row.id }, query: { returnTo } });
    return;
  }
  const meta = KIND_BY_KEY[row.kind];
  if (!meta) return;
  router.push({ path: `/${meta.slug}/${row.id}/edit`, query: { returnTo } });
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.push({ severity: "info", summary: "ID copied", detail: id, life: 1500 });
  } catch {
    toast.push({ severity: "error", summary: "Copy failed", life: 2000 });
  }
}

async function fav(row: LibraryRow) {
  try {
    // Server toggles the flag itself — no boolean argument needed.
    if (row.kind === "bundle") {
      await api.bundles.favorite(row.id);
    } else {
      await api.modules.favorite(row.id);
    }
    await fetchAll();
  } catch (e) {
    toast.push({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 });
  }
}

async function del(row: LibraryRow) {
  try {
    if (row.kind === "bundle") {
      await api.bundles.delete(row.id);
    } else {
      await api.modules.delete(row.id);
    }
    toast.push({ severity: "success", summary: "Deleted", detail: row.name, life: 2000 });
    await fetchAll();
  } catch (e) {
    toast.push({ severity: "error", summary: "Delete failed", detail: String(e), life: 4000 });
  }
}

/** Unwrap the synthesized LibraryRow into the underlying source row
 *  expected by the mixed-kind adapter. The adapter discriminates on
 *  `children` (bundles) vs absence (modules), so we just hand it the
 *  original ModuleRow / BundleRow. */
function unwrap(rows: LibraryRow[]): AnyRow[] {
  return rows.map((r) => r.source);
}

/** Bulk handlers refetch after running so the synthesized view reflects
 *  server-side state — moduleStore/bundleStore mutations don't flow
 *  through this view's `localModules` / `localBundles` refs. */
async function onBulkFavorite(rows: LibraryRow[], on: boolean) {
  await bulkActions.onBulkFavorite(unwrap(rows), on);
  await fetchAll();
}
async function onBulkDuplicate(rows: LibraryRow[]) {
  await bulkActions.onBulkDuplicate(unwrap(rows));
  await fetchAll();
}
async function onBulkTagAdd(rows: LibraryRow[], tag: string) {
  await bulkActions.onBulkTagAdd(unwrap(rows), tag);
  await fetchAll();
}
async function onBulkTagRemove(rows: LibraryRow[], tag: string) {
  await bulkActions.onBulkTagRemove(unwrap(rows), tag);
  await fetchAll();
}
async function onBulkSetCategory(rows: LibraryRow[], categoryId: string | null) {
  await bulkActions.onBulkSetCategory(unwrap(rows), categoryId);
  await fetchAll();
}
async function onBulkDelete(rows: LibraryRow[]) {
  await bulkActions.onBulkDelete(unwrap(rows));
  await fetchAll();
}

function toggleKind(k: LibraryKind) {
  const next = new Set(selectedKinds.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  selectedKinds.value = next;
}

function toggleTag(t: string, current: string[] | undefined): string[] {
  const cur = current ?? [];
  return cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
}

// no-op `emitFetch` — items are already client-side; nothing to
// refetch when filters change.
function refresh() {
  void fetchAll();
}
</script>

<template>
  <ModuleListView
    title="All items"
    subtitle="Every module across every kind plus every bundle. Filter by kind, category, favorites, tags — or jump straight to any item with the search box."
    new-label="New module"
    new-route="/wildcards/new"
    :items="visibleItems"
    :loading="loading"
    :load-error="loadErr.error.value"
    :filter="filter"
    :mid-cols="3"
    empty-message="Library is empty"
    :page="urlState.page"
    :page-size="urlState.pageSize"
    :available-tags="allTags"
    :category-options="bulkCategoryOptions"
    @update:page="(v) => urlState.page = v"
    @update:page-size="(v) => urlState.pageSize = v"
    @fetch="refresh"
    @clear="urlState.kinds = []"
    @delete="del"
    @bulk-favorite="onBulkFavorite"
    @bulk-duplicate="onBulkDuplicate"
    @bulk-tag-add="onBulkTagAdd"
    @bulk-tag-remove="onBulkTagRemove"
    @bulk-set-category="onBulkSetCategory"
    @bulk-delete="onBulkDelete"
    @row-open="editRow"
    @row-favorite-toggle="fav"
  >
    <template #empty>
      <EmptyState
        icon="pi-objects-column"
        headline="Library is empty"
        body="Create a module from any kind to populate your library."
        variant="library"
      >
        <template #cta>
          <Button variant="primary" icon="pi-plus" @click="$router.push('/wildcards/new')">
            New wildcard
          </Button>
        </template>
      </EmptyState>
    </template>

    <template #filter-panel="{ filter: f, emitFetch }">
      <div class="wp-filters-grid">
        <div class="wp-field wp-field--full">
          <label class="wp-field__label">
            Kinds{{ selectedKinds.size ? ` (${selectedKinds.size})` : "" }}
          </label>
          <div class="wp-kind-row">
            <button
              v-for="k in KIND_META" :key="k.key"
              type="button"
              class="wp-kind-chip"
              :data-active="selectedKinds.has(k.key) ? 'true' : 'false'"
              :style="selectedKinds.has(k.key) ? {
                borderColor: k.color,
                background: `color-mix(in oklab, ${k.color} 18%, transparent)`,
                color: k.color,
              } : undefined"
              @click="toggleKind(k.key)"
            >
              <i :class="k.icon" aria-hidden="true" />
              {{ k.label }}
            </button>
          </div>
        </div>
        <div class="wp-field">
          <label class="wp-field__label">Category</label>
          <Select
            :model-value="f.category ?? null"
            :options="categoryOptions"
            placeholder="Any category"
            aria-label="Filter by category"
            @update:model-value="(v) => { f.category = v as string | null; emitFetch(); }"
          />
        </div>
        <div class="wp-field">
          <label class="wp-field__label">Favorites</label>
          <button
            type="button"
            class="wp-input"
            style="display:flex;align-items:center;gap:8px;justify-content:flex-start;"
            @click="f.favorites = !f.favorites; emitFetch()"
          >
            <span class="wp-check" :data-checked="f.favorites ? 'true' : 'false'" aria-hidden="true">
              <svg v-if="f.favorites" viewBox="0 0 12 12" fill="none" style="display:block">
                <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>Favorites only</span>
          </button>
        </div>
        <div class="wp-field wp-field--full">
          <label class="wp-field__label">
            Tags{{ f.tags?.length ? ` (${f.tags.length})` : "" }}
          </label>
          <!-- Reserved-height wrapper: keeps the panel's natural
               height stable across the loading → loaded transition so
               the outer filter-collapse Transition can't catch a
               mid-animation reflow. min-height matches roughly one
               wrapped row of chips. -->
          <div class="wp-tags-slot">
            <div v-if="!hasLoaded" class="wp-dim wp-tags-empty">Loading tags…</div>
            <div v-else-if="!allTags.length" class="wp-dim wp-tags-empty">No tags in this collection.</div>
            <div v-else class="wp-tags-row">
              <button
                v-for="t in allTags" :key="t"
                type="button"
                class="wp-tag-chip"
                :data-active="(f.tags ?? []).includes(t) ? 'true' : 'false'"
                @click="f.tags = toggleTag(t, f.tags); emitFetch()"
              >
                {{ t }}
              </button>
            </div>
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
        <span class="wp-row-name__text" @click="editRow(row)">{{ row.name }}</span>
        <span
          class="wp-id"
          :title="`Click to copy ${row.id}`"
          @click.stop="copyId(row.id)"
        >{{ row.id }}</span>
      </div>
    </template>

    <template #columns-head>
      <th style="width: 110px">Kind</th>
      <th style="width: 130px">Category</th>
      <th style="width: 80px">Valid</th>
    </template>

    <template #columns="{ row }">
      <td>
        <span
          v-if="KIND_BY_KEY[row.kind]"
          class="wp-kind-cell"
          :style="{
            color: KIND_BY_KEY[row.kind].color,
            background: `color-mix(in oklab, ${KIND_BY_KEY[row.kind].color} 14%, transparent)`,
          }"
        >
          <i :class="KIND_BY_KEY[row.kind].icon" aria-hidden="true" />
          {{ KIND_BY_KEY[row.kind].label }}
        </span>
        <span v-else class="wp-dim">{{ row.kind }}</span>
      </td>
      <td>
        <span
          v-if="row.category_id && categoryById.get(row.category_id)"
          class="wp-cat-chip"
          :style="catChipStyle(categoryById.get(row.category_id)!.color)"
        >
          {{ categoryById.get(row.category_id)!.name }}
        </span>
        <span v-else class="wp-dim">—</span>
      </td>
      <td><ValidityIcon :issues="issuesFor(row)" /></td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="editRow(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div v-if="row.description" class="wp-row-expand__title">{{ row.description }}</div>
      <div v-else class="wp-dim">No description.</div>
    </template>
  </ModuleListView>
</template>

<style scoped>
.wp-kind-row { display: flex; flex-wrap: wrap; gap: var(--wp-space-3); }
.wp-kind-chip {
  display: inline-flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-2) 10px; /* audit-exempt: 10px matches PrimeVue chip horizontal rhythm */
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-2);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}
.wp-kind-chip:hover { border-color: var(--wp-border-strong); }

.wp-kind-cell {
  display: inline-flex; align-items: center; gap: 5px; /* audit-exempt: 5px matches icon+label optical balance */
  padding: 3px var(--wp-space-4); /* audit-exempt: 3px hairline vertical padding */
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  font-weight: 500;
  /* Single-line — `Fixed Values` was wrapping onto a second line in
   * the narrow Kind column and looked twice as tall as the other
   * pills. `nowrap` keeps every label on one line; the table column
   * widens slightly if needed. */
  white-space: nowrap;
}

.wp-tags-slot { min-height: 28px; }
.wp-tags-row { display: flex; flex-wrap: wrap; gap: var(--wp-space-3); }
.wp-tags-empty { font-size: var(--wp-text-sm); }
.wp-tag-chip[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}
</style>
