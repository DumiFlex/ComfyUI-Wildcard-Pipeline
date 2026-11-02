<script setup lang="ts">
/**
 * One line saying what a bundle holds: a box mark, "3 modules" and their
 * names joined by middots.
 *
 *   <BundleMeta :count="3" :names="['palette', 'mood', 'style']" />
 */
import Icon from "./Icon.vue";

defineProps<{
  count: number;
  names?: string[] | undefined;
}>();
</script>

<template>
  <div class="wp-bundle-meta">
    <span class="wp-bundle-meta__icon" aria-hidden="true"><Icon name="box" :size="10" /></span>
    <span class="wp-bundle-meta__text">
      <span class="wp-bundle-meta__count">{{ count }} {{ count === 1 ? "module" : "modules" }}</span>
      <template v-for="(n, i) in names ?? []" :key="i">
        <span class="wp-bundle-meta__sep">·</span>{{ n }}
      </template>
    </span>
  </div>
</template>

<style scoped>
.wp-bundle-meta {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: var(--wp-font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--wp-text-dim);
}
.wp-bundle-meta__icon {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-bundle-default) 18%, transparent);
  color: var(--wp-text-muted);
}
.wp-bundle-meta__text { flex: 1; min-width: 0; word-break: break-word; }
.wp-bundle-meta__count { color: var(--wp-text); font-weight: 500; }
.wp-bundle-meta__sep { margin: 0 4px; color: var(--wp-text-dim); }
</style>
