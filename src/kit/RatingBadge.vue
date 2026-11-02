<script setup lang="ts">
/**
 * The NSFW and Featured badges on a post: small uppercase pills. Renders
 * nothing for a safe, unfeatured post.
 *
 *   <RatingBadge rating="nsfw" featured />
 */
import Icon from "./Icon.vue";

defineProps<{
  rating?: "sfw" | "nsfw" | undefined;
  featured?: boolean | undefined;
}>();
</script>

<template>
  <span v-if="rating === 'nsfw'" class="wp-rating-badge wp-rating-badge--nsfw">NSFW</span>
  <span v-if="featured" class="wp-rating-badge wp-rating-badge--featured">
    <Icon name="star-fill" :size="9" />Featured
  </span>
</template>

<style scoped>
.wp-rating-badge {
  --rating-badge-c: var(--wp-warn);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--wp-radius-cap, 999px);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 14px;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--rating-badge-c);
  background: color-mix(in oklab, var(--rating-badge-c) 16%, transparent);
  border: 1px solid color-mix(in oklab, var(--rating-badge-c) 42%, transparent);
}
.wp-rating-badge--nsfw { --rating-badge-c: var(--wp-danger); color: var(--wp-danger-text); }
</style>
