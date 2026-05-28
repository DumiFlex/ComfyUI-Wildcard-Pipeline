<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon, { ICON_SM } from "../components/ui/Icon.vue";
import { useUiStore } from "../stores/uiStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import { GITHUB_REPO, GITHUB_WIKI } from "../config/links";

interface NavItem {
  id: string;
  label: string;
  icon: string;
  to?: string;
  url?: string;
  /** Nested children — when present, the item renders as a
   *  collapsible parent (chevron + click toggles). Sakai-vue style. */
  children?: NavItem[];
}
interface NavSection {
  label: string;
  items: NavItem[];
}

const ui = useUiStore();
const router = useRouter();
const route = useRoute();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const templateStore = useTemplateStore();
const categoryStore = useCategoryStore();

const SECTIONS: NavSection[] = [
  {
    label: "Home",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "pi-home",             to: "/dashboard" },
      { id: "all",       label: "All items", icon: "pi-objects-column",   to: "/all" },
    ],
  },
  {
    label: "Modules",
    items: [
      { id: "wildcards",   label: "Wildcards",    icon: "pi-sparkles",   to: "/wildcards"     },
      { id: "fixed",       label: "Fixed Values", icon: "pi-tag",        to: "/fixed-values"  },
      { id: "combines",    label: "Combines",     icon: "pi-link",  to: "/combines"      },
      { id: "derivations", label: "Derivations",  icon: "pi-arrow-right-arrow-left",       to: "/derivations"   },
      { id: "constraints", label: "Constraints",  icon: "pi-filter",    to: "/constraints"   },
      { id: "bundles",     label: "Bundles",      icon: "pi-box",        to: "/bundles"       },
    ],
  },
  {
    label: "Library",
    items: [
      { id: "templates",  label: "Templates",       icon: "pi-file-edit",                to: "/templates"      },
      { id: "categories", label: "Categories",      icon: "pi-bookmark",                 to: "/categories"     },
      { id: "io",         label: "Import / Export", icon: "pi-arrow-right-arrow-left",   to: "/import-export"  },
      { id: "test",       label: "Test Runner",     icon: "pi-bolt",                     to: "/test"           },
    ],
  },
  {
    label: "Get Started",
    items: [
      { id: "community",     label: "Community",     icon: "pi-globe",         to: "/community" },
      { id: "documentation", label: "Documentation", icon: "pi-book",          to: "/docs" },
      { id: "_wiki",         label: "Wiki",          icon: "pi-external-link",  url: GITHUB_WIKI },
      { id: "_source",       label: "View Source",   icon: "pi-github",         url: GITHUB_REPO },
    ],
  },
];

/** Sidebar item id derived from current route name. Matches prototype mapping. */
const activeId = computed<string>(() => {
  const name = typeof route.name === "string" ? route.name : "";
  const path = route.path || "";

  // Editor route names start with the singular kind, e.g. `wildcards-edit`.
  // We treat any route name that starts with a kind prefix as that kind active.
  const KIND_BY_PREFIX: Array<[string, string]> = [
    ["wildcards", "wildcards"],
    ["fixed-values", "fixed"],
    ["combines", "combines"],
    ["derivations", "derivations"],
    ["constraints", "constraints"],
    ["bundles", "bundles"],
    ["templates", "templates"],
    ["categories", "categories"],
    ["import-export", "io"],
    ["test", "test"],
    ["documentation", "documentation"],
    ["dashboard", "dashboard"],
    ["all", "all"],
  ];
  for (const [prefix, id] of KIND_BY_PREFIX) {
    if (name === prefix || name.startsWith(`${prefix}-`)) return id;
  }

  if (path.startsWith("/community")) return "community";
  return "";
});

/** Parents that the user has explicitly opened, OR that contain the
 *  currently-active child route. Tracked as a Set so multiple parents
 *  can be open at once. */
const expandedParents = ref<Set<string>>(new Set());

/** Walk a parent's children + check if any matches `activeId`. */
function hasActiveChild(parent: NavItem): boolean {
  if (!parent.children) return false;
  return parent.children.some((c) => c.id === activeId.value);
}

/** Auto-expand any parent whose child is active. Runs on route change
 *  via `activeId` (which is route-derived). User can still collapse
 *  manually — `toggleParent` mutates the same set. */
watch(activeId, () => {
  for (const section of SECTIONS) {
    for (const item of section.items) {
      if (item.children && hasActiveChild(item)) {
        expandedParents.value.add(item.id);
      }
    }
  }
}, { immediate: true });

function isParentExpanded(item: NavItem): boolean {
  return expandedParents.value.has(item.id);
}

function toggleParent(item: NavItem) {
  const next = new Set(expandedParents.value);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  expandedParents.value = next;
}

function onItemClick(item: NavItem) {
  if (item.url) return; // anchor handles external nav
  if (item.children?.length) {
    // Parent click: navigate to the parent route if it has one AND
    // also toggle the expand state so the child list reveals.
    if (item.to) router.push(item.to);
    toggleParent(item);
    return;
  }
  if (item.to) router.push(item.to);
}

// ── Task 9: Search-within ─────────────────────────────────────────────────
const searchQuery = ref("");

const filteredSections = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return SECTIONS;
  return SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => i.label.toLowerCase().includes(q)),
  })).filter((s) => s.items.length > 0);
});

function onSearchKey(e: KeyboardEvent): void {
  if (e.key === "Escape") searchQuery.value = "";
}

// ── Task 10: Per-kind count badges ────────────────────────────────────────
const countByKey = computed<Record<string, number>>(() => {
  const all = moduleStore.catalog;
  return {
    wildcards:   all.filter((m) => m.type === "wildcard").length,
    fixed:       all.filter((m) => m.type === "fixed_values").length,
    combines:    all.filter((m) => m.type === "combine").length,
    derivations: all.filter((m) => m.type === "derivation").length,
    constraints: all.filter((m) => m.type === "constraint").length,
    bundles:     bundleStore.catalog.length,
    templates:   templateStore.catalog.length,
    categories:  categoryStore.items.length,
  };
});

// Recents section moved to Dashboard. See Dashboard.vue tabs.
</script>

<template>
  <nav class="wp-sidebar" :data-collapsed="ui.sidebarCollapsed || undefined">
    <!-- Task 9: Search input — hidden in collapsed mode -->
    <div v-if="!ui.sidebarCollapsed" class="wp-sidebar__search">
      <Icon name="pi-search" :size="12" />
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Filter nav…"
        class="wp-sidebar__search-input"
        aria-label="Filter sidebar nav"
        @keydown="onSearchKey"
      />
    </div>

    <template v-for="section in filteredSections" :key="section.label">
      <div v-if="!ui.sidebarCollapsed" class="wp-sidebar__section">
        {{ section.label }}
      </div>
      <div v-else class="wp-sidebar__spacer" aria-hidden="true" />

      <template v-for="item in section.items" :key="item.id">
        <!-- External link — renders as plain anchor, no nesting. -->
        <a
          v-if="item.url"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          class="wp-nav"
          :title="ui.sidebarCollapsed ? item.label : undefined"
          :style="ui.sidebarCollapsed ? { justifyContent: 'center' } : undefined"
        >
          <span class="wp-nav__icon"><Icon :name="item.icon" /></span>
          <span v-if="!ui.sidebarCollapsed" class="wp-nav__label">{{ item.label }}</span>
          <Icon v-if="!ui.sidebarCollapsed" name="pi-external-link" class="wp-nav__ext" :size="ICON_SM" />
        </a>

        <!-- Parent with children — chevron + click toggles. The
             parent route still navigates on click so users get the
             dashboard view AND see the submenu reveal. -->
        <template v-else-if="item.children?.length">
          <button
            type="button"
            class="wp-nav wp-nav--parent"
            :data-active="activeId === item.id || undefined"
            :data-nav-id="item.id"
            :data-expanded="isParentExpanded(item) || undefined"
            :title="ui.sidebarCollapsed ? item.label : undefined"
            :style="ui.sidebarCollapsed ? { justifyContent: 'center' } : undefined"
            :aria-expanded="isParentExpanded(item)"
            @click="onItemClick(item)"
          >
            <span class="wp-nav__icon"><Icon :name="item.icon" /></span>
            <span v-if="!ui.sidebarCollapsed" class="wp-nav__label">{{ item.label }}</span>
            <!-- Was 9px historically (very subordinate); promoted to ICON_SM (12)
                 so the caret reads at the same weight as wp-text-sm in the row.
                 If the caret needs to feel subordinate, lower opacity rather
                 than reverting size. -->
            <Icon
              v-if="!ui.sidebarCollapsed"
              name="pi-chevron-right"
              class="wp-nav__caret"
              :size="ICON_SM"
            />
          </button>
          <!-- Children rendered only when sidebar is expanded AND
               the parent is open. Collapsed-sidebar mode hides the
               submenu entirely (icon-only sidebar has no room for
               an indented label column); users can still click the
               parent icon to jump to the dashboard. -->
          <div
            v-if="!ui.sidebarCollapsed && isParentExpanded(item)"
            class="wp-nav__children"
          >
            <button
              v-for="child in item.children" :key="child.id"
              type="button"
              class="wp-nav wp-nav--child"
              :data-active="activeId === child.id || undefined"
              :data-nav-id="child.id"
              @click="onItemClick(child)"
            >
              <span class="wp-nav__icon"><Icon :name="child.icon" /></span>
              <span class="wp-nav__label">{{ child.label }}</span>
            </button>
          </div>
        </template>

        <!-- Leaf item — single navigation button, no nesting. -->
        <button
          v-else
          type="button"
          class="wp-nav"
          :data-active="activeId === item.id || undefined"
          :data-nav-id="item.id"
          :title="ui.sidebarCollapsed ? item.label : undefined"
          :style="ui.sidebarCollapsed ? { justifyContent: 'center' } : undefined"
          @click="onItemClick(item)"
        >
          <span class="wp-nav__icon"><Icon :name="item.icon" /></span>
          <span v-if="!ui.sidebarCollapsed" class="wp-nav__label">{{ item.label }}</span>
          <!-- Task 10: Count badge — only for items tracked in countByKey -->
          <span
            v-if="!ui.sidebarCollapsed && countByKey[item.id] !== undefined"
            class="wp-nav__count"
          >{{ countByKey[item.id] }}</span>
        </button>
      </template>
    </template>

  </nav>
</template>

<style scoped>
/* .wp-sidebar, .wp-sidebar__section, .wp-nav, .wp-nav__icon, .wp-nav__label,
   .wp-nav__ext are all defined globally in tokens.css. */

.wp-sidebar__spacer { height: 8px; }

/* Parent expand caret. Rotates 90deg when the submenu is open,
 * matching Sakai-vue / PrimeVue admin template convention. */
.wp-nav__caret {
  margin-left: auto;
  color: var(--wp-text-muted, var(--wp-text2));
  transition: transform 0.18s ease;
}
.wp-nav--parent[data-expanded] .wp-nav__caret {
  transform: rotate(90deg);
}

/* Child rows — indented one icon column past the parent so the
 * hierarchy reads at a glance. Slightly dimmer until active. */
.wp-nav__children {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}
.wp-nav--child {
  padding-left: var(--wp-space-7);
  font-size: var(--wp-text-sm);
}
.wp-nav--child .wp-nav__icon {
  opacity: 0.75;
}
.wp-nav--child[data-active] .wp-nav__icon {
  opacity: 1;
}

/* Active-nav indicator — brand identity anchor #2.
 * The ::before strip overrides the global tokens.css accent-colored strip
 * (which also uses the wrong [data-active="true"] selector and never matches).
 * 3 px gradient bar on the left edge; top/bottom inset keeps it from touching
 * the row corners. Works in both collapsed (icon-only) and expanded modes. */
.wp-nav[data-active]::before {
  content: "";
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--wp-brand-gradient);
  border-radius: var(--wp-radius-sm, 2px);
}

/* ── Task 9: Search input ──────────────────────────────────────────────── */
.wp-sidebar__search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  padding: var(--wp-space-3) var(--wp-space-4);
  margin-bottom: var(--wp-space-3);
  background: var(--wp-bg-2);
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
}
.wp-sidebar__search-input {
  border: none;
  outline: none;
  background: transparent;
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  width: 100%;
  font-family: var(--wp-font);
}

/* ── Task 10: Count badge ──────────────────────────────────────────────── */
.wp-nav__count {
  margin-left: auto;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  background: var(--wp-bg-3);
  padding: 0 var(--wp-space-2);
  border-radius: var(--wp-radius-sm);
  min-width: 18px;
  text-align: center;
}

/* Recents section CSS removed — Dashboard owns the recent surface now. */
</style>
