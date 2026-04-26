<script setup lang="ts">
import { RouterLink } from "vue-router";

defineProps<{
  item: { label: string; icon: string; to: string };
}>();
</script>

<template>
  <li>
    <RouterLink
      :to="item.to"
      class="flex items-center gap-2 px-4 py-2 text-wp-text hover:bg-wp-bg2 border-l-2 border-transparent"
      active-class="!bg-wp-accent/15 !border-l-[color:var(--wp-accent)] !text-white"
    >
      <i :class="['pi', item.icon, 'text-wp-text2']" aria-hidden="true" />
      <span class="text-sm">{{ item.label }}</span>
    </RouterLink>
  </li>
</template>
