<script setup lang="ts">
/**
 * PickerHost — the one body-level app for WP Image Filter (mounted the first
 * time a node waits; see `extension/image-filter.ts`). Shows the oldest
 * waiting request in the picker, or a small "waiting" pill while the user has
 * it tucked away to look at the canvas.
 */
import { computed, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import PickerModal from "./PickerModal.vue";
import { app } from "#comfyui/app";
import { submitAnswer, waiting } from "../../extension/image-filter";
import type { PickAnswer } from "./types";

const current = computed(() => waiting.value[0] ?? null);
const minimized = ref(false);

// A new request always opens the picker, even if the last one was tucked away.
watch(() => current.value?.token, (token, prev) => {
  if (token && token !== prev) minimized.value = false;
});

function onAnswer(answer: PickAnswer): void {
  const req = current.value;
  if (req) void submitAnswer(req.token, answer);
}
</script>

<template>
  <PickerModal
    v-if="current && !minimized"
    :request="current"
    :more-waiting="waiting.length - 1"
    :graph="app.graph"
    @answer="onAnswer"
    @minimize="minimized = true"
  />
  <Button
    v-else-if="current"
    variant="secondary"
    class="wp-ifp-pill"
    data-test="image-filter-pill"
    hint="Open the picker"
    @click="minimized = false"
  >
    <span class="wp-ifp-pill__dot" aria-hidden="true" />
    Image Filter is waiting<template v-if="waiting.length > 1"> ({{ waiting.length }})</template>
    <span class="wp-ifp-pill__open">Open</span>
  </Button>
</template>

<style scoped>
/* The kit Button, floated at the bottom of the canvas as a pill. */
.wp-ifp-pill :deep(.wp-btn__label) { display: inline-flex; align-items: center; gap: 8px; }
.wp-ifp-pill.wp-btn { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 9998; gap: 8px; padding: 0 14px; border-radius: var(--wp-radius-cap, 999px); border-color: var(--wp-accent); box-shadow: var(--wp-shadow-md); }
.wp-ifp-pill__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wp-amber); animation: wp-ifp-pulse 1.4s ease-in-out infinite; }
.wp-ifp-pill__open { color: var(--wp-accent-text, var(--wp-accent)); font-weight: 600; }
@keyframes wp-ifp-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .wp-ifp-pill__dot { animation: none; } }
</style>
