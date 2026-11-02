<script setup lang="ts">
/**
 * Star a post: a toggle Button with a filled star when on and the star count
 * beside the label. The app owns the request; this only shows the state and
 * emits `toggle`.
 *
 *   <StarButton :starred="post.starred_by_me" :count="post.star_count" :disabled="pending" @toggle="star" />
 */
import Button from "./Button.vue";

withDefaults(defineProps<{
  starred: boolean;
  count?: number | undefined;
  disabled?: boolean | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}>(), { count: undefined, disabled: false, size: "md" });

const emit = defineEmits<{ (e: "toggle"): void }>();
</script>

<template>
  <Button
    :icon="starred ? 'star-fill' : 'star'"
    :pressed="starred"
    :disabled="disabled"
    :size="size"
    @click="emit('toggle')"
  >
    {{ starred ? "Starred" : "Star" }}
    <span v-if="count !== undefined" class="wp-star-button__count">{{ count.toLocaleString() }}</span>
  </Button>
</template>

<style scoped>
.wp-star-button__count {
  margin-left: 2px;
  color: var(--wp-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
