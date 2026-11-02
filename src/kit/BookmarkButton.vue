<script setup lang="ts">
/**
 * Bookmark a post: a toggle Button with a filled bookmark when on. The app
 * owns the request; this only shows the state and emits `toggle`.
 *
 *   <BookmarkButton :bookmarked="post.bookmarked_by_me" :disabled="pending" @toggle="bookmark" />
 */
import Button from "./Button.vue";

withDefaults(defineProps<{
  bookmarked: boolean;
  disabled?: boolean | undefined;
  size?: "sm" | "md" | "lg" | undefined;
}>(), { disabled: false, size: "md" });

const emit = defineEmits<{ (e: "toggle"): void }>();
</script>

<template>
  <Button
    :icon="bookmarked ? 'bookmark-fill' : 'bookmark'"
    :pressed="bookmarked"
    :disabled="disabled"
    :size="size"
    @click="emit('toggle')"
  >{{ bookmarked ? "Bookmarked" : "Bookmark" }}</Button>
</template>
