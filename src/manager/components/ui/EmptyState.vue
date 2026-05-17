<script setup lang="ts">
import Icon from "./Icon.vue";

interface Props {
  icon: string;
  headline: string;
  body?: string;
  /** "library" = encouraging first-run; "no-results" = corrective for filter misses. */
  variant?: "library" | "no-results";
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
  text-align: center;
  padding: var(--wp-space-8) var(--wp-space-6);
  gap: var(--wp-space-5);
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
