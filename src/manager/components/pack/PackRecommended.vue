<script setup lang="ts">
/**
 * PackRecommended — the settings the request (and the chat's plan card)
 * point to that differ from the user's, each with why, and a button that
 * takes them all. Nothing changes until the button is pressed.
 */
import Button from "../ui/Button.vue";
import type { AiPackSettings } from "../../api/types";
import { settingLabel } from "./pack-settings-fields";

defineProps<{
  changes: Array<{ key: keyof AiPackSettings; value: unknown; reason: string }>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ (e: "use"): void }>();
</script>

<template>
  <div class="wp-pack-rec" data-test="pack-recommended">
    <template v-if="changes.length">
      <p class="wp-pack-rec__title"><i class="pi pi-star" aria-hidden="true" /> Recommended for this pack</p>
      <ul class="wp-pack-rec__list">
        <li v-for="c in changes" :key="c.key" :data-test="`pack-recommended-${c.key}`">
          <b>{{ settingLabel(c.key, c.value) }}</b><span v-if="c.reason" class="wp-pack-rec__why"> · {{ c.reason }}</span>
        </li>
      </ul>
      <Button size="sm" icon="pi-check" :disabled="disabled" data-test="pack-use-recommended" @click="emit('use')">Use recommended</Button>
    </template>
    <p v-else class="wp-pack-rec__same" data-test="pack-recommended-same">
      <i class="pi pi-check-circle" aria-hidden="true" /> Your settings already fit this request.
    </p>
  </div>
</template>

<style scoped>
.wp-pack-rec {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px)); background: var(--wp-bg-2);
}
.wp-pack-rec__title { margin: 0; font-size: 12.5px; font-weight: 600; }
.wp-pack-rec__title .pi { color: var(--wp-accent-text); margin-right: 4px; }
.wp-pack-rec__list { margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.5; }
.wp-pack-rec__why { color: var(--wp-text-muted); }
.wp-pack-rec__same { margin: 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-pack-rec__same .pi { margin-right: 4px; }
</style>
