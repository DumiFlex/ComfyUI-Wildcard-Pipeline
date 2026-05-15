<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import Icon from "../components/ui/Icon.vue";
import { useUiStore } from "../stores/uiStore";

interface NavItem {
  id: string;
  label: string;
  icon: string;
  to?: string;
  url?: string;
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
      { id: "dashboard", label: "Dashboard", icon: "pi-home", to: "/dashboard" },
    ],
  },
  {
    label: "Modules",
    items: [
      { id: "pipelines",   label: "Pipelines",    icon: "pi-list",       to: "/pipelines"     },
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
    ["pipelines", "pipelines"],
    ["fixed-values", "fixed"],
    ["combines", "combines"],
    ["derivations", "derivations"],
    ["constraints", "constraints"],
    ["bundles", "bundles"],
    ["categories", "categories"],
    ["import-export", "io"],
    ["test", "test"],
    ["dashboard", "dashboard"],
  ];
  for (const [prefix, id] of KIND_BY_PREFIX) {
    if (name === prefix || name.startsWith(`${prefix}-`)) return id;
  }

  if (path.startsWith("/community")) return "community";
  return "";
});

function onItemClick(item: NavItem) {
  if (item.url) return; // anchor handles external nav
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
</style>
