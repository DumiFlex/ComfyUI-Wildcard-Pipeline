<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Icon, { ICON_SM } from "../components/ui/Icon.vue";
import RelativeDate from "../components/RelativeDate.vue";
import { api } from "../api/client";
import type { BundleRow, ModuleRow, ModuleType } from "../api/types";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";

/** Stat-tile + recent-row metadata. `type` is the ModuleType for module
 *  kinds; bundles get `key: "bundle"` with no `type` since they live in
 *  a separate library table. */
interface KindMeta {
  key: string;
  type?: ModuleType;
  label: string;
  icon: string;
  color: string;
  slug: string;
}

const KIND_META: KindMeta[] = [
  { key: "wildcard",     type: "wildcard",     label: "Wildcards",     icon: "pi-sparkles",                color: "var(--wp-kind-wildcard)",   slug: "wildcards" },
  { key: "fixed_values", type: "fixed_values", label: "Fixed Values",  icon: "pi-tag",                     color: "var(--wp-kind-fixed)",      slug: "fixed-values" },
  { key: "combine",      type: "combine",      label: "Combines",      icon: "pi-link",                    color: "var(--wp-kind-combine)",    slug: "combines" },
  { key: "derivation",   type: "derivation",   label: "Derivations",   icon: "pi-arrow-right-arrow-left",  color: "var(--wp-kind-derivation)", slug: "derivations" },
  { key: "constraint",   type: "constraint",   label: "Constraints",   icon: "pi-filter",                  color: "var(--wp-kind-constraint)", slug: "constraints" },
  { key: "bundle",                            label: "Bundles",       icon: "pi-box",                     color: "var(--wp-bundle-default, #6366f1)", slug: "bundles" },
];

const KIND_BY_KEY: Record<string, KindMeta> = KIND_META.reduce((acc, k) => {
  acc[k.key] = k;
  return acc;
}, {} as Record<string, KindMeta>);

const router = useRouter();
const categoryStore = useCategoryStore();

const counts = ref<Record<string, number>>({
  wildcard: 0,
  fixed_values: 0,
  combine: 0,
  derivation: 0,
  constraint: 0,
  bundle: 0,
});

/** Normalised recent/favorite entry. Bundles + modules feed into the
 *  same list so users see edits across both surfaces ordered by recency. */
interface DashboardRow {
  id: string;
  name: string;
  category_id: string | null;
  updated_at: string;
  kind: "module" | "bundle";
  moduleType?: ModuleType;
  color: string;
  icon: string;
}

const recentItems = ref<DashboardRow[]>([]);
const favoriteItems = ref<DashboardRow[]>([]);
const tab = ref<"recent" | "favorites">("recent");

const logoUrl = `${import.meta.env.BASE_URL}images/favicon.svg`;
const wikiUrl = "https://github.com/DumiFlex/ComfyUI-WildcardPipeline/wiki";

function openDocs() {
  window.open(wikiUrl, "_blank", "noopener");
}

function navigateToKind(slug: string) {
  router.push(`/${slug}`);
}

function openTestRunner() {
  router.push("/test");
}

function openImportExport() {
  router.push("/import-export");
}

function newWildcard() {
  router.push("/wildcards/new");
}

function newBundle() {
  router.push("/bundles/new");
}

function editRow(row: DashboardRow) {
  if (row.kind === "bundle") {
    router.push(`/bundles/${row.id}/edit`);
    return;
  }
  const meta = row.moduleType ? KIND_BY_KEY[row.moduleType] : undefined;
  if (!meta) return;
  router.push(`/${meta.slug}/${row.id}/edit`);
}

const categoryById = computed(() => {
  const map = new Map<string, { name: string; color: string | null }>();
  for (const c of categoryStore.items) map.set(c.id, { name: c.name, color: c.color });
  return map;
});

function categoryFor(row: DashboardRow): { name: string; color: string | null } | undefined {
  if (!row.category_id) return undefined;
  return categoryById.value.get(row.category_id);
}

const visibleItems = computed<DashboardRow[]>(() =>
  tab.value === "favorites" ? favoriteItems.value : recentItems.value,
);

function moduleToRow(m: ModuleRow): DashboardRow {
  const meta = KIND_BY_KEY[m.type];
  return {
    id: m.id,
    name: m.name,
    category_id: m.category_id,
    updated_at: m.updated_at,
    kind: "module",
    moduleType: m.type,
    color: meta?.color ?? "var(--wp-text-muted)",
    icon: meta?.icon ?? "pi-circle",
  };
}

function bundleToRow(b: BundleRow): DashboardRow {
  const bundleMeta = KIND_BY_KEY.bundle;
  return {
    id: b.id,
    name: b.name,
    category_id: b.category_id,
    updated_at: b.updated_at,
    kind: "bundle",
    // Frame color when set on the bundle itself, else the default
    // bundle hue from the global token. Mirrors how BundleHeader
    // resolves `--wp-bundle-color`.
    color: b.color && b.color.length > 0 ? b.color : (bundleMeta?.color ?? "var(--wp-bundle-default)"),
    icon: bundleMeta?.icon ?? "pi-box",
  };
}

async function loadCounts() {
  // Fetch one record per kind in parallel; both api.modules.list and
  // api.bundles.list expose `total` on the response.
  await Promise.all(
    KIND_META.map(async (k) => {
      try {
        if (k.key === "bundle") {
          const res = await api.bundles.list({ limit: 1 });
          counts.value.bundle = res.total ?? res.items.length;
        } else if (k.type) {
          const res = await api.modules.list({ type: k.type, limit: 1 });
          counts.value[k.key] = res.total ?? res.items.length;
        }
      } catch {
        counts.value[k.key] = 0;
      }
    }),
  );
}

async function loadRecent() {
  // Pull both sources in parallel, normalise, sort by updated_at desc,
  // take the top 5. Server-side recency endpoint doesn't exist; we
  // ask for 50 of each and merge client-side which is plenty for the
  // 5-row preview surface.
  try {
    const [modRes, bundleRes] = await Promise.all([
      api.modules.list({ limit: 50 }),
      api.bundles.list({ limit: 50 }),
    ]);
    const rows: DashboardRow[] = [
      ...modRes.items.map(moduleToRow),
      ...bundleRes.items.map(bundleToRow),
    ];
    rows.sort((a, b) => {
      const ta = Date.parse(a.updated_at || "") || 0;
      const tb = Date.parse(b.updated_at || "") || 0;
      return tb - ta;
    });
    recentItems.value = rows.slice(0, 5);
  } catch {
    recentItems.value = [];
  }
}

async function loadFavorites() {
  try {
    const [modRes, bundleRes] = await Promise.all([
      api.modules.list({ favorites: true, limit: 5 }),
      api.bundles.list({ favorites: true, limit: 5 }),
    ]);
    const rows: DashboardRow[] = [
      ...modRes.items.map(moduleToRow),
      ...bundleRes.items.map(bundleToRow),
    ];
    rows.sort((a, b) => {
      const ta = Date.parse(a.updated_at || "") || 0;
      const tb = Date.parse(b.updated_at || "") || 0;
      return tb - ta;
    });
    favoriteItems.value = rows.slice(0, 5);
  } catch {
    favoriteItems.value = [];
  }
}

const refreshing = ref(false);
async function refresh() {
  refreshing.value = true;
  try {
    await Promise.all([
      loadCounts(),
      loadRecent(),
      loadFavorites(),
      categoryStore.fetchAll().catch(() => undefined),
    ]);
  } finally {
    refreshing.value = false;
  }
}
onMounted(refresh);
</script>

<template>
  <div class="wp-page">
    <!-- Hero -->
    <div class="wp-hero">
      <div class="wp-hero__icon"><img :src="logoUrl" alt="" /></div>
      <div class="dashboard__hero-text">
        <h2 class="wp-hero__title">Welcome to Wildcard Pipeline</h2>
        <p class="wp-hero__sub">
          Manage modules — wildcards, fixed values, combines, derivations and constraints — and bundle them into named groups that drop into ComfyUI prompts as snapshots.
        </p>
      </div>
      <div class="wp-hsplit dashboard__hero-actions">
        <Button
          variant="ghost"
          icon="pi pi-refresh"
          aria-label="Refresh dashboard"
          :disabled="refreshing"
          :class="{ 'wp-refresh-btn--spin': refreshing }"
          @click="refresh"
        >Refresh</Button>
        <Button variant="outline" icon="pi-book" @click="openDocs">Docs</Button>
        <Button variant="primary" icon="pi-plus" @click="newWildcard">New module</Button>
      </div>
    </div>

    <!-- Stats -->
    <div class="wp-stats" aria-label="Library counts">
      <button
        v-for="kind in KIND_META"
        :key="kind.key"
        type="button"
        class="wp-stat dashboard__stat"
        :aria-label="`View all ${kind.label}`"
        @click="navigateToKind(kind.slug)"
        @keydown.enter.prevent="navigateToKind(kind.slug)"
        @keydown.space.prevent="navigateToKind(kind.slug)"
      >
        <div
          class="wp-stat__icon"
          :style="{ color: kind.color, background: `color-mix(in oklab, ${kind.color} 16%, transparent)` }"
        >
          <Icon :name="kind.icon" />
        </div>
        <div class="wp-stat__label">{{ kind.label }}</div>
        <div class="wp-stat__value">{{ counts[kind.key] }}</div>
        <div class="wp-stat__delta">
          <Icon name="pi-arrow-up-right" :size="ICON_SM" /> View all
        </div>
      </button>
    </div>

    <!-- Quick actions row -->
    <div class="dashboard__quick">
      <Button variant="ghost" icon="pi-bolt" @click="openTestRunner">Open test runner</Button>
      <Button variant="ghost" icon="pi-arrow-right-arrow-left" @click="openImportExport">Import / Export</Button>
      <Button variant="ghost" icon="pi-plus" @click="newBundle">New bundle</Button>
    </div>

    <!-- Recent / Favorites -->
    <Card padding>
      <template #actions>
        <div class="wp-tabs wp-recent__tabs">
          <button
            type="button"
            class="wp-tabs__btn wp-tab"
            :data-active="tab === 'recent' ? 'true' : 'false'"
            data-test="dashboard-tab-recent"
            @click="tab = 'recent'"
          >
            <Icon name="pi-clock" /> Recent edits
          </button>
          <button
            type="button"
            class="wp-tabs__btn wp-tab"
            :data-active="tab === 'favorites' ? 'true' : 'false'"
            data-test="dashboard-tab-favorites"
            @click="tab = 'favorites'"
          >
            <Icon name="pi-star-fill" /> Favorites
          </button>
          <a
            class="dashboard__view-all"
            href="#"
            @click.prevent="router.push('/all')"
          >View all <Icon name="pi-arrow-right" :size="ICON_SM" /></a>
        </div>
      </template>
      <div v-if="visibleItems.length" class="wp-list wp-recent">
        <div
          v-for="row in visibleItems"
          :key="`${row.kind}:${row.id}`"
          class="wp-list__row"
          tabindex="0"
          role="button"
          :aria-label="`Edit ${row.name}`"
          @click="editRow(row)"
          @keydown.enter.prevent="editRow(row)"
          @keydown.space.prevent="editRow(row)"
        >
          <span
            class="dashboard__row-icon"
            :style="{
              color: row.color,
              background: `color-mix(in oklab, ${row.color} 18%, transparent)`,
            }"
          >
            <Icon :name="row.icon" />
          </span>
          <span class="dashboard__row-name">{{ row.name }}</span>
          <span
            v-if="categoryFor(row)"
            class="wp-cat-chip"
            :style="catChipStyle(categoryFor(row)!.color)"
          >{{ categoryFor(row)!.name }}</span>
          <span class="wp-id">{{ row.id }}</span>
          <RelativeDate :value="row.updated_at" />
        </div>
      </div>
      <p v-else class="dashboard__empty">
        {{ tab === 'favorites' ? 'No favorites yet.' : 'No edits yet.' }}
      </p>
    </Card>
  </div>
</template>

<style scoped>
.dashboard__hero-text { flex: 1; min-width: 0; }
.dashboard__hero-actions { gap: var(--wp-space-4); }

.dashboard__quick {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-4);
}

.wp-recent__tabs {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  border-bottom: none;
}
.wp-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-5);
  background: none;
  border: 1px solid transparent;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--wp-radius-sm);
}
.wp-tabs__btn:hover { color: var(--wp-text); }
.wp-tabs__btn[data-active="true"] {
  color: var(--wp-text);
  background: var(--wp-bg-2);
  border-color: var(--wp-border);
}
.dashboard__view-all {
  margin-left: auto;
  font-size: var(--wp-text-sm);
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
}
.dashboard__view-all:hover { color: var(--wp-text); }

.dashboard__row-icon {
  width: 22px;
  height: 22px;
  border-radius: var(--wp-radius-sm);
  display: grid;
  place-items: center;
  font-size: var(--wp-text-xs);
  flex-shrink: 0;
}
.dashboard__row-name {
  flex: 1;
  font-weight: 500;
  font-size: var(--wp-text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.dashboard__empty {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  margin: var(--wp-space-5) var(--wp-space-2) var(--wp-space-3);
}

.dashboard__stat { cursor: pointer; text-align: left; font: inherit; color: inherit; }
.dashboard__stat:hover { border-color: var(--wp-border-strong); }
.dashboard__stat:focus-visible {
  outline: 2px solid var(--wp-border-focus);
  outline-offset: 2px;
}
</style>
