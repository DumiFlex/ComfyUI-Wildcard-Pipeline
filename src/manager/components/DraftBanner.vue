<script setup lang="ts">
/**
 * DraftBanner
 *
 * Shared restore-or-discard banner shown above editor cards when a
 * stored draft exists for the current item. Lifts the identical 8-line
 * template that previously lived in each of the six editors, plus the
 * Transition wrapper so the banner fades-down on enter and out on leave.
 * Drawn by the kit Banner (tone info).
 */
import Banner from "@/kit/Banner.vue";
import Button from "../../kit/Button.vue";
import { formatDraftAge } from "../composables/useEditorDraft";

interface Props {
  /** True when a stored draft is available for restore. */
  hasDraft: boolean;
  /** Milliseconds since the draft was written. */
  ageMs: number | null;
}
defineProps<Props>();

const emit = defineEmits<{
  (e: "restore"): void;
  (e: "discard"): void;
}>();
</script>

<template>
  <Transition name="wp-banner">
    <Banner
      v-if="hasDraft"
      tone="info"
      icon="pi-clock"
      size="sm"
      data-test="draft-banner"
    >
      Unsaved draft from {{ formatDraftAge(ageMs) }}.
      <template #actions>
        <Button variant="primary" size="sm" @click="emit('restore')">Restore</Button>
        <Button variant="ghost" size="sm" @click="emit('discard')">Discard</Button>
      </template>
    </Banner>
  </Transition>
</template>
