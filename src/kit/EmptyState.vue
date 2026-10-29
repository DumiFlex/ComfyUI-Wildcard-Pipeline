<script setup lang="ts">
import Icon from "./Icon.vue";

interface Props {
  icon: string;
  headline: string;
  body?: string | undefined;
  /** "library" = encouraging first-run; "no-results" = corrective for
   *  filter misses; "error" = network/permission failure with retry. */
  variant?: "library" | "no-results" | "error" | undefined;
  /** How much room it takes. `page` fills an empty list page, `panel` (the
   *  default) sits in a card or panel at its own height, `inline` is one
   *  compact row for a small box. */
  size?: "page" | "panel" | "inline" | undefined;
}
const props = withDefaults(defineProps<Props>(), {
  variant: "library",
  size: "panel",
});
const ICON_PX = { page: 40, panel: 26, inline: 16 } as const;
</script>

<template>
  <div class="wp-empty" :class="[`wp-empty--${variant}`, `wp-empty--${props.size}`]" data-test="empty-state">
    <div class="wp-empty__icon">
      <Icon :name="icon" :size="ICON_PX[props.size]" />
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
  padding: var(--wp-space-7) var(--wp-space-6);
  gap: var(--wp-space-4);
  box-sizing: border-box;
}
/* Page: an empty list page. The message reads as the page's content, not a
 * line floating at the top of a tall area, but stops well short of the old
 * 60vh that also hit cards and panels. `min-height` keeps the layout flat
 * (no 100% chain through the table), so a full list is untouched. */
.wp-empty--page {
  min-height: max(40vh, 320px);
  padding: var(--wp-space-8) var(--wp-space-6);
  gap: var(--wp-space-5);
}
/* Inline: one compact row for a small box or a list section. */
.wp-empty--inline {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: flex-start;
  text-align: left;
  padding: var(--wp-space-4);
  gap: var(--wp-space-3);
}
.wp-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: var(--wp-radius-lg);
  background: var(--wp-bg-2);
  color: var(--wp-text-muted);
}
.wp-empty--page .wp-empty__icon { width: 80px; height: 80px; border-radius: var(--wp-radius-xl); }
.wp-empty--inline .wp-empty__icon { width: 28px; height: 28px; border-radius: var(--wp-radius-sm); }
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
  color: var(--wp-text);
  font-size: var(--wp-text-md);
  line-height: var(--wp-line-md, 1.4);
  font-weight: var(--wp-weight-semibold);
}
.wp-empty--page .wp-empty__headline {
  font-size: var(--wp-text-lg);
  line-height: var(--wp-line-lg);
}
.wp-empty--inline .wp-empty__headline { font-size: var(--wp-text-base); }
.wp-empty__body {
  margin: 0;
  font-size: var(--wp-text-sm);
  line-height: var(--wp-line-sm);
  color: var(--wp-text-muted);
  max-width: 360px;
}
.wp-empty--inline .wp-empty__body { flex-basis: 100%; max-width: none; padding-left: calc(28px + var(--wp-space-3)); margin-top: calc(var(--wp-space-3) * -1); }
.wp-empty__cta {
  margin-top: var(--wp-space-2);
}
.wp-empty--inline .wp-empty__cta { margin: 0 0 0 auto; }
</style>
