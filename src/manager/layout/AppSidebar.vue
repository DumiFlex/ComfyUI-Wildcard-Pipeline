<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/ui/Icon.vue";
import { useUiStore } from "../stores/uiStore";

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

const SECTIONS: NavSection[] = [
  {
    label: "Home",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: "pi-home",
        to: "/dashboard",
        children: [
          { id: "all", label: "All items", icon: "pi-objects-column", to: "/all" },
        ],
      },
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
      { id: "categories", label: "Categories",      icon: "pi-bookmark",                 to: "/categories"     },
      { id: "io",         label: "Import / Export", icon: "pi-arrow-right-arrow-left",   to: "/import-export"  },
      { id: "test",       label: "Test Runner",     icon: "pi-bolt",                     to: "/test"           },
    ],
  },
  {
    label: "Get Started",
    items: [
      { id: "community", label: "Community",     icon: "pi-globe",  to: "/community" },
      { id: "_docs",     label: "Documentation", icon: "pi-book",   url: "https://github.com/DumiFlex/ComfyUI-WildcardPipeline/wiki" },
      { id: "_source",   label: "View Source",   icon: "pi-github", url: "https://github.com/DumiFlex/ComfyUI-WildcardPipeline" },
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
    ["categories", "categories"],
    ["import-export", "io"],
    ["test", "test"],
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
</script>

<template>
  <nav class="wp-sidebar" :data-collapsed="ui.sidebarCollapsed || undefined">
    <template v-for="section in SECTIONS" :key="section.label">
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
          <Icon v-if="!ui.sidebarCollapsed" name="pi-external-link" class="wp-nav__ext" :size="10" />
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
            <Icon
              v-if="!ui.sidebarCollapsed"
              name="pi-chevron-right"
              class="wp-nav__caret"
              :size="9"
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
  padding-left: 28px;
  font-size: 12.5px;
}
.wp-nav--child .wp-nav__icon {
  opacity: 0.75;
}
.wp-nav--child[data-active] .wp-nav__icon {
  opacity: 1;
}
</style>
