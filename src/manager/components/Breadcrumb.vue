<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { BreadcrumbItem } from "./Breadcrumb.types";

defineProps<{ items: BreadcrumbItem[] }>();

// BreadcrumbItem lives in ./Breadcrumb.types.ts so consumers can
// import the type without the Vue SFC module-shim IDE warning.
export type { BreadcrumbItem };
</script>

<template>
  <nav class="wp-breadcrumb" aria-label="Breadcrumb">
    <template v-for="(item, idx) in items" :key="idx">
      <RouterLink
        v-if="item.to && idx < items.length - 1"
        :to="item.to"
        data-test="bc-segment"
        class="wp-breadcrumb__segment wp-breadcrumb__segment--link"
      >{{ item.label }}</RouterLink>
      <span
        v-else
        data-test="bc-segment"
        class="wp-breadcrumb__segment wp-breadcrumb__segment--current"
        :aria-current="idx === items.length - 1 ? 'page' : undefined"
      >{{ item.label }}</span>
      <span v-if="idx < items.length - 1" class="wp-breadcrumb__sep" aria-hidden="true">›</span>
    </template>
  </nav>
</template>

<style scoped>
.wp-breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  min-width: 0;
}
.wp-breadcrumb__segment {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-breadcrumb__segment--link {
  color: var(--wp-text-muted);
  text-decoration: none;
}
.wp-breadcrumb__segment--link:hover {
  color: var(--wp-text);
  text-decoration: underline;
}
.wp-breadcrumb__segment--current {
  color: var(--wp-text);
  font-weight: var(--wp-weight-medium);
  flex-shrink: 1;
  min-width: 0;
}
.wp-breadcrumb__sep {
  color: var(--wp-text-dim);
}
</style>
