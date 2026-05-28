<script setup lang="ts">
import Icon from "./Icon.vue";

interface Props {
  icon: string;
  headline: string;
  body?: string;
  /** "library" = encouraging first-run; "no-results" = corrective for
   *  filter misses; "error" = network/permission failure with retry. */
  variant?: "library" | "no-results" | "error";
}
withDefaults(defineProps<Props>(), {
  variant: "library",
});
</script>

<template>
  <div class="wp-empty" :class="`wp-empty--${variant}`">
    <div class="wp-empty__icon">
      <Icon :name="icon" :size="48" />
    </div>
    <h3 class="wp-empty__headline">{{ headline }}</h3>
    <p v-if="body" class="wp-empty__body">{{ body }}</p>
    <div v-if="$slots.cta" class="wp-empty__cta">
      <slot name="cta" />
    </div>
  </div>
</template>

<style scoped>
.wp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--wp-space-8) var(--wp-space-6);
  gap: var(--wp-space-5);
  /* Cover "most of the viewport" without exceeding it. `60vh` fills the
   * empty area on typical desktop heights so the message reads as the
   * page's content (not floating at the top of a tall container), while
   * the `max(..., 360px)` floor keeps it presentable on short viewports.
   * A prior version chained `height: 100%` through a table + tbody + td
   * stack so the cell absorbed the full scroll-wrap height, but that
   * compounded with the table's `<thead>` and produced a permanent
   * scrollbar on every empty list. `min-height` keeps the layout flat
   * (no 100% propagation), so populated lists are untouched and the
   * scrollbar only appears when content genuinely overflows. */
  min-height: max(60vh, 360px);
  box-sizing: border-box;
}
.wp-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  border-radius: var(--wp-radius-xl);
  background: var(--wp-bg-2);
  color: var(--wp-text-muted);
}
.wp-empty--no-results .wp-empty__icon {
  background: transparent;
  border: 1px dashed var(--wp-border);
}
.wp-empty--error .wp-empty__icon {
  background: color-mix(in oklab, var(--wp-danger) 12%, transparent);
  color: var(--wp-danger);
  border: 1px solid color-mix(in oklab, var(--wp-danger) 30%, transparent);
}
.wp-empty__headline {
  margin: 0;
  font-size: var(--wp-text-lg);
  line-height: var(--wp-line-lg);
  font-weight: var(--wp-weight-semibold);
}
.wp-empty__body {
  margin: 0;
  font-size: var(--wp-text-sm);
  line-height: var(--wp-line-sm);
  color: var(--wp-text-muted);
  max-width: 360px;
}
.wp-empty__cta {
  margin-top: var(--wp-space-3);
}
</style>
