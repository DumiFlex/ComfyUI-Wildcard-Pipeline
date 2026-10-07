<script setup lang="ts">
/**
 * PickerHost — the one body-level app for WP Image Filter (mounted the first
 * time a node waits; see `extension/image-filter.ts`). Shows the oldest
 * waiting request in the picker, or a small "waiting" pill while the user has
 * it tucked away to look at the canvas.
 */
import { computed, ref, watch } from "vue";
import PickerModal from "./PickerModal.vue";
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
    @answer="onAnswer"
    @minimize="minimized = true"
  />
  <button
    v-else-if="current"
    type="button"
    class="wp-ifp-pill"
    data-test="image-filter-pill"
    title="Open the picker"
    @click="minimized = false"
  >
    <span class="wp-ifp-pill__dot" aria-hidden="true" />
    Image Filter is waiting<template v-if="waiting.length > 1"> ({{ waiting.length }})</template>
    <span class="wp-ifp-pill__open">Open</span>
  </button>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-ifp-pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 9998; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid var(--wp-accent); background: var(--wp-bg2); color: var(--wp-text); font: 12px var(--wp-font-sans); cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
.wp-ifp-pill__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wp-amber, #fbbf24); animation: wp-ifp-pulse 1.4s ease-in-out infinite; }
.wp-ifp-pill__open { color: var(--wp-accent-text, var(--wp-accent)); font-weight: 600; }
@keyframes wp-ifp-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .wp-ifp-pill__dot { animation: none; } }
</style>
