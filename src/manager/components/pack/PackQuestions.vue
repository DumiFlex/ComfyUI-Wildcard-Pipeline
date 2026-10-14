<script setup lang="ts">
/**
 * PackQuestions — this round's questions from the planner. Each takes one
 * or several choices (as the planner marked it), a typed answer, or
 * "Decide for me". Sending turns the answers into decisions the planner
 * never asks about again, and it comes back with the next round (or none).
 */
import { computed } from "vue";
import Button from "../ui/Button.vue";
import { pickAnswer, usePackBuilder } from "../../composables/usePackBuilder";

const pb = usePackBuilder();
const { convo } = pb;
const open = computed(() => pb.questions.value.length - pb.answeredCount.value);

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
      </p>
      <p class="wp-pack-qs__text">{{ q.question }}</p>
      <div class="wp-pack-qs__choices" :role="q.multi ? 'group' : 'radiogroup'" :aria-label="q.question">
        <button
          v-for="c in q.choices"
          :key="c"
          type="button"
          class="wp-pack-qs__choice"
          :role="q.multi ? undefined : 'radio'"
          :aria-pressed="q.multi ? isPicked(q.question, c) : undefined"
          :aria-checked="q.multi ? undefined : isPicked(q.question, c)"
          :disabled="convo.loading.value"
          data-test="pack-choice"
          @click="pb.choose(q, c)"
        ><i v-if="q.multi" :class="['pi', isPicked(q.question, c) ? 'pi-check-square' : 'pi-stop']" aria-hidden="true" /> {{ c }}</button>
        <button
          type="button"
          class="wp-pack-qs__choice wp-pack-qs__decide"
          :aria-pressed="pb.pickFor(q.question).decide"
          :disabled="convo.loading.value"
          data-test="pack-decide"
          @click="pb.decideFor(q)"
        ><i class="pi pi-sparkles" aria-hidden="true" /> Decide for me</button>
      </div>
      <input
        class="wp-input wp-input--sm wp-pack-qs__other"
        :value="pb.pickFor(q.question).other"
        :placeholder="q.multi ? 'Add your own…' : 'Or type your own answer…'"
        :aria-label="`Your own answer to: ${q.question}`"
        :disabled="convo.loading.value"
        data-test="pack-other"
        @input="pb.setOther(q, ($event.target as HTMLInputElement).value)"
      >
    </div>
    <div class="wp-pack-qs__row">
      <span class="wp-pack-qs__dim">
        {{ open > 0 ? `${open} of ${pb.questions.value.length} open` : 'All answered' }}.
        Answers become decisions the planner keeps.
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
        :disabled="!pb.answeredCount.value || convo.loading.value"
        :loading="convo.loading.value"
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
.wp-pack-qs__choice {
  padding: 5px 11px; border-radius: 7px; font-size: 13px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center;
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text); max-width: 100%;
  overflow-wrap: anywhere; text-align: left;
}
.wp-pack-qs__choice .pi { font-size: 11px; }
.wp-pack-qs__choice[aria-pressed="true"], .wp-pack-qs__choice[aria-checked="true"] {
  border-color: var(--wp-accent-400); color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-accent-500) 16%, var(--wp-bg-2));
}
.wp-pack-qs__decide { border-style: dashed; color: var(--wp-text-muted); }
.wp-pack-qs__other { width: 100%; font-size: 12.5px; }
.wp-pack-qs__row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wp-pack-qs__dim { flex: 1; font-size: 12px; color: var(--wp-text-dim); }
</style>
