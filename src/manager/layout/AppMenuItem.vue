<script setup lang="ts">
import { RouterLink } from "vue-router";

defineProps<{
  item: {
    label: string;
    icon: string;
    to?: string;
    url?: string;
    soon?: boolean;
  };
}>();
</script>

<template>
  <li>
    <span v-if="item.soon" class="sidebar-item sidebar-item--disabled">
      <i :class="['pi', 'pi-fw', item.icon]" aria-hidden="true" />
      <span class="sidebar-item__label">{{ item.label }}</span>
      <span class="sidebar-item__badge">soon</span>
    </span>
    <a
      v-else-if="item.url"
      :href="item.url"
      target="_blank" rel="noopener noreferrer"
      class="sidebar-item"
    >
      <i :class="['pi', 'pi-fw', item.icon]" aria-hidden="true" />
      <span class="sidebar-item__label">{{ item.label }}</span>
      <i class="pi pi-external-link sidebar-item__external" aria-hidden="true" />
    </a>
    <RouterLink
      v-else-if="item.to"
      :to="item.to"
      exact-active-class="sidebar-item--active"
      class="sidebar-item"
    >
      <i :class="['pi', 'pi-fw', item.icon]" aria-hidden="true" />
      <span class="sidebar-item__label">{{ item.label }}</span>
    </RouterLink>
  </li>
</template>

<style scoped>
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  color: var(--wp-text);
  text-decoration: none;
  border-left: 2px solid transparent;
  font-size: 13px;
}
.sidebar-item:hover { background: var(--wp-bg2); }
.sidebar-item--active {
  background: var(--wp-accent-glow);
  border-left-color: var(--wp-accent);
  color: #fff;
}
.sidebar-item--active :deep(.pi) { color: var(--wp-accent); }
.sidebar-item__label { flex: 1; }
.sidebar-item__badge {
  font-size: 9.5px;
  padding: 1px 5px;
  background: var(--wp-bg3);
  color: var(--wp-text3);
  border-radius: 3px;
}
.sidebar-item__external { font-size: 10px; color: var(--wp-text3); }
.sidebar-item--disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
.sidebar-item :deep(.pi) { color: var(--wp-text2); }
</style>
