<script setup lang="ts">
/** The 3×3 grid of screen spots: where a bookmark lands (the editor's Lands
 *  at) or where Bookmark this view puts the new one (the dock). */
import WpIconButton from "@/kit/WpIconButton.vue";
import { BOOKMARK_ANCHORS, type BookmarkAnchor } from "../../extension/bookmarks";

defineProps<{
  modelValue: BookmarkAnchor;
  /** The radiogroup's name for screen readers. */
  label: string;
  /** `data-test` prefix for each spot (`<prefix>-tl` …). */
  testPrefix: string;
}>();

const emit = defineEmits<{ (e: "update:modelValue", v: BookmarkAnchor): void }>();
</script>

<template>
  <div class="wp-bmspots" role="radiogroup" :aria-label="label">
    <WpIconButton
      v-for="a in BOOKMARK_ANCHORS"
      :key="a.id"
      :icon="modelValue === a.id ? 'pi-circle-fill' : 'pi-circle'"
      :label="a.label"
      :pressed="modelValue === a.id"
      :tone="modelValue === a.id ? 'accent' : 'neutral'"
      :data-test="`${testPrefix}-${a.id}`"
      @click="emit('update:modelValue', a.id)"
    />
  </div>
</template>

<style scoped>
.wp-bmspots {
  display: grid;
  grid-template-columns: repeat(3, 20px);
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-bmspots :deep(.pi) { font-size: 8px; }
</style>
