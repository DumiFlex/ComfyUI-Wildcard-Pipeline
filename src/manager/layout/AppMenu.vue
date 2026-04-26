<script setup lang="ts">
import AppMenuItem from "./AppMenuItem.vue";

interface MenuItem { label: string; icon: string; to: string; }
interface MenuSection { label: string; items: MenuItem[]; }

const sections: MenuSection[] = [
  {
    label: "Modules",
    items: [
      { label: "All modules", icon: "pi pi-list", to: "/modules" },
      { label: "+ New wildcard", icon: "pi pi-plus", to: "/modules/wildcard/new" },
      { label: "+ New fixed values", icon: "pi pi-plus", to: "/modules/fixed-values/new" },
    ],
  },
  {
    label: "Library",
    items: [
      { label: "Categories", icon: "pi pi-tag", to: "/categories" },
      { label: "Import / Export", icon: "pi pi-arrow-right-arrow-left", to: "/import-export" },
      { label: "Test runner", icon: "pi pi-bolt", to: "/test" },
    ],
  },
  {
    label: "App",
    items: [{ label: "Settings", icon: "pi pi-cog", to: "/settings" }],
  },
];
</script>

<template>
  <nav>
    <div v-for="section in sections" :key="section.label" class="mb-3">
      <div class="px-4 py-1 text-[10px] uppercase tracking-wider text-wp-text3 font-semibold">
        {{ section.label }}
      </div>
      <ul class="list-none p-0 m-0">
        <AppMenuItem v-for="item in section.items" :key="item.to" :item="item" />
      </ul>
    </div>
  </nav>
</template>
