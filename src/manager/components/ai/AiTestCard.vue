<script setup lang="ts">
/**
 * AiTestCard — a chat run_test as a card: each variable's top values as
 * bars (with the share before the proposed changes when the run compared
 * them), options never picked, warnings and sample prompts. "Open in Test
 * Runner" runs the same stack there, where the user can dig in.
 */
import { computed, ref } from "vue";
import Button from "../../../kit/Button.vue";
import type { AiTestCard } from "../../api/types";

const props = defineProps<{ card: AiTestCard; full?: boolean }>();
const emit = defineEmits<{ (e: "open"): void; (e: "zoom"): void }>();

/** Never-picked lists and warnings shown before the preview's full list. */
const NOTES_SHOWN = 3;

const shown = computed(() => props.full ? props.card.vars
  : props.card.vars.filter((v) => !v.internal).slice(0, 6));
const never = computed(() => props.full ? props.card.never : props.card.never.slice(0, NOTES_SHOWN));
const warnings = computed(() => props.full ? props.card.warnings
  : props.card.warnings.slice(0, NOTES_SHOWN));
const hiddenNotes = computed(() => props.card.never.length + props.card.warnings.length
  - never.value.length - warnings.value.length);
const hidden = computed(() => props.card.vars.length - shown.value.length);
const expanded = ref(false);

function delta(top: { pct: number; was?: number }): string {
  if (top.was === undefined || top.was === top.pct) return "";
  return `${top.was}% → `;
}
</script>

<template>
  <article class="wp-ai-test" data-test="ai-test-card">
    <header class="wp-ai-test__head">
      <i class="pi pi-play-circle" aria-hidden="true" />
      <span class="wp-ai-test__title">
        Test run · {{ card.runs }} seed{{ card.runs === 1 ? "" : "s" }}
        <template v-if="card.compared"> · was → now</template>
      </span>
      <span v-if="card.failed" class="wp-ai-test__bad">{{ card.failed }} failed</span>
      <button
        v-if="!full"
        type="button"
        class="wp-ai-test__zoom"
        aria-label="Show the whole test run"
        title="Show the whole test run"
        data-test="ai-test-zoom"
        @click="emit('zoom')"
      ><i class="pi pi-search-plus" aria-hidden="true" /></button>
    </header>

    <div v-for="v in (expanded ? card.vars : shown)" :key="v.name" class="wp-ai-test__var" data-test="ai-test-var">
      <div class="wp-ai-test__var-head">
        <code>${{ v.name }}</code>
        <span class="wp-ai-test__dim">{{ v.distinct }} different</span>
      </div>
      <div v-for="(t, i) in v.tops" :key="i" class="wp-ai-test__bar-row">
        <span class="wp-ai-test__value" :title="t.v">{{ t.v || "(empty)" }}</span>
        <span class="wp-ai-test__bar" aria-hidden="true">
          <span v-if="t.was !== undefined" class="wp-ai-test__bar-was" :style="{ width: `${t.was}%` }" />
          <span class="wp-ai-test__bar-now" :style="{ width: `${t.pct}%` }" />
        </span>
        <span class="wp-ai-test__pct">{{ delta(t) }}{{ t.pct }}%</span>
      </div>
    </div>
    <button
      v-if="!full && (hidden > 0 || (expanded && card.vars.length > shown.length))"
      type="button"
      class="wp-ai-test__more"
      @click="expanded = !expanded"
    >{{ expanded ? "Show fewer" : `${hidden} more variable${hidden === 1 ? "" : "s"}` }}</button>

    <p v-for="n in never" :key="n.name" class="wp-ai-test__note" data-test="ai-test-never">
      <i class="pi pi-eye-slash" aria-hidden="true" />
      Never picked in <b>{{ n.name }}</b>: <span :class="{ 'wp-ai-test__clamp': !full }">{{ n.values.join(", ") }}{{ n.more ? ` (+${n.more})` : "" }}</span>
    </p>
    <p v-for="(w, i) in warnings" :key="`w${i}`" class="wp-ai-test__note wp-ai-test__warn">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      {{ w.text }} <span class="wp-ai-test__dim">({{ w.count }} of {{ card.runs }})</span>
    </p>
    <p v-if="!full && hiddenNotes > 0" class="wp-ai-test__dim wp-ai-test__note">+{{ hiddenNotes }} more in the full view</p>
    <details v-if="card.prompts.length" class="wp-ai-test__prompts" :open="full">
      <summary>Sample prompts</summary>
      <p v-for="(p, i) in card.prompts" :key="i" :class="{ 'wp-ai-test__clamp': !full }">{{ p.p }}<span v-if="p.n" class="wp-ai-test__dim"> · negative: {{ p.n }}</span></p>
    </details>

    <footer class="wp-ai-test__foot">
      <Button
        size="sm"
        variant="secondary"
        icon="pi-external-link"
        :disabled="!card.stack.length"
        :title="card.stack.length ? 'Run the same stack in the Test Runner' : 'Everything in this run is still a card'"
        data-test="ai-test-open"
        @click="emit('open')"
      >Open in Test Runner</Button>
    </footer>
  </article>
</template>

<style scoped>
.wp-ai-test { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--wp-border); border-radius: min(8px, var(--wp-radius-cap, 999px)); background: var(--wp-bg-sunken, rgb(0 0 0 / 15%)); font-size: 12px; }
.wp-ai-test__head { display: flex; align-items: center; gap: 6px; font-weight: 600; }
.wp-ai-test__title { flex: 1; }
.wp-ai-test__bad { color: var(--wp-danger, #e5484d); font-weight: 500; }
.wp-ai-test__var { display: flex; flex-direction: column; gap: 2px; }
.wp-ai-test__var-head { display: flex; justify-content: space-between; gap: 8px; }
.wp-ai-test__dim { color: var(--wp-text-dim); font-weight: 400; }
.wp-ai-test__bar-row { display: grid; grid-template-columns: minmax(0, 1fr) 72px auto; align-items: center; gap: 6px; }
.wp-ai-test__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ai-test__bar { position: relative; height: 6px; border-radius: min(3px, var(--wp-radius-cap, 999px)); background: var(--wp-border); overflow: hidden; }
.wp-ai-test__bar-was { position: absolute; inset: 0 auto 0 0; background: var(--wp-text-dim); opacity: 0.45; }
.wp-ai-test__bar-now { position: absolute; inset: 0 auto 0 0; background: var(--wp-accent-500); }
.wp-ai-test__pct { font-variant-numeric: tabular-nums; color: var(--wp-text-muted); white-space: nowrap; }
.wp-ai-test__more { align-self: flex-start; background: none; border: 0; padding: 0; color: var(--wp-accent-400, var(--wp-accent-500)); cursor: pointer; font-size: 12px; }
.wp-ai-test__note { margin: 0; display: flex; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
.wp-ai-test__warn { color: var(--wp-warn); }
.wp-ai-test__prompts summary { cursor: pointer; color: var(--wp-text-muted); }
.wp-ai-test__prompts p { margin: 4px 0 0; overflow-wrap: anywhere; }
.wp-ai-test__foot { display: flex; justify-content: flex-end; }
.wp-ai-test__zoom { flex: none; background: none; border: 0; padding: 2px 4px; color: var(--wp-text-muted); cursor: pointer; border-radius: var(--wp-radius-sm); }
.wp-ai-test__zoom:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-ai-test__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
</style>
