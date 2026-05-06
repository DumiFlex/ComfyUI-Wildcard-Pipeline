<template>
  <ModalShell :visible="visible" @close="$emit('close')">
    <div class="wp-picker" ref="rootEl" tabindex="-1">

      <!-- Header -->
      <header class="wp-picker__head">
        <div class="wp-picker__head-text">
          <div class="wp-picker__eyebrow">
            Add modules from library
            <span v-if="multiMode" class="wp-picker__eyebrow-tag">multi-select</span>
          </div>
          <div class="wp-picker__title">
            Browse Library
            <span class="wp-picker__title-detail">
              · {{ modules.length }} {{ modules.length === 1 ? "module" : "modules" }}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="wp-picker__multi-toggle"
          :data-active="multiMode || null"
          :aria-pressed="multiMode"
          :title="multiMode ? 'Switch to single-pick' : 'Switch to multi-pick'"
          @click="toggleMulti"
        >
          <i class="pi pi-check-square" aria-hidden="true"></i>
          Multi
        </button>
        <button type="button" class="wp-picker__close" aria-label="Close" @click="$emit('close')">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </header>

      <!-- Toolbar: search + kind tabs + compact filter buttons.
           Filters are inline on the toolbar (no dedicated row) so
           the body has the maximum vertical space. Quick-toggle
           filters (favorites, hide-added) are bare icon buttons;
           multi-value filters (category, tags) live behind a
           single "Filters" popover button so a 50-tag library
           doesn't push the rows offscreen. -->
      <div class="wp-picker__toolbar">
        <!-- Top row — search box stretches; filter icon buttons +
             popover trigger sit inline to its right. Wrapped in a
             flex-row so the toolbar's outer column layout doesn't
             stack each icon onto its own line. -->
        <div class="wp-picker__toolbar-top">
        <div class="wp-picker__search" :class="{ 'is-focused': searchFocused }">
          <i class="pi pi-search wp-picker__search-icon" aria-hidden="true"></i>
          <input
            ref="searchInput"
            v-model="searchTerm"
            type="text"
            placeholder="Search modules by name or var…"
            aria-label="Search modules"
            data-testid="picker-search"
            @focus="searchFocused = true"
            @blur="searchFocused = false"
          />
          <span v-if="searchTerm" class="wp-picker__search-clear" @click="searchTerm = ''">
            <i class="pi pi-times" aria-hidden="true"></i>
          </span>
        </div>

        <!-- Inline icon-only quick toggles. Each is a thin square
             button next to search. Active state = accent fill. -->
        <button
          v-if="hasFavoritesInData"
          type="button"
          class="wp-picker__icon-btn"
          :class="{ 'wp-picker__icon-btn--active': favoritesOnly }"
          :title="favoritesOnly ? 'Showing favorites only · click to clear' : 'Show favorites only'"
          data-testid="picker-filter-favorites"
          @click="favoritesOnly = !favoritesOnly"
        >
          <i :class="['pi', favoritesOnly ? 'pi-star-fill' : 'pi-star']" aria-hidden="true"></i>
        </button>
        <button
          v-if="alreadyAdded && alreadyAdded.length > 0"
          type="button"
          class="wp-picker__icon-btn"
          :class="{ 'wp-picker__icon-btn--active': hideAlreadyAdded }"
          :title="hideAlreadyAdded ? `Hiding ${alreadyAdded.length} already-added modules · click to show` : `Hide ${alreadyAdded.length} already-added modules`"
          data-testid="picker-filter-hide-added"
          @click="hideAlreadyAdded = !hideAlreadyAdded"
        >
          <i :class="['pi', hideAlreadyAdded ? 'pi-eye-slash' : 'pi-eye']" aria-hidden="true"></i>
        </button>

        <!-- Filters popover trigger. Renders only when there's
             actually category or tag data to filter on. Badge shows
             the count of dimensions currently active (category
             selection + selected tag count) so users see at a
             glance there's an active filter without opening it. -->
        <div
          v-if="usedCategories.length || availableTags.length"
          class="wp-picker__filters-pop"
        >
          <button
            type="button"
            class="wp-picker__icon-btn wp-picker__filter-trigger"
            :class="{ 'wp-picker__icon-btn--active': activePopoverCount > 0 || filtersOpen }"
            :title="filtersOpen ? 'Close filters' : 'More filters'"
            :aria-expanded="filtersOpen"
            data-testid="picker-filter-trigger"
            @click="filtersOpen = !filtersOpen"
          >
            <i class="pi pi-filter" aria-hidden="true"></i>
            <span
              v-if="activePopoverCount > 0"
              class="wp-picker__filter-badge"
              aria-label="active filter count"
            >{{ activePopoverCount }}</span>
          </button>

          <!-- Popover panel. Anchored under the trigger button.
               Click-outside closes via the `wp-picker__pop-shield`
               full-modal cover. Stacked vertically so categories +
               tags both have generous room without crowding the
               toolbar. -->
          <Transition name="wp-pop">
            <div v-if="filtersOpen" class="wp-picker__pop" data-testid="picker-filter-pop">
              <div v-if="usedCategories.length" class="wp-picker__pop-section">
                <div class="wp-picker__pop-label">CATEGORY</div>
                <select
                  class="wp-picker__filter-cat-select"
                  :value="selectedCategoryId ?? ''"
                  aria-label="Filter by category"
                  data-testid="picker-filter-category"
                  @change="selectedCategoryId = ($event.target as HTMLSelectElement).value || null"
                >
                  <option value="">All categories</option>
                  <option v-for="c in usedCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>

              <div v-if="availableTags.length" class="wp-picker__pop-section">
                <div class="wp-picker__pop-label">
                  TAGS
                  <span class="wp-picker__pop-label-hint">click to AND-narrow</span>
                </div>
                <div class="wp-picker__filter-tags">
                  <button
                    v-for="tag in availableTags"
                    :key="tag"
                    type="button"
                    class="wp-picker__tag-chip"
                    :class="{ 'wp-picker__tag-chip--active': selectedTags.has(tag) }"
                    :data-testid="`picker-tag-${tag}`"
                    @click="toggleTag(tag)"
                  >{{ tag }}</button>
                </div>
              </div>

              <button
                v-if="hasActiveFilter"
                type="button"
                class="wp-picker__pop-clear"
                data-testid="picker-filter-clear"
                @click="clearAllFilters"
              >
                <i class="pi pi-filter-slash" aria-hidden="true"></i>
                Clear all filters
              </button>
            </div>
          </Transition>
        </div>
        </div><!-- /wp-picker__toolbar-top -->

        <div class="wp-picker__tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.value ?? 'all'"
            type="button"
            class="wp-picker__tab"
            role="tab"
            :data-active="activeTab === tab.value || null"
            :data-testid="`picker-tab-${tab.value ?? 'all'}`"
            @click="activeTab = tab.value"
          >
            <i v-if="tab.icon" :class="['pi', tab.icon, 'wp-picker__tab-icon']" aria-hidden="true"></i>
            <span>{{ tab.label }}</span>
            <span class="wp-picker__tab-count">{{ countFor(tab.value) }}</span>
          </button>
        </div>
      </div>

      <!-- Click-shield: when popover is open, a transparent layer
           over the rest of the modal closes it on click. Sized to
           the modal interior so the popover itself stays
           interactive. -->
      <div
        v-if="filtersOpen"
        class="wp-picker__pop-shield"
        @click="filtersOpen = false"
      ></div>

      <!-- Body: scrollable list grouped by kind -->
      <div class="wp-picker__body">
        <div v-if="loading" class="wp-picker__state">
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          Loading modules…
        </div>
        <div v-else-if="loadError" class="wp-picker__state wp-picker__state--error">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          {{ loadError }}
          <button type="button" class="wp-picker__retry" @click="reload">Retry</button>
        </div>
        <div v-else-if="filteredModules.length === 0" class="wp-picker__state">
          <i class="pi pi-inbox" aria-hidden="true"></i>
          {{ searchTerm ? `No matches for "${searchTerm}"` : "No modules in this category." }}
        </div>

        <template v-else>
          <template v-for="group in groupedFiltered" :key="group.kind">
            <div class="wp-picker__section-head">
              <span>{{ kindLabel(group.kind) }}</span>
              <span class="wp-picker__section-line"></span>
              <span class="wp-picker__section-count">{{ group.items.length }}</span>
            </div>
            <button
              v-for="row in group.items"
              :key="row.id"
              type="button"
              class="wp-picker__row"
              :data-kind="row.type"
              :data-multi="multiMode || null"
              :data-checked="selected.has(row.id) ? '' : null"
              :data-disabled="!isPickable(row) || null"
              :data-testid="`picker-row-${row.id}`"
              :data-test="`picker-row-${row.id}`"
              :disabled="!isPickable(row)"
              :title="isPickable(row) ? '' : 'Module has no payload — cannot embed.'"
              @click="onRowClick(row)"
            >
              <span
                class="wp-picker__check"
                data-test="picker-checkbox"
                :class="{ on: selected.has(row.id) }"
                aria-hidden="true"
              >
                <i v-if="selected.has(row.id)" class="pi pi-check"></i>
              </span>
              <span class="wp-picker__row-icon" :data-kind="row.type">
                <i :class="['pi', kindIcon(row.type)]" aria-hidden="true"></i>
              </span>
              <span class="wp-picker__row-main">
                <span class="wp-picker__row-name">{{ row.name }}</span>
                <span class="wp-picker__row-var">{{ subtitleFor(row) }}</span>
              </span>
              <span class="wp-picker__row-uuid">{{ shortUuid(row.id) }}</span>
            </button>
          </template>
        </template>
      </div>

      <!-- Selection drawer (multi-mode only, when ≥1 picked) -->
      <div v-if="multiMode && selected.size > 0" class="wp-picker__selection">
        <div class="wp-picker__selection-top">
          <span class="wp-picker__selection-count">
            <strong>{{ selected.size }}</strong>
            picked
          </span>
          <span class="wp-picker__selection-spacer"></span>
          <button
            type="button"
            class="wp-picker__selection-clear"
            @click="selected.clear()"
            data-testid="picker-clear"
          >
            Clear
          </button>
        </div>
        <div class="wp-picker__selection-chips">
          <span
            v-for="id in [...selected]"
            :key="id"
            class="wp-picker__sel-chip"
            :data-kind="byId.get(id)?.type"
          >
            <span class="wp-picker__sel-dot"></span>
            {{ byId.get(id)?.name ?? id }}
            <button
              type="button"
              class="wp-picker__sel-close"
              :aria-label="`Remove ${byId.get(id)?.name ?? id}`"
              @click="selected.delete(id)"
            >
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </span>
        </div>
      </div>

      <!-- Footer -->
      <footer class="wp-picker__footer">
        <span class="wp-picker__hint">
          <kbd>↑</kbd><kbd>↓</kbd> nav
          · <kbd>tab</kbd> kind
          <span v-if="multiMode">· <kbd>space</kbd> toggle · <kbd>⌘↵</kbd> embed</span>
          <span v-else>· <kbd>↵</kbd> embed</span>
          · <kbd>m</kbd> {{ multiMode ? "exit multi" : "multi" }}
          · <kbd>esc</kbd> cancel
        </span>
        <span class="wp-picker__footer-spacer"></span>
        <button type="button" class="wp-picker__btn" @click="$emit('close')">Cancel</button>
        <button
          v-if="multiMode"
          type="button"
          class="wp-picker__btn wp-picker__btn--primary"
          :disabled="selected.size === 0 || embedding"
          data-testid="picker-embed-multi"
          @click="onEmbedSelected"
        >
          <i v-if="embedding" class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>{{ embedding ? "Embedding…" : `Embed ${selected.size}` }}</span>
        </button>
        <button
          type="button"
          class="wp-picker__btn wp-picker__btn--primary"
          data-test="picker-add-btn"
          :disabled="selected.size === 0"
          @click="commitAdd"
        ><i class="pi pi-plus" aria-hidden="true"></i> Add {{ selected.size }} {{ selected.size === 1 ? "module" : "modules" }}</button>
      </footer>
    </div>
  </ModalShell>
</template>

<script setup lang="ts">
/**
 * ModulePickerModal — Phase 5.5.4 library browser.
 *
 * Replaces the legacy "kind chooser" (which only knew about
 * fixed_values) with a real library browser: lists every module the
 * SPA returns from `/wp/api/modules/list`, lets the user filter by
 * kind + search, and emits picks back to the parent ContextWidget so
 * it can call `/wp/api/modules/embed-bundle` and store the resulting
 * snapshots in the workflow JSON.
 *
 * Pick flow:
 *   - Single-pick (default): click a row → emit `pick` with one uuid →
 *     close. Fastest path; matches the recommended UX.
 *   - Multi-pick (toggle in header): rows accumulate in a sticky
 *     selection drawer. "Embed N" emits all uuids at once.
 *
 * The picker DOES NOT call embed-bundle itself — that's the parent's
 * job, so the picker stays state-light and easy to test in isolation.
 *
 * Surfacing for non-wildcard kinds: post-5.5.6 every kind is
 * pickable. The runtime engine has handlers for all six kinds
 * (wildcard / fixed_values / combine / derivation / constraint /
 * pipeline) registered in `engine/modules/__init__.py`, so a
 * WP_Context graph node can run any mix. Rows still render disabled
 * when a row has no payload (broken library entry) — that's the only
 * remaining gate.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import ModalShell from "../shared/ModalShell.vue";

interface PickerModule {
  id: string;
  type: string;
  name: string;
  payload?: Record<string, unknown>;
  tags?: string[];
  is_favorite?: boolean;
  category_id?: string | null;
}

const props = defineProps<{
  visible: boolean;
  /**
   * Module ids already present in the host Context. When supplied,
   * the "hide already added" toggle filters them out of the list so
   * users browsing a big library can focus on net-new picks.
   */
  alreadyAdded?: string[];
}>();

const emit = defineEmits<{
  /** Single-pick or multi-pick result. Always an array, even for single. */
  (e: "pick", uuids: string[]): void;
  /** Checkbox-driven multi-select: emits array of selected ids when user clicks "Add N". */
  (e: "add", ids: string[]): void;
  (e: "close"): void;
}>();

interface CategoryRow {
  id: string;
  name: string;
}

// ── State ──────────────────────────────────────────────────────────
const modules = ref<PickerModule[]>([]);
const categories = ref<CategoryRow[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const embedding = ref(false);

const searchTerm = ref("");
const searchFocused = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const rootEl = ref<HTMLDivElement | null>(null);

const activeTab = ref<string | null>(null); // null = "All"
const multiMode = ref(false);
// Use reactive() so Vue can track .has()/.size/.add()/.delete()/.clear() individually
// (plain ref<Set> only tracks the ref's .value assignment, not Set mutations).
const selected = reactive<Set<string>>(new Set());

// ── Filters ────────────────────────────────────────────────────────
// Three orthogonal filters, all AND-combined with the kind tab +
// search box. None affect the data load — pure client-side narrowing
// over `modules`.
const favoritesOnly = ref(false);
const hideAlreadyAdded = ref(false);
const selectedTags = ref<Set<string>>(new Set());
const selectedCategoryId = ref<string | null>(null); // null = "any"
const filtersOpen = ref(false); // popover state for category + tags

/**
 * Count of filter dimensions currently active inside the popover
 * (category + tags). Drives the badge on the trigger button so
 * users see at-a-glance there's a hidden filter active without
 * opening the popover. Excludes the inline toggles
 * (favorites + hide-added) — those have their own visible state
 * via the icon-button's accent fill.
 */
const activePopoverCount = computed<number>(() => {
  let n = 0;
  if (selectedCategoryId.value !== null) n++;
  n += selectedTags.value.size;
  return n;
});

/**
 * Tags surfaced by the loaded library, deduped + sorted for the
 * filter chip row. We derive from the data instead of a hardcoded
 * list so the picker reflects whatever taxonomy the user has built
 * in the SPA library editor.
 */
const availableTags = computed<string[]>(() => {
  const set = new Set<string>();
  for (const m of modules.value) {
    if (Array.isArray(m.tags)) {
      for (const t of m.tags) {
        if (typeof t === "string" && t) set.add(t);
      }
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

/** Hide the favorites filter button when no row in the loaded
 *  library is favorited. Avoids a dead button on libraries that
 *  haven't adopted the feature. */
const hasFavoritesInData = computed<boolean>(() =>
  modules.value.some((m) => m.is_favorite),
);

function toggleTag(tag: string) {
  const next = new Set(selectedTags.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  selectedTags.value = next;
}

const hasActiveFilter = computed(() =>
  favoritesOnly.value
  || hideAlreadyAdded.value
  || selectedTags.value.size > 0
  || selectedCategoryId.value !== null
  || activeTab.value !== null
  || !!searchTerm.value.trim(),
);

function clearAllFilters() {
  favoritesOnly.value = false;
  hideAlreadyAdded.value = false;
  selectedTags.value = new Set();
  selectedCategoryId.value = null;
  activeTab.value = null;
  searchTerm.value = "";
}

/** Categories surfaced by the live library, deduped against
 *  modules that actually reference them so the dropdown doesn't
 *  list dead categories. Sorted alphabetically. */
const usedCategories = computed<CategoryRow[]>(() => {
  const used = new Set<string>();
  for (const m of modules.value) {
    if (typeof m.category_id === "string" && m.category_id) used.add(m.category_id);
  }
  return categories.value
    .filter((c) => used.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
});

// ── Loading ────────────────────────────────────────────────────────
async function reload() {
  loading.value = true;
  loadError.value = null;
  try {
    // Modules + categories in parallel. Categories failure is
    // non-fatal — the picker still works without category-name
    // resolution; the dropdown just wouldn't show. Modules failure
    // surfaces the error UI.
    const [modulesRes, categoriesRes] = await Promise.allSettled([
      fetch("/wp/api/modules", { credentials: "same-origin" }),
      fetch("/wp/api/categories", { credentials: "same-origin" }),
    ]);
    if (modulesRes.status === "rejected" || !modulesRes.value.ok) {
      const status = modulesRes.status === "fulfilled" ? modulesRes.value.status : "?";
      throw new Error(`Library load failed (HTTP ${status}).`);
    }
    const modulesJson = (await modulesRes.value.json()) as { items?: PickerModule[] };
    modules.value = (modulesJson.items ?? []).filter(
      (m): m is PickerModule => !!m && typeof m.id === "string",
    );
    if (categoriesRes.status === "fulfilled" && categoriesRes.value.ok) {
      const catJson = (await categoriesRes.value.json()) as { items?: CategoryRow[] };
      categories.value = (catJson.items ?? []).filter(
        (c): c is CategoryRow => !!c && typeof c.id === "string" && typeof c.name === "string",
      );
    } else {
      categories.value = [];
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    // Re-fetch each time the modal opens — library may have changed.
    void reload();
    // Reset transient UI state.
    selected.clear();
    searchTerm.value = "";
    activeTab.value = null;
    favoritesOnly.value = false;
    hideAlreadyAdded.value = false;
    selectedTags.value = new Set();
    selectedCategoryId.value = null;
    filtersOpen.value = false;
    embedding.value = false;
    void nextTick(() => searchInput.value?.focus());
  },
  { immediate: true },
);

onMounted(() => {
  if (props.visible) void reload();
});

// ── Derived ────────────────────────────────────────────────────────
const byId = computed(() => {
  const m = new Map<string, PickerModule>();
  for (const row of modules.value) m.set(row.id, row);
  return m;
});

interface KindTab {
  /** null = "All" tab. */
  value: string | null;
  label: string;
  icon: string | null;
}

// Pipeline kind is intentionally absent from the picker — the modal
// has no read-only preview for pipelines yet (deferred from 5.5.6
// pending cross-kind step lookup design), so embedding one would
// give the user no way to inspect it from the graph. Re-add the
// `pipeline` tab here when pipeline preview ships.
const tabs: KindTab[] = [
  { value: null,            label: "All",         icon: null },
  { value: "wildcard",      label: "Wildcards",   icon: "pi-th-large" },
  { value: "combine",       label: "Combines",    icon: "pi-share-alt" },
  { value: "derivation",    label: "Derivations", icon: "pi-code" },
  { value: "constraint",    label: "Constraints", icon: "pi-sitemap" },
  { value: "fixed_values",  label: "Fixed",       icon: "pi-tag" },
];

/** Pipelines are hidden from the picker until preview support ships
 *  (see `tabs` comment). Rows from this set never reach the visible
 *  list, so neither the tab list nor the "All" filter shows them.
 *  Also gates `isPickable` defensively for any path that bypasses the
 *  filter (e.g. future programmatic pick). */
const HIDDEN_KINDS = new Set<string>(["pipeline"]);

/** Modules visible to the picker. Excludes hidden kinds (pipeline at
 *  the moment) so they're absent from every tab — including "All" —
 *  AND from the kind-count badges. Library row is still in the DB
 *  and reachable via the SPA Manager; the picker just doesn't surface
 *  it for graph-side embed. */
const visibleModules = computed<PickerModule[]>(() =>
  modules.value.filter((m) => !HIDDEN_KINDS.has(m.type)),
);

function countFor(kind: string | null): number {
  if (kind === null) return visibleModules.value.length;
  return visibleModules.value.filter((m) => m.type === kind).length;
}

const alreadyAddedSet = computed<Set<string>>(() =>
  new Set(props.alreadyAdded ?? []),
);

const filteredModules = computed(() => {
  const q = searchTerm.value.trim().toLowerCase();
  const tagFilter = selectedTags.value;
  return visibleModules.value.filter((m) => {
    // Kind tab.
    if (activeTab.value !== null && m.type !== activeTab.value) return false;
    // Favorites toggle.
    if (favoritesOnly.value && !m.is_favorite) return false;
    // Hide-already-added toggle.
    if (hideAlreadyAdded.value && alreadyAddedSet.value.has(m.id)) return false;
    // Category dropdown.
    if (selectedCategoryId.value !== null && m.category_id !== selectedCategoryId.value) return false;
    // Tag chips — AND across selected tags so picking multiple
    // narrows progressively (matches how multi-tag taxonomies are
    // typically built — "show me modules that are BOTH `outfit`
    // AND `historical`").
    if (tagFilter.size > 0) {
      const tags = Array.isArray(m.tags) ? m.tags : [];
      for (const t of tagFilter) {
        if (!tags.includes(t)) return false;
      }
    }
    // Search box.
    if (!q) return true;
    if (m.name.toLowerCase().includes(q)) return true;
    if (m.id.toLowerCase().includes(q)) return true;
    // Match $var bindings on wildcards / combines so users can search by the
    // identifier they reference downstream, not just the display name.
    const p = (m.payload ?? {}) as { var_binding?: string; output_var?: string };
    if (p.var_binding && p.var_binding.toLowerCase().includes(q)) return true;
    if (p.output_var && p.output_var.toLowerCase().includes(q)) return true;
    // Tag substring match — useful when typing "warm" finds every
    // module tagged with `warm-tones` etc.
    if (Array.isArray(m.tags)) {
      for (const t of m.tags) {
        if (typeof t === "string" && t.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  });
});

const KIND_ORDER = ["wildcard", "combine", "derivation", "constraint", "pipeline", "fixed_values"];
const groupedFiltered = computed<{ kind: string; items: PickerModule[] }[]>(() => {
  const groups: Record<string, PickerModule[]> = {};
  for (const m of filteredModules.value) (groups[m.type] ??= []).push(m);
  return KIND_ORDER
    .filter((k) => groups[k]?.length)
    .map((k) => ({
      kind: k,
      items: [...groups[k]].sort((a, b) => a.name.localeCompare(b.name)),
    }));
});

// ── Display helpers ────────────────────────────────────────────────
function kindIcon(kind: string): string {
  switch (kind) {
    case "wildcard":     return "pi-th-large";
    case "combine":      return "pi-share-alt";
    case "derivation":   return "pi-code";
    case "constraint":   return "pi-sitemap";
    case "pipeline":     return "pi-list";
    case "fixed_values": return "pi-tag";
    default:             return "pi-circle";
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "wildcard":     return "Wildcards";
    case "combine":      return "Combines";
    case "derivation":   return "Derivations";
    case "constraint":   return "Constraints";
    case "pipeline":     return "Pipelines";
    case "fixed_values": return "Fixed values";
    default:             return kind;
  }
}

function shortUuid(id: string): string {
  // ids look like `wc_outfit_a1b2c3d4`; surface just the trailing 8 hex
  // when present, else show the full id (legacy / non-standard ids).
  const m = /_([0-9a-f]{8})$/.exec(id);
  return m ? m[1] : id;
}

function subtitleFor(m: PickerModule): string {
  const p = (m.payload ?? {}) as Record<string, unknown>;
  switch (m.type) {
    case "wildcard": {
      const binding = (p.var_binding as string)?.trim();
      const opts = (p.options as unknown[])?.length ?? 0;
      return `${binding ? `$${binding}` : "wildcard"}${opts ? ` · ${opts} options` : ""}`;
    }
    case "combine": {
      const out = (p.output_var as string)?.trim();
      return out ? `→ $${out}` : "template";
    }
    case "derivation": {
      const rules = (p.rules as unknown[])?.length ?? 0;
      return `${rules} rule${rules === 1 ? "" : "s"}`;
    }
    case "constraint":   return "constraint matrix";
    case "pipeline":     return `${(p.steps as unknown[])?.length ?? 0} steps`;
    case "fixed_values": return `${(p.values as unknown[])?.length ?? 0} vars`;
    default:             return m.type;
  }
}

// ── Pickability gate ───────────────────────────────────────────────
//
// Defensive guard against bad rows. The visible list is already
// pre-filtered to exclude `HIDDEN_KINDS` (pipeline) at the
// `visibleModules` step, so non-pipeline rows reaching this function
// only fail the gate when their `payload` is falsy (broken library
// entry). Pipeline kept here too as belt-and-braces in case any
// future code path bypasses `visibleModules`.
function isPickable(m: PickerModule): boolean {
  if (!m.payload) return false;
  if (HIDDEN_KINDS.has(m.type)) return false;
  return true;
}

// ── Click handlers ─────────────────────────────────────────────────
function toggleMulti() {
  multiMode.value = !multiMode.value;
  if (!multiMode.value) selected.clear();
}

function onRowClick(m: PickerModule) {
  if (!isPickable(m)) return;
  // Checkbox-driven multi-select: clicking any row toggles its checkbox.
  // Single-click-add is replaced by the "Add N" footer button.
  if (selected.has(m.id)) selected.delete(m.id);
  else selected.add(m.id);
}

function onEmbedSelected() {
  if (selected.size === 0) return;
  embedding.value = true;
  emit("pick", [...selected]);
}

/** Checkbox-driven multi-select commit: emit `add` with all selected ids. */
function commitAdd() {
  emit("add", [...selected]);
  selected.clear();
}

// ── Keyboard navigation ───────────────────────────────────────────
//
// Arrow keys walk the focusable, pickable rows; the first ArrowDown
// from the search input drops focus onto the first row, ArrowUp from
// the first row jumps back. Enter on a focused row is handled by the
// native `<button>` activation (= row click), so we only need to
// special-case the multi-pick "embed all" shortcut (Cmd/Ctrl+Enter).
//
// Disabled rows (non-wildcard kinds in 5.5.4) are skipped — the
// `:disabled` attribute already excludes them from the focus walk
// because we only target rows that are NOT disabled.
function getRowButtons(): HTMLButtonElement[] {
  if (!rootEl.value) return [];
  const all = rootEl.value.querySelectorAll<HTMLButtonElement>(
    ".wp-picker__row:not([disabled])",
  );
  return Array.from(all);
}

function getKindTabs(): HTMLButtonElement[] {
  if (!rootEl.value) return [];
  return Array.from(rootEl.value.querySelectorAll<HTMLButtonElement>(".wp-picker__tab"));
}

// ── Capture-phase key isolation ───────────────────────────────────
//
// ComfyUI registers its canvas hotkeys (Q queue, R refresh, F fit,
// M model picker, Space pan, …) at the document/window level in
// *capture phase*. A bubble-phase listener on the modal root would
// run AFTER ComfyUI's handler — too late: the event has already
// fired the canvas shortcut. So we install our own capture-phase
// listener on `window` while the picker is open and
// stopImmediatePropagation any key whose target is inside our
// modal (or moving toward it).
//
// We DO scope by target now. An earlier rev intentionally swallowed
// every key globally because clicking an inert area inside the
// modal sometimes moved focus to `document.body`, so the next key
// failed `rootEl.contains(target)` and ComfyUI's hotkey fired. The
// problem with the global swallow: while the picker stays open
// (e.g. the user clicked elsewhere on the canvas — picker visible
// but not focused), every keystroke including ones aimed at the
// PromptAssembler textarea got eaten. The fix here keeps the
// per-target check — and on click of an inert modal area we
// proactively re-focus the rootEl below so subsequent keys stay
// rooted in the modal.
function isInsideModal(target: EventTarget | null): boolean {
  if (!rootEl.value || !(target instanceof Node)) return false;
  return rootEl.value.contains(target);
}

function captureKeyDown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (!isInsideModal(e.target)) return;

  // Stop ComfyUI's capture-phase listeners from seeing this key at
  // all. stopImmediatePropagation also short-circuits any sibling
  // capture listeners attached on `window` itself.
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === "function") {
    e.stopImmediatePropagation();
  }

  // Now drive our own picker keybinds.

  if (e.key === "Escape") {
    e.preventDefault();
    emit("close");
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    if (multiMode.value && selected.size > 0) {
      e.preventDefault();
      onEmbedSelected();
    }
    return;
  }

  // Tab cycles through the kind tabs ONLY (per user UX request).
  // Forward = next tab, Shift+Tab = previous, both wrap. Pressing
  // Tab from any focus inside the picker lands on the next kind
  // tab — the rest of the modal's focusable elements stop sharing
  // the Tab cycle. Activation still requires Enter/Space on the
  // focused tab (native button behavior).
  if (e.key === "Tab") {
    const tabs = getKindTabs();
    if (tabs.length === 0) return;
    e.preventDefault();
    const currentIdx = tabs.findIndex((t) => t === document.activeElement);
    let nextIdx: number;
    if (e.shiftKey) {
      nextIdx = currentIdx <= 0 ? tabs.length - 1 : currentIdx - 1;
    } else {
      nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % tabs.length;
    }
    tabs[nextIdx].focus();
    return;
  }

  const target = e.target as HTMLElement | null;
  const inSearch = target === searchInput.value;

  // `m` toggles multi-pick mode — but only when the search input is
  // NOT focused (so users can still type the letter "m" to filter).
  // Any modifier disqualifies (avoids stealing Cmd+M / Alt+M from
  // the host).
  if (
    e.key === "m" &&
    !inSearch &&
    !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
  ) {
    e.preventDefault();
    toggleMulti();
    return;
  }

  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

  const rows = getRowButtons();
  if (rows.length === 0) return;

  if (inSearch) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rows[0].focus();
    }
    return;
  }

  const idx = rows.findIndex((r) => r === target);
  if (idx !== -1) {
    e.preventDefault();
    if (e.key === "ArrowDown") {
      if (idx === rows.length - 1) return;
      rows[idx + 1].focus();
    } else {
      if (idx === 0) {
        searchInput.value?.focus();
        return;
      }
      rows[idx - 1].focus();
    }
    return;
  }

  // Focus on Multi toggle / close button / footer button: drop into
  // the list.
  e.preventDefault();
  if (e.key === "ArrowDown") rows[0].focus();
  else rows[rows.length - 1].focus();
}

function captureKeyOther(e: KeyboardEvent) {
  // keyup / keypress: silence them too while the user is operating
  // inside the modal so ComfyUI shortcuts that bind on keyup (e.g.
  // Space release for canvas pan) don't fire. Scoped by target same
  // as keydown — leaves other widgets' keystrokes alone.
  if (!props.visible) return;
  if (!isInsideModal(e.target)) return;
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === "function") {
    e.stopImmediatePropagation();
  }
}

// Keep focus rooted inside the modal when the user clicks inert
// areas (padding, body bottom, modal frame). Without this the
// browser would drop focus to document.body, and the next key
// would fail `isInsideModal(e.target)` and let a ComfyUI hotkey
// fire instead.
function captureModalClick(e: MouseEvent) {
  if (!props.visible) return;
  if (!isInsideModal(e.target)) return;
  const t = e.target as HTMLElement | null;
  // If the click landed on a focusable control, let the native
  // focus management run.
  if (t && (t.matches?.("input, textarea, button, [tabindex], [contenteditable=true]"))) {
    return;
  }
  // Otherwise pull focus back to the modal root so subsequent
  // keystrokes still resolve to a target inside the modal.
  rootEl.value?.focus();
}

function attachCaptureListeners() {
  window.addEventListener("keydown", captureKeyDown, { capture: true });
  window.addEventListener("keyup", captureKeyOther, { capture: true });
  window.addEventListener("keypress", captureKeyOther, { capture: true });
  window.addEventListener("mousedown", captureModalClick, { capture: true });
}

function detachCaptureListeners() {
  window.removeEventListener("keydown", captureKeyDown, { capture: true });
  window.removeEventListener("keyup", captureKeyOther, { capture: true });
  window.removeEventListener("keypress", captureKeyOther, { capture: true });
  window.removeEventListener("mousedown", captureModalClick, { capture: true });
}

watch(
  () => props.visible,
  (v) => {
    if (v) attachCaptureListeners();
    else detachCaptureListeners();
  },
);

onBeforeUnmount(detachCaptureListeners);
</script>

<style scoped>
/* Tokens via global tokens.css. Keep selectors prefixed `wp-picker__`
 * so this component never collides with SPA Manager classes. */

.wp-picker {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius-lg);
  box-shadow: var(--wp-shadow-lg);
  width: 720px;
  max-width: calc(100vw - 32px);
  height: 600px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
  overflow: hidden;
  font-family: var(--wp-font);
}

/* ── Header ──────────────────────────────────────────────────────── */
.wp-picker__head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wp-border);
}
.wp-picker__head-text { flex: 1; min-width: 0; }
.wp-picker__eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-muted);
  font-weight: 600;
  display: flex; align-items: center; gap: 8px;
}
.wp-picker__eyebrow-tag {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--wp-accent-text);
  background: rgba(139, 92, 246, 0.16);
  border: 1px solid rgba(139, 92, 246, 0.36);
  padding: 1px 5px;
  border-radius: 999px;
}
.wp-picker__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wp-text);
  margin-top: 1px;
}
.wp-picker__title-detail {
  font-size: 11.5px;
  color: var(--wp-text-dim);
  margin-left: 6px;
  font-weight: 400;
}
.wp-picker__multi-toggle {
  height: 26px;
  padding: 0 10px;
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 500;
  font-family: inherit;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.wp-picker__multi-toggle:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border-strong);
}
.wp-picker__multi-toggle[data-active] {
  background: rgba(139, 92, 246, 0.16);
  border-color: rgba(139, 92, 246, 0.5);
  color: var(--wp-accent-text-strong, var(--wp-accent-text));
}
.wp-picker__multi-toggle:focus-visible {
  outline: none;
  border-color: var(--wp-accent-500);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 25%, transparent);
}
.wp-picker__multi-toggle .pi { font-size: 10px; }

.wp-picker__close {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--wp-text-muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.wp-picker__close:hover { background: var(--wp-bg-3); color: var(--wp-text); }
.wp-picker__close:focus-visible {
  outline: none;
  border-color: var(--wp-accent-500);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 25%, transparent);
}
.wp-picker__close .pi { font-size: 11px; }

/* ── Toolbar ─────────────────────────────────────────────────────── */
.wp-picker__toolbar {
  padding: 10px 16px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Top row of the toolbar — search box + inline filter icon
 * buttons + popover trigger all on a single line. Search flexes to
 * eat remaining space; icon buttons stay 30 by 30 fixed. */
.wp-picker__toolbar-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-picker__toolbar-top > .wp-picker__search { flex: 1; min-width: 0; }
.wp-picker__search {
  position: relative;
  height: 28px;
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  display: flex; align-items: center;
  padding: 0 8px;
  gap: 6px;
  transition: border-color 120ms ease, background 120ms ease;
}
.wp-picker__search.is-focused,
.wp-picker__search:focus-within {
  border-color: var(--wp-accent-500);
  background: var(--wp-bg-2);
}
.wp-picker__search-icon { font-size: 11px; color: var(--wp-text-dim); flex-shrink: 0; }
.wp-picker__search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--wp-text);
  font-size: 12px;
  font-family: var(--wp-font);
}
.wp-picker__search input::placeholder { color: var(--wp-text-dim); }
.wp-picker__search-clear {
  cursor: pointer;
  color: var(--wp-text-dim);
  font-size: 10px;
  padding: 2px;
  border-radius: 999px;
  transition: color 120ms ease;
}
.wp-picker__search-clear:hover { color: var(--wp-text); }

.wp-picker__tabs {
  /* Wrap rather than overflow — a horizontal scrollbar inside a modal
   * is unfriendly. At 720px width the 7 tabs fit comfortably on one
   * row; if they don't (translated labels, narrower modal) they drop
   * to a second row instead of hiding behind a scroll affordance. */
  display: flex; gap: 4px 6px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--wp-border);
  margin: 0 -16px;
  padding: 0 16px;
}
.wp-picker__tab {
  height: 30px;
  padding: 0 8px;
  display: inline-flex; align-items: center; gap: 5px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 500;
  font-family: inherit;
  letter-spacing: 0.02em;
  white-space: nowrap;
  transition: color 120ms ease, border-color 120ms ease;
}
.wp-picker__tab:hover { color: var(--wp-text); }
.wp-picker__tab[data-active] {
  color: var(--wp-text);
  border-bottom-color: var(--wp-accent-500);
}
.wp-picker__tab:focus-visible {
  /* Subtle filled pill behind the underline so the keyboard focus
   * reads as "this is the one Tab landed on" without competing with
   * the active-state underline. The shadow uses the same accent
   * recipe the SPA's `.wp-input:focus` convention uses. */
  outline: none;
  color: var(--wp-text);
  background: color-mix(in oklab, var(--wp-accent-500) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-accent-500) 38%, transparent);
  border-radius: 4px;
}
.wp-picker__tab-icon { font-size: 10px; }
.wp-picker__tab-count {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  background: var(--wp-bg-3);
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid var(--wp-border);
}

/* ── Body / list ─────────────────────────────────────────────────── */
.wp-picker__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 8px;
}
.wp-picker__body::-webkit-scrollbar { width: 8px; }
.wp-picker__body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.08); border-radius: 999px; }

.wp-picker__state {
  padding: 32px 16px;
  text-align: center;
  color: var(--wp-text-muted);
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.wp-picker__state .pi { font-size: 18px; color: var(--wp-text-dim); }
.wp-picker__state--error { color: #fca5a5; }
.wp-picker__retry {
  margin-top: 8px;
  height: 28px;
  padding: 0 12px;
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  color: var(--wp-text);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.wp-picker__retry:hover { background: var(--wp-bg-4); }

.wp-picker__section-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 8px 4px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--wp-text-dim);
}
.wp-picker__section-line { flex: 1; height: 1px; background: var(--wp-border); }
.wp-picker__section-count {
  font-family: var(--wp-font-mono);
  color: var(--wp-text-dim);
  font-size: 10px;
  letter-spacing: 0;
  text-transform: none;
}

.wp-picker__row {
  /* Checkbox-driven multi-select: always 4 cols —
   * checkbox | icon | main | uuid. The checkbox (18px) is always
   * rendered so the grid is always 4-column. */
  display: grid;
  grid-template-columns: 18px 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 8px;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: var(--wp-text);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 100ms ease;
}
/* [data-multi] no longer changes the column layout — checkbox is always present. */
.wp-picker__row:hover { background: var(--wp-bg-3); }
.wp-picker__row:focus-visible {
  /* Keyboard focus. The SPA's outset accent halo
   * (`box-shadow: 0 0 0 3px ... 25% transparent`) clips against
   * neighbour rows in this flush list — kept inset instead so the
   * highlight stays inside the row's own bounds. Bright 1.5px accent
   * stroke + slight bg lift — distinguishable from hover (bg only)
   * and from data-checked (purple-tinted bg + low-op stroke). */
  outline: none;
  background: var(--wp-bg-3);
  box-shadow: inset 0 0 0 1.5px var(--wp-accent-500);
}
.wp-picker__row[data-checked]:focus-visible {
  /* Selected + focused: keep the purple tint of the checked state
   * but swap the low-opacity ring for the bright focus stroke. */
  background: rgba(139, 92, 246, 0.18);
  box-shadow: inset 0 0 0 1.5px var(--wp-accent-500);
}
.wp-picker__row[data-checked] {
  background: rgba(139, 92, 246, 0.12);
  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.42);
}
.wp-picker__row[data-disabled] {
  cursor: not-allowed;
  opacity: 0.42;
}
.wp-picker__row[data-disabled]:hover { background: transparent; }

/* multi-mode: row gets a checkbox column on the left.
 * single-mode: the checkbox column collapses (auto width with no element). */
.wp-picker__check {
  width: 16px; height: 16px;
  border: 1.4px solid var(--wp-border-strong);
  border-radius: 4px;
  background: var(--wp-bg-3);
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: background 120ms ease, border-color 120ms ease;
}
.wp-picker__check .pi {
  font-size: 9px;
  color: #fff;
}
.wp-picker__row[data-checked] .wp-picker__check,
.wp-picker__check.on {
  background: var(--wp-accent-600);
  border-color: var(--wp-accent-500);
}

.wp-picker__row-icon {
  width: 22px; height: 22px;
  border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.wp-picker__row-icon .pi { font-size: 10px; }
.wp-picker__row-icon[data-kind="wildcard"]    { background: rgba(167,139,250,0.14); color: var(--wp-kind-wildcard); }
.wp-picker__row-icon[data-kind="combine"]     { background: rgba(52,211,153,0.14);  color: var(--wp-kind-combine); }
.wp-picker__row-icon[data-kind="derivation"]  { background: rgba(251,191,36,0.14);  color: var(--wp-kind-derivation); }
.wp-picker__row-icon[data-kind="constraint"]  { background: rgba(244,114,182,0.14); color: var(--wp-kind-constraint); }
.wp-picker__row-icon[data-kind="pipeline"]    { background: rgba(251,113,133,0.14); color: var(--wp-kind-pipeline); }
.wp-picker__row-icon[data-kind="fixed_values"]{ background: rgba(34,211,238,0.14);  color: var(--wp-kind-fixed); }

.wp-picker__row-main {
  display: flex; align-items: baseline; gap: 8px;
  min-width: 0;
}
.wp-picker__row-name {
  /* Take remaining space + min-width:0 so flex shrink + ellipsis work
   * (children of a flex container don't shrink below their text's
   * natural width without an explicit `min-width: 0` override). */
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wp-picker__row-var {
  /* Hold natural width; cap so a long subtitle can't push the name
   * into a 1-character ellipsis. */
  flex: 0 0 auto;
  max-width: 50%;
  font-family: var(--wp-font-mono);
  font-size: 11px;
  color: var(--wp-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wp-picker__row-uuid {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Selection drawer ────────────────────────────────────────────── */
.wp-picker__selection {
  background: var(--wp-bg-1);
  border-top: 1px solid var(--wp-accent-600);
  padding: 10px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.wp-picker__selection-top {
  display: flex; align-items: center; gap: 10px;
}
.wp-picker__selection-count {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--wp-accent-text);
}
.wp-picker__selection-count strong {
  font-family: var(--wp-font-mono);
  color: #fff;
  background: var(--wp-accent-600);
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  margin-right: 4px;
}
.wp-picker__selection-spacer { flex: 1; }
.wp-picker__selection-clear {
  background: transparent;
  border: none;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 11.5px;
  font-family: inherit;
  padding: 2px 6px;
  border-radius: 4px;
}
.wp-picker__selection-clear:hover { color: var(--wp-text); background: var(--wp-bg-3); }

.wp-picker__selection-chips {
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
}
.wp-picker__sel-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 22px;
  padding: 0 4px 0 8px;
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border-strong);
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--wp-text);
  font-weight: 500;
  max-width: 200px;
}
.wp-picker__sel-dot {
  width: 7px; height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
.wp-picker__sel-chip[data-kind="wildcard"]    .wp-picker__sel-dot { background: var(--wp-kind-wildcard); }
.wp-picker__sel-chip[data-kind="combine"]     .wp-picker__sel-dot { background: var(--wp-kind-combine); }
.wp-picker__sel-chip[data-kind="derivation"]  .wp-picker__sel-dot { background: var(--wp-kind-derivation); }
.wp-picker__sel-chip[data-kind="constraint"]  .wp-picker__sel-dot { background: var(--wp-kind-constraint); }
.wp-picker__sel-chip[data-kind="pipeline"]    .wp-picker__sel-dot { background: var(--wp-kind-pipeline); }
.wp-picker__sel-chip[data-kind="fixed_values"] .wp-picker__sel-dot { background: var(--wp-kind-fixed); }
.wp-picker__sel-close {
  width: 16px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  border: none;
  background: transparent;
  color: var(--wp-text-dim);
  cursor: pointer;
  border-radius: 999px;
}
.wp-picker__sel-close:hover { background: var(--wp-bg-4); color: var(--wp-text); }
.wp-picker__sel-close .pi { font-size: 8px; }

/* ── Footer ──────────────────────────────────────────────────────── */
.wp-picker__footer {
  height: 44px;
  padding: 0 16px;
  display: flex; align-items: center; gap: 10px;
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  color: var(--wp-text-dim);
  font-size: 11px;
}
.wp-picker__hint { color: var(--wp-text-muted); }
.wp-picker__hint kbd {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  border-radius: 4px;
  padding: 1px 5px;
  margin: 0 1px;
}
.wp-picker__footer-spacer { flex: 1; }
.wp-picker__btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-3);
  color: var(--wp-text);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: background 120ms ease, border-color 120ms ease;
}
.wp-picker__btn:hover:not(:disabled) {
  background: var(--wp-bg-4);
  border-color: var(--wp-border-strong);
}
.wp-picker__btn:focus-visible {
  outline: none;
  border-color: var(--wp-accent-500);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 25%, transparent);
}
.wp-picker__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wp-picker__btn--primary {
  background: var(--wp-accent-600);
  border-color: var(--wp-accent-500);
  color: #fff;
}
.wp-picker__btn--primary:hover:not(:disabled) { background: var(--wp-accent-500); }
.wp-picker__btn--primary:focus-visible {
  /* Already on-accent; brighten the halo a notch so the ring is
   * visible against the violet body. */
  border-color: var(--wp-accent-300);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-300) 35%, transparent);
}

/* ── Inline filter buttons (toolbar) ────────────────────────────
 * Square icon buttons sitting next to the search box. Off = ghost
 * outline + muted icon; on = accent fill. Match the visual weight
 * of the kind tabs so the toolbar reads as one cohesive row. */
.wp-picker__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  /* Match search-box height (28px) so the toolbar row aligns. */
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  color: var(--wp-text3);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  flex-shrink: 0;
}
.wp-picker__icon-btn:hover {
  color: var(--wp-text);
  border-color: var(--wp-border2);
}
.wp-picker__icon-btn--active {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
}
.wp-picker__icon-btn--active:hover { filter: brightness(1.1); color: #fff; }
.wp-picker__icon-btn .pi { font-size: 12px; }

/* Filter-trigger badge — small pill in the corner showing how many
 * dimensions inside the popover are active. */
.wp-picker__filter-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--wp-amber, #ffd400);
  color: #000;
  font-family: var(--wp-font-mono, monospace);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}

/* ── Filters popover ────────────────────────────────────────────
 * Anchored under the trigger button. Sits inside the modal at
 * z-index above body but below the click-shield's covered area.
 * Tags + category live here so a 50-tag library doesn't crowd
 * the toolbar. */
.wp-picker__filters-pop {
  position: relative;
  display: inline-flex;
}
.wp-picker__pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 10;
  min-width: 280px;
  max-width: 360px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wp-picker__pop-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-picker__pop-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 9px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3);
  letter-spacing: 0.08em;
  font-weight: 600;
}
.wp-picker__pop-label-hint {
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--wp-text3);
  font-style: italic;
  text-transform: none;
}
.wp-picker__pop-clear {
  background: none;
  border: 1px dashed var(--wp-border2);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  cursor: pointer;
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  padding: 5px 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.wp-picker__pop-clear:hover {
  color: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-picker__pop-clear .pi { font-size: 10px; }

/* Click-shield — covers the rest of the modal so a click outside
 * the popover closes it. Transparent. Excluded from the popover's
 * own area via z-index ordering (popover is z:10, shield is z:5). */
.wp-picker__pop-shield {
  position: absolute;
  inset: 0;
  z-index: 5;
}

/* Pop animation — quick scale + fade so the panel doesn't pop
 * abruptly. Origin at top-right anchors the open animation toward
 * the trigger. */
.wp-pop-enter-active,
.wp-pop-leave-active {
  transition: opacity 0.12s, transform 0.12s;
  transform-origin: top right;
}
.wp-pop-enter-from,
.wp-pop-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-2px);
}

/* Tag chips inside popover (same visual as before, just in a
 * tighter container). */
.wp-picker__tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  color: var(--wp-text3);
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 2px 8px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.wp-picker__tag-chip:hover {
  color: var(--wp-text);
  border-color: var(--wp-border2);
}
.wp-picker__tag-chip--active {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  border-color: var(--wp-accent);
  color: var(--wp-accent);
}
.wp-picker__tag-chip--active:hover {
  background: color-mix(in srgb, var(--wp-accent) 28%, transparent);
  color: var(--wp-accent2, var(--wp-accent));
}

.wp-picker__filter-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  /* Tag panel scrolls vertically inside the popover when the
   * library has too many tags — keeps popover height bounded. */
  max-height: 200px;
  overflow-y: auto;
}

/* Category dropdown — same chrome as before but full-width inside
 * the popover panel. Hide native browser arrow + draw our own. */
.wp-picker__filter-cat-select {
  width: 100%;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  padding: 5px 22px 5px 8px;
  cursor: pointer;
  outline: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
                    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 12px) 50%, calc(100% - 7px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.wp-picker__filter-cat-select:focus { border-color: var(--wp-accent); }
.wp-picker__filter-cat-select option {
  background: var(--wp-bg2);
  color: var(--wp-text);
}
</style>
