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
import { GITHUB_WIKI } from "../config/links";
import { useRecentStore } from "../stores/recentStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";

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
const recentStore = useRecentStore();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();

/** Max rows rendered per tab. The Dashboard list section has more vertical
 *  room than the sidebar recents block it replaced, so 10 fits without
 *  scroll on typical viewports while still capping client-side merge work. */
const DASHBOARD_LIST_CAP = 10;

const counts = ref<Record<string, number>>({
  wildcard: 0,
  fixed_values: 0,
  combine: 0,
  derivation: 0,
  constraint: 0,
  bundle: 0,
});

/** Last edited timestamp per kind — surfaced under the stat tile's count
 *  so the dashboard answers "what changed recently" without scrolling
 *  to the Recent edits tab. Empty string means "never", which renders
 *  as a hyphen via the RelativeDate empty path. */
const lastEditByKind = ref<Record<string, string>>({});

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
const tab = ref<"recent" | "opened" | "favorites">("opened");

const logoUrl = `${import.meta.env.BASE_URL}images/favicon.svg`;
const wikiUrl = GITHUB_WIKI;

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

function newOfKind(slug: string) {
  router.push(`/${slug}/new`);
}

/** Total library size — drives both the stats summary and the
 *  getting-started conditional. Empty libraries (< 3 items total) get
 *  the intro checklist instead of the recents tabs. */
const totalItems = computed<number>(() =>
  Object.values(counts.value).reduce((sum, n) => sum + n, 0),
);
const showGettingStarted = computed<boolean>(() => totalItems.value < 3);

/** Health issues derived from the live catalog. Lightweight checks
 *  surfaced as a single advisory card — runtime conflicts (missing
 *  $vars, etc.) are the extension's domain; this card focuses on
 *  *editor-time* mistakes the user can fix from the library. */
interface HealthIssue {
  id: string;
  label: string;
  detail: string;
  count: number;
  route: string;
}
const healthIssues = computed<HealthIssue[]>(() => {
  const issues: HealthIssue[] = [];
  const blankWildcards = moduleStore.catalog.filter((m) => {
    if (m.type !== "wildcard") return false;
    const opts = (m.payload as { options?: { value?: string }[] } | null)?.options ?? [];
    return opts.length === 0 || opts.every((o) => !(o.value || "").trim());
  });
  if (blankWildcards.length) {
    issues.push({
      id: "blank-wildcards",
      label: `${blankWildcards.length} wildcard${blankWildcards.length === 1 ? '' : 's'} with no usable options`,
      detail: "Wildcards need at least one non-empty option to resolve.",
      count: blankWildcards.length,
      route: "/wildcards",
    });
  }
  const emptyBundles = bundleStore.catalog.filter((b) => {
    const kids = Array.isArray(b.children) ? b.children : [];
    return kids.length === 0;
  });
  if (emptyBundles.length) {
    issues.push({
      id: "empty-bundles",
      label: `${emptyBundles.length} empty bundle${emptyBundles.length === 1 ? '' : 's'}`,
      detail: "Bundles without children won't surface anything at run time.",
      count: emptyBundles.length,
      route: "/bundles",
    });
  }
  const unnamed = [
    ...moduleStore.catalog.filter((m) => !m.name?.trim()),
    ...bundleStore.catalog.filter((b) => !b.name?.trim()),
  ];
  if (unnamed.length) {
    issues.push({
      id: "unnamed",
      label: `${unnamed.length} unnamed item${unnamed.length === 1 ? '' : 's'}`,
      detail: "Items without names are hard to find in pickers and references.",
      count: unnamed.length,
      route: "/all",
    });
  }
  return issues;
});

/** Getting-started steps. The check column reflects actual library
 *  state so users can see their progress against the checklist as
 *  they create things. */
const startSteps = computed(() => [
  {
    id: "wildcard",
    title: "Create your first wildcard",
    body: "Wildcards pick one weighted option from a pool. They form the base of every prompt template.",
    cta: "New wildcard",
    slug: "wildcards",
    done: counts.value.wildcard > 0,
  },
  {
    id: "combine",
    title: "Compose a Combine module",
    body: "Combine joins fixed text with wildcard variables into a reusable template.",
    cta: "New combine",
    slug: "combines",
    done: counts.value.combine > 0,
  },
  {
    id: "test",
    title: "Try the Test Runner",
    body: "Run any module against the engine to preview output before wiring it into a graph.",
    cta: "Open Test Runner",
    slug: "test",
    done: false,
  },
]);

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

/** "Recently opened" rows derived from `recentStore` (localStorage MRU of
 *  what the user actually clicked into) — distinct from "Recent edits"
 *  which is sorted by server-side `updated_at`. Joins against live
 *  module/bundle catalog to pick up category_id; falls back to the
 *  recentStore snapshot if the row is no longer in the catalog (e.g.
 *  deleted, or catalog still loading). `updated_at` is wired to the
 *  recentStore's `openedAt` so RelativeDate renders "X ago" since the
 *  user last opened the row — not since it was last edited. */
const openedItems = computed<DashboardRow[]>(() => {
  const modIx = new Map(moduleStore.catalog.map((m) => [m.id, m]));
  const bunIx = new Map(bundleStore.catalog.map((b) => [b.id, b]));
  const out: DashboardRow[] = [];
  for (const r of recentStore.items) {
    if (r.kind === "bundle") {
      const live = bunIx.get(r.id);
      const base = live ? bundleToRow(live) : null;
      out.push({
        id: r.id,
        name: live?.name ?? r.name,
        category_id: live?.category_id ?? null,
        updated_at: r.openedAt,
        kind: "bundle",
        color: base?.color ?? (KIND_BY_KEY.bundle?.color ?? "var(--wp-bundle-default)"),
        icon: KIND_BY_KEY.bundle?.icon ?? "pi-box",
      });
    } else {
      const meta = KIND_BY_KEY[r.kind];
      if (!meta) continue;
      const live = modIx.get(r.id);
      out.push({
        id: r.id,
        name: live?.name ?? r.name,
        category_id: live?.category_id ?? null,
        updated_at: r.openedAt,
        kind: "module",
        moduleType: r.kind as ModuleType,
        color: meta.color,
        icon: meta.icon,
      });
    }
  }
  return out;
});

const visibleItems = computed<DashboardRow[]>(() => {
  if (tab.value === "favorites") return favoriteItems.value;
  if (tab.value === "opened") return openedItems.value;
  return recentItems.value;
});

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
  // api.bundles.list expose `total` on the response. Requesting limit:1
  // sorted by updated_at desc gives us count + most-recent edit in a
  // single round-trip per kind.
  await Promise.all(
    KIND_META.map(async (k) => {
      try {
        if (k.key === "bundle") {
          const res = await api.bundles.list({ limit: 1 });
          counts.value.bundle = res.total ?? res.items.length;
          lastEditByKind.value.bundle = res.items[0]?.updated_at ?? "";
        } else if (k.type) {
          const res = await api.modules.list({ type: k.type, limit: 1 });
          counts.value[k.key] = res.total ?? res.items.length;
          lastEditByKind.value[k.key] = res.items[0]?.updated_at ?? "";
        }
      } catch {
        counts.value[k.key] = 0;
        lastEditByKind.value[k.key] = "";
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
    recentItems.value = rows.slice(0, DASHBOARD_LIST_CAP);
  } catch {
    recentItems.value = [];
  }
}

async function loadFavorites() {
  try {
    const [modRes, bundleRes] = await Promise.all([
      api.modules.list({ favorites: true, limit: DASHBOARD_LIST_CAP }),
      api.bundles.list({ favorites: true, limit: DASHBOARD_LIST_CAP }),
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
    favoriteItems.value = rows.slice(0, DASHBOARD_LIST_CAP);
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
        <div class="wp-stat__delta dashboard__stat-foot">
          <span class="dashboard__stat-edit">
            <Icon name="pi-clock" :size="ICON_SM" />
            <RelativeDate v-if="lastEditByKind[kind.key]" :value="lastEditByKind[kind.key]" />
            <span v-else>—</span>
          </span>
          <span class="dashboard__stat-cta">
            <Icon name="pi-arrow-up-right" :size="ICON_SM" /> View
          </span>
        </div>
      </button>
    </div>

    <!-- Quick-create row — one '+ New <kind>' button per module type so
         creation is one click from the dashboard for every shape. -->
    <div class="dashboard__quick" data-test="dashboard-quick-create">
      <span class="dashboard__quick-label">Quick create</span>
      <Button
        v-for="kind in KIND_META"
        :key="kind.key"
        variant="ghost"
        size="sm"
        icon="pi-plus"
        :data-test="`quick-new-${kind.key}`"
        @click="newOfKind(kind.slug)"
      >{{ kind.label.replace(/s$/, '') }}</Button>
      <span class="wp-spacer" />
      <Button variant="ghost" size="sm" icon="pi-bolt" @click="openTestRunner">Test Runner</Button>
      <Button variant="ghost" size="sm" icon="pi-arrow-right-arrow-left" @click="openImportExport">Import / Export</Button>
    </div>

    <!-- Health issues — advisory card, surfaced only when the catalog
         has real editor-time problems. Each row links to the list view
         where the user can find + fix the offending items. -->
    <Card v-if="healthIssues.length" data-test="dashboard-health">
      <template #default>
        <div class="dashboard__health-head">
          <Icon name="pi-exclamation-triangle" />
          <span class="dashboard__health-title">{{ healthIssues.length }} thing{{ healthIssues.length === 1 ? '' : 's' }} to look at</span>
        </div>
        <ul class="dashboard__health-list">
          <li
            v-for="issue in healthIssues"
            :key="issue.id"
            class="dashboard__health-row"
            @click="router.push(issue.route)"
            @keydown.enter.prevent="router.push(issue.route)"
            @keydown.space.prevent="router.push(issue.route)"
            tabindex="0"
            role="button"
            :aria-label="`${issue.label}. Open ${issue.route}`"
          >
            <strong>{{ issue.label }}</strong>
            <span class="dashboard__health-detail">{{ issue.detail }}</span>
            <Icon name="pi-arrow-right" :size="ICON_SM" />
          </li>
        </ul>
      </template>
    </Card>

    <!-- Getting-started checklist — shown only when the library is
         essentially empty (< 3 items across all kinds). Auto-collapses
         into the regular Recents tabs as soon as the user creates a
         few things, so it never gets in the way of returning users. -->
    <Card v-if="showGettingStarted" data-test="dashboard-getting-started">
      <template #default>
        <div class="dashboard__start-head">
          <Icon name="pi-compass" />
          <div>
            <h3 class="dashboard__start-title">Get started in three steps</h3>
            <p class="dashboard__start-sub">Each step turns into a checkmark once you've done it.</p>
          </div>
        </div>
        <ol class="dashboard__start-list">
          <li
            v-for="(step, i) in startSteps"
            :key="step.id"
            class="dashboard__start-row"
            :data-done="step.done || undefined"
          >
            <span class="dashboard__start-step">
              <Icon v-if="step.done" name="pi-check-circle" />
              <span v-else class="dashboard__start-num">{{ i + 1 }}</span>
            </span>
            <div class="dashboard__start-body">
              <strong>{{ step.title }}</strong>
              <p>{{ step.body }}</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              :icon="step.id === 'test' ? 'pi-bolt' : 'pi-plus'"
              :disabled="step.done && step.id !== 'test'"
              @click="router.push(`/${step.slug}${step.id === 'test' ? '' : '/new'}`)"
            >{{ step.done && step.id !== 'test' ? 'Done' : step.cta }}</Button>
          </li>
        </ol>
      </template>
    </Card>

    <!-- Recent / Favorites -->
    <Card v-if="!showGettingStarted" padding>
      <template #actions>
        <div class="wp-tabs wp-recent__tabs">
          <button
            type="button"
            class="wp-tabs__btn wp-tab"
            :data-active="tab === 'opened' ? 'true' : 'false'"
            data-test="dashboard-tab-opened"
            @click="tab = 'opened'"
          >
            <Icon name="pi-history" /> Recently opened
          </button>
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
        {{
          tab === 'favorites' ? 'No favorites yet.'
            : tab === 'opened' ? 'No recently opened items yet — pick a module from the sidebar.'
            : 'No edits yet.'
        }}
      </p>
    </Card>
  </div>
</template>

<style scoped>
.dashboard__hero-text { flex: 1; min-width: 0; }
.dashboard__hero-actions { gap: var(--wp-space-4); }

.dashboard__stat-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wp-space-3);
  width: 100%;
}
.dashboard__stat-edit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
}
.dashboard__stat-cta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dashboard__quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
}
.dashboard__quick-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  padding-right: var(--wp-space-3);
  border-right: 1px solid var(--wp-border);
}

/* Health card — danger-tinted advisory list. Each row is keyboard
 * focusable + clickable to jump to the relevant kind page. */
.dashboard__health-head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  margin-bottom: var(--wp-space-4);
  color: var(--wp-warn, #facc15);
}
.dashboard__health-title { font-weight: 600; font-size: var(--wp-text-base); }
.dashboard__health-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}
.dashboard__health-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-3) var(--wp-space-4);
  background: color-mix(in oklab, var(--wp-warn, #facc15) 8%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn, #facc15) 22%, transparent);
  border-radius: var(--wp-radius);
  cursor: pointer;
  transition: background 120ms ease;
}
.dashboard__health-row:hover,
.dashboard__health-row:focus-visible {
  background: color-mix(in oklab, var(--wp-warn, #facc15) 14%, transparent);
  outline: none;
}
.dashboard__health-row strong { font-weight: 600; }
.dashboard__health-detail {
  flex: 1;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}

/* Getting-started 3-step checklist. Steps render as a numbered list
 * with the number swapped for a check icon when the corresponding
 * library item exists (e.g. the wildcard step ticks once counts.wildcard > 0). */
.dashboard__start-head {
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-4);
  margin-bottom: var(--wp-space-5);
}
.dashboard__start-head .pi { color: var(--wp-accent-500); font-size: 22px; margin-top: 2px; }
.dashboard__start-title { margin: 0; font-size: var(--wp-text-lg); font-weight: 600; }
.dashboard__start-sub { margin: 2px 0 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.dashboard__start-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.dashboard__start-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}
.dashboard__start-row[data-done] {
  background: color-mix(in oklab, var(--wp-success, #22c55e) 6%, transparent);
  border-color: color-mix(in oklab, var(--wp-success, #22c55e) 26%, transparent);
}
.dashboard__start-step {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-weight: 600;
  flex-shrink: 0;
}
.dashboard__start-row[data-done] .dashboard__start-step {
  background: color-mix(in oklab, var(--wp-success, #22c55e) 20%, transparent);
  color: var(--wp-success, #22c55e);
}
.dashboard__start-num { font-size: 12.5px; }
.dashboard__start-body { flex: 1; min-width: 0; }
.dashboard__start-body strong { font-weight: 600; }
.dashboard__start-body p { margin: 2px 0 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }

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
