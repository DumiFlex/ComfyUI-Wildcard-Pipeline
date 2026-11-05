<script setup lang="ts">
/**
 * PackQuestions — this round's questions from the planner. Each takes one
 * or several choices (as the planner marked it), a typed answer, or
 * "Decide for me". Sending turns the answers into decisions the planner
 * never asks about again, and it comes back with the next round (or none).
 */
import Textarea from "@/kit/Textarea.vue";
import { computed } from "vue";
import Button from "@/kit/Button.vue";
import Chip from "@/kit/Chip.vue";
import { pickAnswer, usePackBuilder } from "../../composables/usePackBuilder";
import { autogrow } from "../../utils/autogrow";
import type { AiPackQuestion } from "../../api/types";

const pb = usePackBuilder();
const { convo } = pb;
const open = computed(() => pb.questions.value.length - pb.answeredCount.value);

function onOther(q: AiPackQuestion, ev: Event): void {
  const el = ev.target as HTMLTextAreaElement;
  autogrow(el);
  pb.setOther(q, el.value);
}

function isPicked(q: string, c: string): boolean {
  return pb.pickFor(q).chosen.includes(c);
}
</script>

<template>
  <div class="wp-pack-qs" data-test="pack-questions">
    <div
      v-for="q in pb.questions.value"
      :key="q.question"
      class="wp-pack-qs__q"
      :data-answered="pickAnswer(pb.picks.value[q.question]) ? 'true' : undefined"
      data-test="pack-question"
    >
      <p class="wp-pack-qs__head">
        <span class="wp-pack-qs__header">{{ q.header }}</span>
        <span v-if="q.multi" class="wp-pack-qs__multi">pick any</span>
        <span v-if="q.binds" class="wp-pack-qs__multi" title="Your answer is applied to the plan right away, with no AI call" data-test="pack-question-code">applied by the code</span>
      </p>
      <p class="wp-pack-qs__text">{{ q.question }}</p>
      <div class="wp-pack-qs__choices" role="group" :aria-label="q.question">
        <Chip
          v-for="c in q.choices"
          :key="c"
          size="md"
          :icon="q.multi ? (isPicked(q.question, c) ? 'pi-check-square' : 'pi-stop') : undefined"
          :pressed="isPicked(q.question, c)"
          :disabled="convo.loading.value"
          data-test="pack-choice"
          @click="pb.choose(q, c)"
        >{{ c }}</Chip>
        <Chip
          size="md"
          icon="pi-sparkles"
          class="wp-pack-qs__decide"
          :pressed="pb.pickFor(q.question).decide"
          :disabled="convo.loading.value"
          data-test="pack-decide"
          @click="pb.decideFor(q)"
        >Decide for me</Chip>
      </div>
      <Textarea
        class="wp-pack-qs__other"
        :rows="1"
        :model-value="pb.pickFor(q.question).other"
        :placeholder="q.multi ? 'Add your own…' : 'Or type your own answer…'"
        :aria-label="`Your own answer to: ${q.question}`"
        :disabled="convo.loading.value"
        data-test="pack-other"
        @input="onOther(q, $event)"
/>
    </div>
    <div class="wp-pack-qs__row">
      <span class="wp-pack-qs__dim">
        {{ open > 0 ? `${open} of ${pb.questions.value.length} open` : 'All answered' }}.
        <template v-if="pb.awaitingSearch.value">They go along when you answer the web search above.</template>
        <template v-else>Answers become decisions the planner keeps.</template>
      </span>
      <Button
        v-if="open > 0"
        size="sm"
        variant="ghost"
        icon="pi-sparkles"
        :disabled="convo.loading.value"
        data-test="pack-decide-all"
        @click="pb.decideAll"
      >Decide the rest</Button>
      <Button
        size="sm"
        icon="pi-reply"
        :disabled="!pb.answeredCount.value || convo.loading.value || pb.awaitingSearch.value"
        :loading="convo.loading.value"
        :title="pb.awaitingSearch.value ? 'Answer the web search above first; your answers go along with it' : undefined"
        data-test="pack-answer"
        @click="pb.refinePlan"
      >Send answers</Button>
    </div>
  </div>
</template>

<style scoped>
.wp-pack-qs { display: flex; flex-direction: column; gap: 14px; }
.wp-pack-qs__q { display: flex; flex-direction: column; gap: 6px; padding-left: 10px; border-left: 2px solid var(--wp-border); }
.wp-pack-qs__q[data-answered] { border-left-color: var(--wp-accent-400); }
.wp-pack-qs__head { margin: 0; display: flex; gap: 8px; align-items: center; }
.wp-pack-qs__header { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--wp-accent-text); }
.wp-pack-qs__multi { font-size: 11px; color: var(--wp-text-dim); }
.wp-pack-qs__text { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.wp-pack-qs__choices { display: flex; gap: 6px; flex-wrap: wrap; }
.wp-pack-qs__decide:not([aria-pressed="true"]) { border-style: dashed; }
.wp-pack-qs__other { width: 100%; font-size: 12.5px; min-height: 30px; resize: vertical; line-height: 1.4; }
.wp-pack-qs__row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wp-pack-qs__dim { flex: 1; font-size: 12px; color: var(--wp-text-dim); }
</style>
