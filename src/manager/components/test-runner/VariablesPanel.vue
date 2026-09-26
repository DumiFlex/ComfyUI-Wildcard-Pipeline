<script setup lang="ts">
/**
 * Variables tab: one distribution per variable the run produced, counted by
 * FULLY EXPANDED value — `{a|b}` branches and `@{ref}` expansions each get
 * their own bar. Variables that never changed (fixed values, pins) collapse
 * into a compact "constant" list.
 */
import { computed, ref } from "vue";
import type { ScenarioRunResponse } from "../../api/types";
import { orderByStack, summarizeVariables, type StackItemView } from "../../utils/scenario";

const props = defineProps<{
  result: ScenarioRunResponse;
  views: StackItemView[];
  outputVar: string | null;
}>();

const ROWS = 8;
const expanded = ref<Set<string>>(new Set());
const showOutput = ref(false);

const summary = computed(() => summarizeVariables(props.result));
/** A combine's output is a whole prompt: the Outputs tab shows it better,
 *  so it starts hidden here. A wildcard output stays, it's the point. */
const hideOutput = computed(() =>
  !showOutput.value && props.views.some((v) => v.kind === "combine" && v.binding === props.outputVar),
);
const varying = computed(() => {
  const byName = new Map(summary.value.varying.map((v) => [v.name, v]));
  const order = orderByStack([...byName.keys()], props.views);
  return order
    .map((n) => byName.get(n))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .filter((v) => !hideOutput.value || v.name !== props.outputVar);
});
const hiddenOutput = computed(() =>
  hideOutput.value && summary.value.varying.some((v) => v.name === props.outputVar),
);

function toggle(name: string): void {
  const next = new Set(expanded.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  expanded.value = next;
}
</script>

<template>
  <div class="wp-trv" data-test="variables-panel">
    <p class="wp-trv__note">
      Share of {{ result.runs - result.failed }} runs per value. Values are fully expanded, so
      <code>{a|b}</code> branches and <code>@refs</code> count separately.
      <button v-if="hiddenOutput" type="button" class="wp-trv__link" @click="showOutput = true">
        Show ${{ outputVar }} too
      </button>
    </p>

    <div class="wp-trv__grid">
      <section v-for="v in varying" :key="v.name" class="wp-trv__var" data-test="variable">
        <h4>
          <code>${{ v.name }}</code>
          <span>{{ v.distinct }} value{{ v.distinct === 1 ? "" : "s" }}<template v-if="v.internal"> · internal</template></span>
        </h4>
        <div
          v-for="row in (expanded.has(v.name) ? v.rows : v.rows.slice(0, ROWS))"
          :key="row.value"
          class="wp-trv__row"
        >
          <span class="wp-trv__val" :title="row.value">
            <template v-if="row.value === ''"><em class="wp-trv__empty">(empty)</em></template>
            <template v-else>{{ row.value }}</template>
          </span>
          <span class="wp-trv__track"><span class="wp-trv__fill" :style="{ width: `${row.pct}%` }" /></span>
          <span class="wp-trv__pct">{{ row.pct.toFixed(1) }}%</span>
        </div>
        <button
          v-if="v.rows.length > ROWS"
          type="button"
          class="wp-trv__link"
          @click="toggle(v.name)"
        >{{ expanded.has(v.name) ? "Show fewer" : `Show all ${v.rows.length}` }}</button>
        <span v-if="v.other" class="wp-trv__more">+ {{ v.other }} runs across rarer values not listed</span>
      </section>
    </div>

    <section v-if="summary.constants.length" class="wp-trv__consts" data-test="constants">
      <h4>Constant in every run</h4>
      <dl>
        <template v-for="c in summary.constants" :key="c.name">
          <dt><code>${{ c.name }}</code></dt>
          <dd :title="c.value">{{ c.value }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.wp-trv { display: flex; flex-direction: column; gap: var(--wp-space-6); }
.wp-trv__note { margin: 0; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trv__note code { color: var(--wp-text-muted); }
.wp-trv__link {
  background: none; border: 0; padding: 0; cursor: pointer;
  color: var(--wp-accent-text); font-size: var(--wp-text-xs); margin-left: var(--wp-space-3);
}
.wp-trv__link:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trv__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--wp-space-6); }
.wp-trv__var {
  background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  padding: var(--wp-space-5) var(--wp-space-6); display: flex; flex-direction: column; gap: var(--wp-space-3);
  min-width: 0;
}
.wp-trv__var h4, .wp-trv__consts h4 {
  margin: 0 0 var(--wp-space-2); display: flex; justify-content: space-between; gap: var(--wp-space-4);
  font-size: var(--wp-text-sm); font-weight: var(--wp-weight-medium);
}
.wp-trv__var h4 code { color: var(--wp-accent-text); }
.wp-trv__var h4 span { color: var(--wp-text-dim); font-weight: var(--wp-weight-normal); font-size: var(--wp-text-xs); }
.wp-trv__row {
  display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 52px;
  gap: var(--wp-space-4); align-items: center; font-size: var(--wp-text-sm);
}
.wp-trv__val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trv__empty { color: var(--wp-text-dim); }
.wp-trv__track { height: 12px; background: var(--wp-bg-3); border-radius: 3px; overflow: hidden; } /* audit-exempt: bar */
.wp-trv__fill { display: block; height: 100%; background: var(--wp-accent-500); border-radius: 3px; transition: width .2s; } /* audit-exempt: bar */
.wp-trv__pct { text-align: right; font: var(--wp-text-xs) var(--wp-font-mono); color: var(--wp-text-muted); font-variant-numeric: tabular-nums; }
.wp-trv__more { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trv__consts { border-top: 1px solid var(--wp-border); padding-top: var(--wp-space-5); }
.wp-trv__consts dl {
  margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--wp-space-2) var(--wp-space-6); font-size: var(--wp-text-sm);
}
.wp-trv__consts dt code { color: var(--wp-accent-text); }
.wp-trv__consts dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wp-text-muted); }
@media (prefers-reduced-motion: reduce) { .wp-trv__fill { transition: none; } }
</style>
