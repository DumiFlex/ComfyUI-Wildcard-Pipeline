<script setup lang="ts">
/**
 * DraftBanner
 *
 * Shared restore-or-discard banner shown above editor cards when a
 * stored draft exists for the current item. Lifts the identical 8-line
 * template that previously lived in each of the six editors, plus the
 * Transition wrapper so the banner fades-down on enter and out on leave.
 */
import Icon from "./ui/Icon.vue";
import Button from "./ui/Button.vue";
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
    <div
      v-if="hasDraft"
      class="wp-draft-banner"
      role="status"
      data-test="draft-banner"
    >
      <Icon name="pi-clock" />
      <span>Unsaved draft from {{ formatDraftAge(ageMs) }}.</span>
      <span class="wp-spacer" />
      <Button variant="primary" size="sm" @click="emit('restore')">Restore</Button>
      <Button variant="ghost" size="sm" @click="emit('discard')">Discard</Button>
    </div>
  </Transition>
</template>
