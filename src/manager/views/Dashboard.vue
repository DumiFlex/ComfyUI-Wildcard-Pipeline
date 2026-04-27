<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import Menu from "primevue/menu";
import { api } from "../api/client";
import type { ModuleRow, ModuleType } from "../api/types";
import { useCategoryStore } from "../stores/categoryStore";
import RelativeDate from "../components/RelativeDate.vue";

interface KindMeta {
  type: ModuleType;
  label: string;
  icon: string;
  color: string;
  slug: string;
}

// Mirrors KIND_META from docs/design-handoff/wildcardpipeline/project/data.jsx.
const KIND_META: KindMeta[] = [
  { type: "wildcard",     label: "Wildcards",     icon: "pi pi-th-large",  color: "var(--wp-kind-wildcard)",   slug: "wildcards" },
  { type: "fixed_values", label: "Fixed Values",  icon: "pi pi-tag",       color: "var(--wp-kind-fixed)",      slug: "fixed-values" },
  { type: "combine",      label: "Combines",      icon: "pi pi-share-alt", color: "var(--wp-kind-combine)",    slug: "combines" },
  { type: "derivation",   label: "Derivations",   icon: "pi pi-code",      color: "var(--wp-kind-derivation)", slug: "derivations" },
  { type: "constraint",   label: "Constraints",   icon: "pi pi-sitemap",   color: "var(--wp-kind-constraint)", slug: "constraints" },
  { type: "pipeline",     label: "Pipelines",     icon: "pi pi-list",      color: "var(--wp-kind-pipeline)",   slug: "pipelines" },
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

const logoUrl = `${import.meta.env.BASE_URL}images/favicon.svg`;
const wikiUrl = "https://github.com/DumiFlex/ComfyUI-WildcardPipeline/wiki";

const newModuleMenu = ref<InstanceType<typeof Menu> | null>(null);
const newModuleItems = computed(() =>
  KIND_META.map((k) => ({
    label: k.label,
    icon: k.icon,
    // TODO: route to the kind-specific create form when slug-aware deeplinks land.
    command: () => router.push(`/${k.slug}/new`),
  })),
);

function toggleNewModuleMenu(event: Event) {
  newModuleMenu.value?.toggle(event);
}

function openDocs() {
  window.open(wikiUrl, "_blank", "noopener");
}

function navigateToKind(slug: string) {
  router.push(`/${slug}`);
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
  // TODO: add server-side sort=updated_at&order=desc — for now we client-slice.
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
  <div class="dashboard">
    <!-- A) Brand hero -->
    <section class="dashboard__hero">
      <div class="dashboard__hero-icon">
        <img :src="logoUrl" alt="" />
      </div>
      <div class="dashboard__hero-text">
        <h2 class="dashboard__hero-title">Welcome to Wildcard Pipeline</h2>
        <p class="dashboard__hero-sub">
          Modular procedural prompt generation. Build, test, and reuse wildcards.
        </p>
      </div>
      <div class="dashboard__hero-actions">
        <Button
          label="Browse docs"
          icon="pi pi-book"
          severity="secondary"
          outlined
          class="dashboard__hero-btn dashboard__hero-btn--outline"
          @click="openDocs"
        />
        <Button
          label="New module"
          icon="pi pi-plus"
          class="dashboard__hero-btn dashboard__hero-btn--primary"
          aria-haspopup="true"
          aria-controls="dashboard-new-module-menu"
          @click="toggleNewModuleMenu"
        />
        <Menu
          id="dashboard-new-module-menu"
          ref="newModuleMenu"
          :model="newModuleItems"
          :popup="true"
        />
      </div>
    </section>

    <!-- B) Stat cards -->
    <section class="dashboard__stats" aria-label="Module counts">
      <button
        v-for="kind in KIND_META"
        :key="kind.type"
        type="button"
        class="dashboard__stat"
        :aria-label="`View all ${kind.label}`"
        @click="navigateToKind(kind.slug)"
      >
        <span class="dashboard__stat-icon" :style="{ color: kind.color, background: `color-mix(in oklab, ${kind.color} 14%, transparent)` }">
          <i :class="kind.icon" aria-hidden="true" />
        </span>
        <span class="dashboard__stat-label">{{ kind.label }}</span>
        <span class="dashboard__stat-value">{{ counts[kind.type] }}</span>
        <span class="dashboard__stat-link">
          View all
          <i class="pi pi-arrow-right" aria-hidden="true" />
        </span>
      </button>
    </section>

    <!-- C) Quick actions -->
    <section class="dashboard__quick" aria-label="Quick actions">
      <Button
        label="Test Runner"
        icon="pi pi-bolt"
        severity="secondary"
        outlined
        class="dashboard__quick-btn"
        @click="router.push('/test')"
      />
      <Button
        label="Categories"
        icon="pi pi-folder"
        severity="secondary"
        outlined
        class="dashboard__quick-btn"
        @click="router.push('/categories')"
      />
      <Button
        label="Import / Export"
        icon="pi pi-arrow-right-arrow-left"
        severity="secondary"
        outlined
        class="dashboard__quick-btn"
        @click="router.push('/import-export')"
      />
    </section>

    <!-- D) Recent + Favorites -->
    <section class="dashboard__recent">
      <article class="dashboard__panel">
        <header class="dashboard__panel-header">
          <h3 class="dashboard__panel-title">Recently updated</h3>
          <a class="dashboard__panel-link" href="#" @click.prevent="router.push('/wildcards')">
            View all
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </a>
        </header>
        <ul v-if="recentItems.length" class="dashboard__list">
          <li
            v-for="row in recentItems"
            :key="row.id"
            class="dashboard__row"
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
              <i :class="KIND_BY_TYPE[row.type]?.icon ?? 'pi pi-circle'" aria-hidden="true" />
            </span>
            <span class="dashboard__row-name">{{ row.name }}</span>
            <span
              v-if="categoryFor(row)"
              class="dashboard__row-chip"
              :style="{ background: categoryFor(row)!.color || 'var(--wp-bg-3)' }"
            >{{ categoryFor(row)!.name }}</span>
            <RelativeDate :value="row.updated_at" />
          </li>
        </ul>
        <p v-else class="dashboard__empty">No edits yet.</p>
      </article>

      <article class="dashboard__panel">
        <header class="dashboard__panel-header">
          <h3 class="dashboard__panel-title">Favorites</h3>
          <a class="dashboard__panel-link" href="#" @click.prevent="router.push('/wildcards')">
            View all
            <i class="pi pi-arrow-right" aria-hidden="true" />
          </a>
        </header>
        <ul v-if="favoriteItems.length" class="dashboard__list">
          <li
            v-for="row in favoriteItems"
            :key="row.id"
            class="dashboard__row"
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
              <i :class="KIND_BY_TYPE[row.type]?.icon ?? 'pi pi-circle'" aria-hidden="true" />
            </span>
            <span class="dashboard__row-name">{{ row.name }}</span>
            <span
              v-if="categoryFor(row)"
              class="dashboard__row-chip"
              :style="{ background: categoryFor(row)!.color || 'var(--wp-bg-3)' }"
            >{{ categoryFor(row)!.name }}</span>
            <RelativeDate :value="row.updated_at" />
          </li>
        </ul>
        <p v-else class="dashboard__empty">No favorites yet.</p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  color: var(--wp-text);
}

/* ---------- Hero ---------- */
.dashboard__hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  border-radius: var(--wp-radius-xl);
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--wp-brand-1) 55%, transparent) 0%, transparent 55%),
    radial-gradient(120% 140% at 100% 100%, color-mix(in oklab, var(--wp-brand-3) 50%, transparent) 0%, transparent 60%),
    linear-gradient(135deg, var(--wp-brand-1), var(--wp-brand-2), var(--wp-brand-3));
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  color: #fff;
}
.dashboard__hero::after {
  content: "";
  position: absolute; inset: 0;
  background: radial-gradient(80% 100% at 50% 0%, rgba(255, 255, 255, 0.06), transparent 70%);
  pointer-events: none;
}
.dashboard__hero-icon {
  width: 52px; height: 52px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: grid; place-items: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
.dashboard__hero-icon img { width: 44px; height: 44px; display: block; }
.dashboard__hero-text {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 1;
}
.dashboard__hero-title {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 2px;
  color: #fff;
}
.dashboard__hero-sub {
  font-size: 12.5px;
  margin: 0;
  max-width: 640px;
  color: rgba(255, 255, 255, 0.82);
}
.dashboard__hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}

/* Force translucent treatment regardless of light/dark theme — gradient is dark in both. */
.dashboard__hero :deep(.dashboard__hero-btn.p-button) {
  border-radius: var(--wp-radius);
}
.dashboard__hero :deep(.dashboard__hero-btn--outline.p-button) {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.dashboard__hero :deep(.dashboard__hero-btn--outline.p-button:hover) {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.dashboard__hero :deep(.dashboard__hero-btn--primary.p-button) {
  background: rgba(255, 255, 255, 0.94);
  border-color: transparent;
  color: var(--wp-accent-800);
}
.dashboard__hero :deep(.dashboard__hero-btn--primary.p-button:hover) {
  background: #fff;
  color: var(--wp-accent-900);
}

/* ---------- Stat cards ---------- */
.dashboard__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 1180px) {
  .dashboard__stats { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .dashboard__stats { grid-template-columns: 1fr; }
}
.dashboard__stat {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color 0.15s, transform 0.15s;
}
.dashboard__stat:hover { border-color: var(--wp-border-strong); }
.dashboard__stat:focus-visible {
  outline: 2px solid var(--wp-border-focus);
  outline-offset: 2px;
}
.dashboard__stat-icon {
  position: absolute; top: 10px; right: 10px;
  width: 26px; height: 26px;
  border-radius: 7px;
  display: grid; place-items: center;
  font-size: 13px;
}
.dashboard__stat-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--wp-text-dim);
  font-weight: 600;
}
.dashboard__stat-value {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.dashboard__stat-link {
  font-size: 11.5px;
  color: var(--wp-accent-text);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dashboard__stat-link i { font-size: 10px; }

/* ---------- Quick actions ---------- */
.dashboard__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dashboard__quick :deep(.dashboard__quick-btn.p-button) {
  border-radius: 999px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
}
.dashboard__quick :deep(.dashboard__quick-btn.p-button:hover) {
  background: var(--wp-bg-3);
  border-color: var(--wp-border-strong);
  color: var(--wp-text);
}

/* ---------- Recent + Favorites ---------- */
.dashboard__recent {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}
@media (max-width: 880px) {
  .dashboard__recent { grid-template-columns: 1fr; }
}
.dashboard__panel {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dashboard__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dashboard__panel-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--wp-text);
}
.dashboard__panel-link {
  font-size: 12px;
  color: var(--wp-accent-text);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dashboard__panel-link:hover { color: var(--wp-accent-text-strong); }
.dashboard__panel-link i { font-size: 10px; }

.dashboard__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.dashboard__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.dashboard__row:hover { background: var(--wp-bg-3); }
.dashboard__row + .dashboard__row {
  border-top: 1px solid var(--wp-border);
  border-radius: 0;
}
.dashboard__row:focus-visible {
  outline: 2px solid var(--wp-border-focus);
  outline-offset: 2px;
}
.dashboard__row-icon {
  width: 22px; height: 22px;
  border-radius: 6px;
  display: grid; place-items: center;
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
.dashboard__row-chip {
  display: inline-block;
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 9px;
  color: #fff;
  font-weight: 500;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
}
.dashboard__empty {
  font-size: 12.5px;
  color: var(--wp-text-muted);
  margin: 6px 4px 4px;
}
</style>
