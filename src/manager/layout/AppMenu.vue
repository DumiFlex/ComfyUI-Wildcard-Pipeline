<script setup lang="ts">
import AppMenuItem from "./AppMenuItem.vue";

interface Item {
  label: string;
  icon: string;
  to?: string;
  url?: string;
  soon?: boolean;
}
interface Section { label: string; items: Item[]; }

const sections: Section[] = [
  {
    label: "Home",
    items: [{ label: "Dashboard", icon: "pi pi-home", to: "/dashboard" }],
  },
  {
    label: "Assets",
    items: [
      { label: "Pipelines", icon: "pi pi-list", to: "/pipelines" },
      { label: "Wildcards", icon: "pi pi-th-large", to: "/wildcards" },
      { label: "Fixed Values", icon: "pi pi-tag", to: "/fixed-values" },
      { label: "Combines", icon: "pi pi-share-alt", to: "/combines" },
      { label: "Derivations", icon: "pi pi-code", to: "/derivations" },
      { label: "Constraints", icon: "pi pi-sitemap", to: "/constraints" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Categories", icon: "pi pi-bookmark", to: "/categories" },
      { label: "Import / Export", icon: "pi pi-arrow-right-arrow-left", to: "/import-export" },
      { label: "Test Runner", icon: "pi pi-bolt", to: "/test" },
    ],
  },
  {
    label: "Get Started",
    items: [
      { label: "Community", icon: "pi pi-globe", to: "/community" },
      {
        label: "Documentation", icon: "pi pi-book",
        url: "https://github.com/DumiFlex/ComfyUI-WildcardPipeline/wiki",
      },
      {
        label: "View Source", icon: "pi pi-github",
        url: "https://github.com/DumiFlex/ComfyUI-WildcardPipeline",
      },
    ],
  },
];
</script>

<template>
  <nav class="app-menu">
    <div v-for="section in sections" :key="section.label" class="app-menu__section">
      <div class="app-menu__section-label">{{ section.label }}</div>
      <ul class="app-menu__list">
        <AppMenuItem v-for="item in section.items" :key="item.label" :item="item" />
      </ul>
    </div>
  </nav>
</template>

<style scoped>
.app-menu { padding: 12px 0; }
.app-menu__section { margin-bottom: 12px; }
.app-menu__section-label {
  padding: 4px 16px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--wp-text3);
  font-weight: 600;
}
.app-menu__list { list-style: none; padding: 0; margin: 0; }
</style>
