<script setup lang="ts">
/**
 * AiRunBar — ask the assistant about the run on screen. Each button opens
 * the chat with a question; the Test Runner's page note gives the chat the
 * stack, pins and results, and the chat's `run_test` tool re-runs it (with
 * any changes it proposes) before answering. Changes come back as proposal
 * cards, so nothing is saved until the user applies them.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import { useAiChat } from "../../composables/useAiChat";
import type { ScenarioRunResponse } from "../../api/types";

const props = defineProps<{ result: ScenarioRunResponse }>();

const chat = useAiChat();
const missing = ref("");

const hasWarnings = computed(() => props.result.warnings.length > 0 || props.result.failed > 0);

function explain(): void {
  chat.ask("Explain this run: what the stack does, how the variables come out, and anything that looks off.");
}

function fix(): void {
  chat.ask("Fix the warnings in this run. Run it again with your changes to check they're gone.");
}

function why(): void {
  const what = missing.value.trim();
  if (!what) return;
  chat.ask(`Why do I never (or rarely) get "${what}" in this run? Show what decides it and propose a change if it should come up.`);
  missing.value = "";
}
</script>

<template>
  <div class="wp-tr-ai" data-test="tr-ai">
    <span class="wp-tr-ai__label"><i class="pi pi-microchip-ai" aria-hidden="true" /> Ask the assistant</span>
    <Button size="sm" variant="ghost" data-test="tr-ai-explain" :disabled="chat.loading.value" @click="explain">Explain this run</Button>
    <Button v-if="hasWarnings" size="sm" variant="ghost" data-test="tr-ai-fix" :disabled="chat.loading.value" @click="fix">Fix the warnings</Button>
    <form class="wp-tr-ai__why" @submit.prevent="why">
      <input
        v-model="missing"
        class="wp-input wp-tr-ai__input"
        placeholder="Why do I never get…"
        aria-label="An option or value you never get"
        data-test="tr-ai-why"
      />
      <Button size="sm" variant="ghost" type="submit" :disabled="!missing.trim() || chat.loading.value" data-test="tr-ai-why-ask">Ask</Button>
    </form>
  </div>
</template>

<style scoped>
.wp-tr-ai {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-2);
  padding: var(--wp-space-3) var(--wp-space-5);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: var(--wp-radius);
  background: color-mix(in oklab, var(--wp-accent-500) 6%, var(--wp-bg-2));
}
.wp-tr-ai__label { font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold); color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; margin-right: var(--wp-space-2); }
.wp-tr-ai__why { display: flex; gap: var(--wp-space-1); align-items: center; flex: 1 1 220px; min-width: 0; }
.wp-tr-ai__input { flex: 1; min-width: 0; height: 28px; font-size: var(--wp-text-sm); }
</style>
