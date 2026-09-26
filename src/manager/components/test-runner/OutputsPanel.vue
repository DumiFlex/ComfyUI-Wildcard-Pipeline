<script setup lang="ts">
/**
 * Outputs tab: the rendered output variable for each returned sample, with
 * the parts other variables wrote tinted so you can see who wrote what.
 * Click a row to open that seed's trace.
 */
import { computed, ref } from "vue";
import type { ScenarioRunResponse } from "../../api/types";
import { renderValue, segmentOutput, type StackItemView } from "../../utils/scenario";

const props = defineProps<{
  result: ScenarioRunResponse;
  views: StackItemView[];
  outputVar: string | null;
}>();
const emit = defineEmits<{ (e: "open", seed: number): void }>();

const PAGE = 25;
const limit = ref(PAGE);

/** Colour slot per variable, in stack order, cycling the 8 var colours. */
const colourOf = computed(() => {
  const m = new Map<string, number>();
  for (const v of props.views) if (v.binding && !m.has(v.binding)) m.set(v.binding, (m.size % 8) + 1);
  return m;
});
const allowed = computed(() => new Set(colourOf.value.keys()));

const rows = computed(() => {
  const out = props.outputVar;
  if (!out) return [];
  return props.result.samples
    .filter((s) => !s.error)
    .slice(0, limit.value)
    .map((s) => ({
      seed: s.seed,
      segments: segmentOutput(renderValue(s.vars[out]), s.vars, out, allowed.value),
      warnings: s.warnings.length,
    }));
});
const available = computed(() => props.result.samples.filter((s) => !s.error).length);
</script>

<template>
  <div class="wp-tro" data-test="outputs-panel">
    <p v-if="!outputVar" class="wp-tro__note">
      Nothing in the stack writes a variable yet, so there is no output to show.
    </p>
    <template v-else>
      <p class="wp-tro__note">
        <code>${{ outputVar }}</code> for the first {{ rows.length }} of {{ result.runs }} seeds.
        Tinted parts show which variable wrote them. Click a row for its trace.
      </p>
      <ol class="wp-tro__list">
        <li v-for="r in rows" :key="r.seed">
          <button type="button" class="wp-tro__row" data-test="output-row" @click="emit('open', r.seed)">
            <span class="wp-tro__seed">#{{ r.seed }}</span>
            <span class="wp-tro__text">
              <template v-for="(seg, i) in r.segments" :key="i">
                <span
                  v-if="seg.varName"
                  class="wp-tro__tok"
                  :class="`var-${colourOf.get(seg.varName) ?? 1}`"
                  :title="`$${seg.varName}`"
                >{{ seg.text }}</span>
                <template v-else>{{ seg.text }}</template>
              </template>
              <em v-if="r.segments.length === 1 && !r.segments[0].text" class="wp-tro__empty">(empty)</em>
            </span>
            <span v-if="r.warnings" class="wp-tro__warn">{{ r.warnings }} warning{{ r.warnings === 1 ? "" : "s" }}</span>
          </button>
        </li>
      </ol>
      <button v-if="rows.length < available" type="button" class="wp-tro__more" @click="limit += PAGE">
        Show {{ Math.min(PAGE, available - rows.length) }} more
      </button>
    </template>
  </div>
</template>

<style scoped>
.wp-tro { display: flex; flex-direction: column; gap: var(--wp-space-5); }
.wp-tro__note { margin: 0; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-tro__note code { color: var(--wp-accent-text); }
.wp-tro__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-tro__row {
  width: 100%; text-align: left; cursor: pointer; font: inherit; color: var(--wp-text);
  display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; gap: var(--wp-space-5); align-items: start;
  background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-4) var(--wp-space-5);
}
.wp-tro__row:hover { border-color: var(--wp-border-strong); }
.wp-tro__row:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-tro__seed { font: var(--wp-text-xs) var(--wp-font-mono); color: var(--wp-text-dim); padding-top: 2px; }
.wp-tro__text { font-size: var(--wp-text-base); line-height: var(--wp-line-base); word-break: break-word; }
.wp-tro__tok { border-radius: 3px; padding: 0 2px; background: color-mix(in oklab, currentColor 12%, transparent); } /* audit-exempt: inline token */
.wp-tro__empty { color: var(--wp-text-dim); }
.wp-tro__warn { font-size: var(--wp-text-xs); color: var(--wp-warn); white-space: nowrap; }
.wp-tro__more {
  align-self: flex-start; background: none; border: 0; cursor: pointer; padding: 0;
  color: var(--wp-accent-text); font-size: var(--wp-text-sm);
}
</style>
