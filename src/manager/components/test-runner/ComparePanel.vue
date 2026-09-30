<script setup lang="ts">
/**
 * Compare tab: how the latest run differs from the scenario's stored
 * baseline. Seeds are deterministic, so for the same stack every seed gives
 * the same output; a changed output means an edit changed what that seed
 * produces. Distribution and warning changes are only shown when both runs
 * used the same seeds, since different seeds differ by chance.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import type { ScenarioRunResponse } from "../../api/types";
import { wordDiff, type BaselineDiff, type ScenarioBaseline } from "../../utils/baseline";

const props = defineProps<{
  result: ScenarioRunResponse;
  baseline: ScenarioBaseline | null;
  diff: BaselineDiff | null;
  /** The open scenario is saved (a baseline lives on the saved row). */
  saved: boolean;
  running: boolean;
}>();

const emit = defineEmits<{
  (e: "set-baseline"): void;
  (e: "clear-baseline"): void;
  (e: "run-baseline-seeds"): void;
  (e: "open", seed: number): void;
}>();

const PAGE = 25;
const limit = ref(PAGE);

const savedAt = computed(() => {
  if (!props.baseline) return "";
  const d = new Date(props.baseline.saved_at);
  return Number.isNaN(d.getTime()) ? props.baseline.saved_at : d.toLocaleString();
});

const rows = computed(() =>
  (props.diff?.changed ?? []).slice(0, limit.value).map((c) => ({
    ...c,
    segments: wordDiff(c.before ?? "", c.after ?? ""),
    negSegments: c.negative ? wordDiff(c.negative.before, c.negative.after) : null,
  })),
);

/** Value changes per variable, minus the output itself (its changes are
 *  the list above, seed by seed). */
const varChanges = computed(() => (props.diff?.variables ?? []).filter((v) => v.name !== props.diff?.outputVar));

const sampleSeeds = computed(() => new Set(props.result.samples.map((s) => s.seed)));

function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
</script>

<template>
  <div class="wp-trc" data-test="compare-panel">
    <!-- No baseline yet -->
    <div v-if="!baseline" class="wp-trc__empty" data-test="compare-empty">
      <strong>No baseline for this scenario</strong>
      <span>
        Save this run as the baseline, then edit your modules and run again. This tab then lists every seed whose
        output changed, and any values or warnings that appeared or went away.
      </span>
      <Button
        variant="primary"
        icon="pi-bookmark"
        :disabled="!saved"
        :title="saved ? undefined : 'Save the scenario first; the baseline is stored with it'"
        data-test="set-baseline"
        @click="emit('set-baseline')"
      >Save as baseline</Button>
      <em v-if="!saved">Save the scenario first; the baseline is stored with it.</em>
    </div>

    <template v-else-if="diff">
      <div class="wp-trc__banner" :data-tone="diff.same ? 'ok' : diff.changed.length || !diff.seedsMatch ? 'warn' : 'info'" data-test="compare-summary">
        <div class="wp-trc__banner-text">
          <strong v-if="diff.same">Matches the baseline</strong>
          <strong v-else-if="diff.changed.length">
            {{ diff.changed.length }} of {{ diff.compared }} output{{ diff.compared === 1 ? "" : "s" }} changed
          </strong>
          <strong v-else-if="!diff.seedsMatch && !diff.compared">Different seeds from the baseline</strong>
          <strong v-else-if="diff.seedsMatch">Outputs match, other results changed</strong>
          <strong v-else>No compared output changed</strong>
          <span>
            Baseline from {{ savedAt }}<template v-if="diff.outputVar">, comparing <code>${{ diff.outputVar }}</code> seed by seed</template>.
            <template v-if="diff.same"> All {{ diff.compared }} compared outputs, every variable's values and the warnings are the same.</template>
          </span>
        </div>
        <div class="wp-trc__acts">
          <Button size="sm" :disabled="running || !saved" data-test="update-baseline" @click="emit('set-baseline')">Use this run as baseline</Button>
          <Button size="sm" variant="ghost" data-test="clear-baseline" @click="emit('clear-baseline')">Clear</Button>
        </div>
      </div>

      <p v-if="!diff.seedsMatch" class="wp-trc__note" data-test="compare-seeds">
        This run used different seeds from the baseline
        <template v-if="diff.compared">({{ diff.compared }} of {{ baseline.seeds.length }} shared)</template>,
        so only shared seeds are compared and value counts are left out.
        <Button size="sm" :disabled="running" data-test="run-baseline-seeds" @click="emit('run-baseline-seeds')">Run the baseline's seeds</Button>
      </p>

      <p v-if="diff.negativeNotRecorded" class="wp-trc__note" data-test="compare-neg-missing">
        Negative not recorded: this baseline was saved before negatives were tracked, so they aren't compared.
        Use this run as the baseline to compare them from now on.
      </p>

      <section v-if="diff.changed.length" class="wp-trc__sec" aria-label="Changed outputs">
        <h3>Changed outputs</h3>
        <ol class="wp-trc__list">
          <li v-for="r in rows" :key="r.seed">
            <component
              :is="sampleSeeds.has(r.seed) ? 'button' : 'div'"
              :type="sampleSeeds.has(r.seed) ? 'button' : undefined"
              class="wp-trc__row"
              :title="sampleSeeds.has(r.seed) ? 'Open this seed\'s trace' : undefined"
              data-test="compare-row"
              @click="sampleSeeds.has(r.seed) && emit('open', r.seed)"
            >
              <span class="wp-trc__seed">#{{ r.seed }}</span>
              <span class="wp-trc__text">
                <template v-for="(seg, i) in r.segments" :key="i">
                  <del v-if="seg.kind === 'del'">{{ seg.text }}</del>
                  <ins v-else-if="seg.kind === 'add'">{{ seg.text }}</ins>
                  <template v-else>{{ seg.text }}</template>
                </template>
                <em v-if="r.before === null" class="wp-trc__dim"> (was not set)</em>
                <em v-if="r.after === null" class="wp-trc__dim"> (now not set)</em>
                <span v-if="r.negSegments" class="wp-trc__neg" data-test="compare-neg">
                  <span class="wp-trc__neg-tag">NEG</span>
                  <template v-for="(seg, i) in r.negSegments" :key="i">
                    <del v-if="seg.kind === 'del'">{{ seg.text }}</del>
                    <ins v-else-if="seg.kind === 'add'">{{ seg.text }}</ins>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                  <em v-if="!r.negative?.before" class="wp-trc__dim"> (had none)</em>
                  <em v-if="!r.negative?.after" class="wp-trc__dim"> (now none)</em>
                </span>
              </span>
            </component>
          </li>
        </ol>
        <button v-if="rows.length < diff.changed.length" type="button" class="wp-trc__more" @click="limit += PAGE">
          Show {{ Math.min(PAGE, diff.changed.length - rows.length) }} more
        </button>
      </section>

      <section v-if="varChanges.length" class="wp-trc__sec" aria-label="Changed variables">
        <h3>Variables</h3>
        <ul class="wp-trc__vars">
          <li v-for="v in varChanges" :key="v.name" data-test="compare-var">
            <code>${{ v.name }}</code>
            <span v-if="v.status === 'new'" class="wp-trc__tag" data-kind="add">new variable</span>
            <span v-else-if="v.status === 'gone'" class="wp-trc__tag" data-kind="del">no longer set</span>
            <span v-if="v.status === 'changed' && v.added.length" class="wp-trc__line">
              new values: <ins v-for="a in v.added.slice(0, 6)" :key="a">{{ a || "(empty)" }}</ins>
              <template v-if="v.added.length > 6"> and {{ v.added.length - 6 }} more</template>
            </span>
            <span v-if="v.status === 'changed' && v.removed.length" class="wp-trc__line">
              gone: <del v-for="r in v.removed.slice(0, 6)" :key="r">{{ r || "(empty)" }}</del>
              <template v-if="v.removed.length > 6"> and {{ v.removed.length - 6 }} more</template>
            </span>
            <span v-for="s in v.shifted.slice(0, 4)" :key="s.value" class="wp-trc__line">
              <span class="wp-trc__val">{{ s.value || "(empty)" }}</span> {{ fmtPct(s.before) }} → {{ fmtPct(s.after) }} of runs
            </span>
          </li>
        </ul>
      </section>

      <section v-if="diff.warningsAdded.length || diff.warningsGone.length || diff.failed.before !== diff.failed.after" class="wp-trc__sec" aria-label="Changed warnings">
        <h3>Warnings</h3>
        <ul class="wp-trc__vars">
          <li v-if="diff.failed.before !== diff.failed.after">Failed runs: {{ diff.failed.before }} → {{ diff.failed.after }}</li>
          <li v-for="w in diff.warningsAdded" :key="`a${w.type}${w.message}`" data-test="compare-warning-new">
            <span class="wp-trc__tag" data-kind="add">new</span> {{ w.message }} <span class="wp-trc__dim">({{ w.count }} runs)</span>
          </li>
          <li v-for="w in diff.warningsGone" :key="`g${w.type}${w.message}`" data-test="compare-warning-gone">
            <span class="wp-trc__tag" data-kind="ok">gone</span> {{ w.message }}
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wp-trc { display: flex; flex-direction: column; gap: var(--wp-space-6); }
.wp-trc__empty {
  display: flex; flex-direction: column; align-items: center; gap: var(--wp-space-4);
  padding: var(--wp-space-8); text-align: center; color: var(--wp-text-muted); font-size: var(--wp-text-sm);
}
.wp-trc__empty > span { max-width: 64ch; }
.wp-trc__empty strong { color: var(--wp-text); font-size: var(--wp-text-md); }
.wp-trc__empty em { font-style: normal; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trc__banner {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-5);
  border: 1px solid var(--wp-border); border-left: 3px solid var(--wp-info);
  border-radius: var(--wp-radius-sm); padding: var(--wp-space-5) var(--wp-space-6); background: var(--wp-bg-1);
}
.wp-trc__banner[data-tone="ok"] { border-left-color: var(--wp-success); }
.wp-trc__banner[data-tone="warn"] { border-left-color: var(--wp-warn); }
.wp-trc__banner-text { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: var(--wp-space-1); font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-trc__banner-text strong { color: var(--wp-text); font-size: var(--wp-text-md); }
.wp-trc__banner[data-tone="ok"] strong { color: var(--wp-success); }
.wp-trc__banner[data-tone="warn"] strong { color: var(--wp-warn); }
.wp-trc code { color: var(--wp-accent-text); }
.wp-trc__acts { display: flex; gap: var(--wp-space-3); }
.wp-trc__note {
  margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-4);
  font-size: var(--wp-text-sm); color: var(--wp-text-muted);
}
.wp-trc__sec { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wp-trc__sec h3 {
  margin: 0; font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-trc__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-trc__row {
  width: 100%; text-align: left; font: inherit; color: var(--wp-text);
  display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: var(--wp-space-5); align-items: start;
  background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-4) var(--wp-space-5);
}
button.wp-trc__row { cursor: pointer; }
button.wp-trc__row:hover { border-color: var(--wp-border-strong); }
.wp-trc__row:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trc__seed { font: var(--wp-text-xs) var(--wp-font-mono); color: var(--wp-text-dim); padding-top: 2px; }
.wp-trc__text { font-size: var(--wp-text-base); line-height: var(--wp-line-base); word-break: break-word; }
.wp-trc del, .wp-trc ins { text-decoration: none; border-radius: 3px; padding: 0 2px; } /* audit-exempt: inline diff token */
.wp-trc del { margin-right: .25em; background: color-mix(in oklab, var(--wp-danger) 18%, transparent); color: var(--wp-danger-text); text-decoration: line-through; }
.wp-trc ins { background: color-mix(in oklab, var(--wp-success) 18%, transparent); color: var(--wp-success); }
.wp-trc__dim { color: var(--wp-text-dim); font-style: normal; }
.wp-trc__neg { display: block; margin-top: var(--wp-space-2); font: var(--wp-text-sm)/var(--wp-line-base) var(--wp-font-mono); color: var(--wp-text-muted); }
.wp-trc__neg-tag {
  display: inline-block; margin-right: var(--wp-space-3); padding: 0 var(--wp-space-2);
  font: var(--wp-weight-semibold) var(--wp-text-xs) var(--wp-font-mono); letter-spacing: .04em;
  border-radius: 3px; /* audit-exempt: inline token */
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent); color: var(--wp-danger-text);
}
.wp-trc__more {
  align-self: flex-start; background: none; border: 0; cursor: pointer; padding: 0;
  color: var(--wp-accent-text); font-size: var(--wp-text-sm);
}
.wp-trc__vars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-4); font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-trc__vars li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--wp-space-2) var(--wp-space-4); }
.wp-trc__line { display: inline-flex; flex-wrap: wrap; gap: var(--wp-space-2); align-items: baseline; }
.wp-trc__val { color: var(--wp-text); }
.wp-trc__tag {
  font: var(--wp-weight-medium) var(--wp-text-xs) var(--wp-font-mono);
  padding: 0 var(--wp-space-3); border-radius: 999px; /* audit-exempt: pill */
  background: var(--wp-bg-4); color: var(--wp-text-muted);
}
.wp-trc__tag[data-kind="add"] { background: color-mix(in oklab, var(--wp-warn) 16%, transparent); color: var(--wp-warn); }
.wp-trc__tag[data-kind="del"] { background: color-mix(in oklab, var(--wp-danger) 16%, transparent); color: var(--wp-danger-text); }
.wp-trc__tag[data-kind="ok"] { background: color-mix(in oklab, var(--wp-success) 16%, transparent); color: var(--wp-success); }
</style>
