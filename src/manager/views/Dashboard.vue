<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Icon from "../components/ui/Icon.vue";
import RelativeDate from "../components/RelativeDate.vue";
import { api } from "../api/client";
import type { ModuleRow, ModuleType } from "../api/types";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";

interface KindMeta {
  type: ModuleType;
  label: string;
  icon: string;
  color: string;
  slug: string;
}

// Mirrors KIND_META from docs/design-handoff/wildcardpipeline/project/data.jsx.
const KIND_META: KindMeta[] = [
  { type: "wildcard",     label: "Wildcards",     icon: "pi-th-large",  color: "var(--wp-kind-wildcard)",   slug: "wildcards" },
  { type: "fixed_values", label: "Fixed Values",  icon: "pi-tag",       color: "var(--wp-kind-fixed)",      slug: "fixed-values" },
  { type: "combine",      label: "Combines",      icon: "pi-share-alt", color: "var(--wp-kind-combine)",    slug: "combines" },
  { type: "derivation",   label: "Derivations",   icon: "pi-code",      color: "var(--wp-kind-derivation)", slug: "derivations" },
  { type: "constraint",   label: "Constraints",   icon: "pi-sitemap",   color: "var(--wp-kind-constraint)", slug: "constraints" },
  { type: "pipeline",     label: "Pipelines",     icon: "pi-list",      color: "var(--wp-kind-pipeline)",   slug: "pipelines" },
];

const KIND_BY_TYPE: Record<ModuleType, KindMeta> = KIND_META.reduce((acc, k) => {
  acc[k.type] = k;
  return acc;
}, {} as Record<ModuleType, KindMeta>);

const router = useRouter();
const categoryStore = useCategoryStore();

const counts = ref<Record<ModuleType, number>>({
  wildcard: 0,
  fixed_values: 0,
  combine: 0,
  derivation: 0,
  constraint: 0,
  pipeline: 0,
});

const recentItems = ref<ModuleRow[]>([]);
const favoriteItems = ref<ModuleRow[]>([]);
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

function newPipeline() {
  router.push("/pipelines/new");
}

function editRow(row: ModuleRow) {
  const meta = KIND_BY_TYPE[row.type];
  if (!meta) return;
  router.push(`/${meta.slug}/${row.id}/edit`);
}

const categoryById = computed(() => {
  const map = new Map<string, { name: string; color: string | null }>();
  for (const c of categoryStore.items) map.set(c.id, { name: c.name, color: c.color });
  return map;
});

function categoryFor(row: ModuleRow): { name: string; color: string | null } | undefined {
  if (!row.category_id) return undefined;
  return categoryById.value.get(row.category_id);
}

const visibleItems = computed<ModuleRow[]>(() =>
  tab.value === "favorites" ? favoriteItems.value : recentItems.value,
);

async function loadCounts() {
  // Fetch one record per kind in parallel; ModuleListResponse exposes total.
  await Promise.all(
    KIND_META.map(async (k) => {
      try {
        const res = await api.modules.list({ type: k.type, limit: 1 });
        counts.value[k.type] = res.total ?? res.items.length;
      } catch {
        counts.value[k.type] = 0;
      }
    }),
  );
}

async function loadRecent() {
  try {
    const res = await api.modules.list({ limit: 50 });
    const sorted = [...res.items].sort((a, b) => {
      const ta = Date.parse(a.updated_at || "") || 0;
      const tb = Date.parse(b.updated_at || "") || 0;
      return tb - ta;
    });
    recentItems.value = sorted.slice(0, 5);
  } catch {
    recentItems.value = [];
  }
}

async function loadFavorites() {
  try {
    const res = await api.modules.list({ favorites: true, limit: 5 });
    favoriteItems.value = res.items.slice(0, 5);
  } catch {
    favoriteItems.value = [];
  }
}

onMounted(async () => {
  await Promise.all([
    loadCounts(),
    loadRecent(),
    loadFavorites(),
    categoryStore.fetchAll().catch(() => undefined),
  ]);
});
</script>

<template>
  <div class="wp-page">
    <!-- Hero -->
    <div class="wp-hero">
      <div class="wp-hero__icon"><img :src="logoUrl" alt="" /></div>
      <div class="dashboard__hero-text">
        <h2 class="wp-hero__title">Welcome to Wildcard Pipeline</h2>
        <p class="wp-hero__sub">
          Manage modules — wildcards, fixed values, combines, derivations and constraints — that drop into ComfyUI prompts as snapshots.
        </p>
      </div>
      <div class="wp-hsplit dashboard__hero-actions">
        <Button variant="outline" icon="pi-book" @click="openDocs">Docs</Button>
        <Button variant="primary" icon="pi-plus" @click="newWildcard">New module</Button>
      </div>
    </div>

    <!-- Stats -->
    <div class="wp-stats" aria-label="Module counts">
      <button
        v-for="kind in KIND_META"
        :key="kind.type"
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
        <div class="wp-stat__value">{{ counts[kind.type] }}</div>
        <div class="wp-stat__delta">
          <Icon name="pi-arrow-up-right" :size="9" /> View all
        </div>
      </button>
    </div>

    <!-- Quick actions row -->
    <div class="dashboard__quick">
      <Button variant="ghost" icon="pi-bolt" @click="openTestRunner">Open test runner</Button>
      <Button variant="ghost" icon="pi-arrow-right-arrow-left" @click="openImportExport">Import / Export</Button>
      <Button variant="ghost" icon="pi-plus" @click="newPipeline">New pipeline</Button>
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
            @click.prevent="navigateToKind('wildcards')"
          >View all <Icon name="pi-arrow-right" :size="10" /></a>
        </div>
      </template>
      <div v-if="visibleItems.length" class="wp-list wp-recent">
        <div
          v-for="row in visibleItems"
          :key="row.id"
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
              color: KIND_BY_TYPE[row.type]?.color,
              background: `color-mix(in oklab, ${KIND_BY_TYPE[row.type]?.color} 18%, transparent)`,
            }"
          >
            <Icon :name="KIND_BY_TYPE[row.type]?.icon ?? 'pi-circle'" />
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
.dashboard__hero-actions { gap: 8px; }

.dashboard__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wp-recent__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: none;
}
.wp-tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: none;
  border: 1px solid transparent;
  color: var(--wp-text-muted);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
}
.wp-tabs__btn:hover { color: var(--wp-text); }
.wp-tabs__btn[data-active="true"] {
  color: var(--wp-text);
  background: var(--wp-bg-2);
  border-color: var(--wp-border);
}
.dashboard__view-all {
  margin-left: auto;
  font-size: 12px;
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dashboard__view-all:hover { color: var(--wp-text); }

.dashboard__row-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 11px;
  flex-shrink: 0;
}
.dashboard__row-name {
  flex: 1;
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.dashboard__empty {
  font-size: 12.5px;
  color: var(--wp-text-muted);
  margin: 12px 4px 6px;
}

.dashboard__stat { cursor: pointer; text-align: left; font: inherit; color: inherit; }
.dashboard__stat:hover { border-color: var(--wp-border-strong); }
.dashboard__stat:focus-visible {
  outline: 2px solid var(--wp-border-focus);
  outline-offset: 2px;
}
</style>
