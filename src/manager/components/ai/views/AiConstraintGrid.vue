<script setup lang="ts">
/**
 * AiConstraintGrid — a constraint the way its editor reads: tag rules as
 * a source × target grid once there are two or more tags a side (the
 * editor's matrix), option exceptions as source → target rows, the reach
 * beside the target. On a change card each rule carries a mark: new cells
 * and rows green, removed ones struck, changed ones old → new; the rules
 * a change leaves alone are dimmed in the grid and folded from the rows.
 */
import { computed } from "vue";
import type { CardView, ConstraintRowView } from "../../../composables/card-views/types";
import AiSyntax from "../AiSyntax.vue";
import AiInfoDiff from "./AiInfoDiff.vue";

type View = Extract<CardView, { kind: "constraint" }>;
const props = defineProps<{ view: View; full?: boolean }>();

const CAP = { gridFrom: 8, gridTo: 6, pairs: 8 };
const MARK: Record<string, string> = { added: "+", removed: "−", changed: "~", same: "" };

/** A change card (rules carry a change mark). */
const isChange = computed(() => props.view.rows.some((r) => r.change));

function cap<T>(list: T[], n: number): T[] {
  return props.full ? list : list.slice(0, n);
}
function more(list: unknown[], n: number): number {
  return props.full ? 0 : Math.max(0, list.length - n);
}

const grid = computed(() => {
  const cells = props.view.rows.filter((r) => r.byTag);
  const from = [...new Set(cells.map((r) => r.from))];
  const to = [...new Set(cells.map((r) => r.to))];
  if (from.length < 2 || to.length < 2) return null;
  const at = (f: string, t: string): ConstraintRowView | undefined => cells.find((r) => r.from === f && r.to === t);
  return { from, to, at };
});
/** Rows under the grid: exceptions (and tag rules with no grid). A change
 *  card shows only the rows that change; the magnifier shows all. */
const pairs = computed(() => props.view.rows
  .filter((r) => !grid.value || !r.byTag)
  .filter((r) => props.full || !isChange.value || r.change !== "same"));
const folded = computed(() => (props.full || !isChange.value ? 0
  : props.view.rows.filter((r) => (!grid.value || !r.byTag) && r.change === "same").length));

/** What one grid row's cells show: each effect now, and before when it changed. */
function cellsFor(f: string) {
  const g = grid.value;
  if (!g) return [];
  return cap(g.to, CAP.gridTo).map((t) => {
    const r = g.at(f, t);
    if (!r) return { key: t, effect: "", change: undefined, text: "·", was: "", title: undefined };
    return {
      key: t, effect: r.effect, change: r.change, text: cellText(r.effect, r.factor),
      was: r.was ? cellText(r.was.effect, r.was.factor) : "",
      title: r.was ? `${effectText(r.was.effect, r.was.factor)} → ${effectText(r.effect, r.factor)}` : undefined,
    };
  });
}

function cellText(effect: string, factor: number | null): string {
  if (effect === "exclude") return "never";
  if (effect === "only") return "only";
  if ((effect === "boost" || effect === "reduce") && factor !== null) return `×${factor}`;
  return effect;
}

const EFFECTS: Record<string, string> = {
  exclude: "never", reduce: "less likely", boost: "more likely", only: "only these", allow: "no change",
};

function effectText(effect: string, factor: number | null): string {
  const word = EFFECTS[effect] ?? effect;
  return (effect === "boost" || effect === "reduce") && factor !== null ? `${word} ×${factor}` : word;
}
</script>

<template>
  <div class="wp-ai-cgrid">
    <AiInfoDiff v-if="view.fields?.length" :rows="view.fields" :full="full" />
    <p class="wp-ai-cgrid__line">
      When <b>{{ view.source }}</b> picks…, <b>{{ view.target }}</b>{{ view.reach ? ` (${view.reach})` : "" }}:
    </p>
    <div v-if="grid" class="wp-ai-cgrid__scroll">
      <table class="wp-ai-cgrid__grid" data-test="ai-card-matrix">
        <thead>
          <tr>
            <th />
            <th v-for="t in cap(grid.to, CAP.gridTo)" :key="t" scope="col" class="wp-ai-cgrid__tag" :title="t">{{ t }}</th>
            <th v-if="more(grid.to, CAP.gridTo)" scope="col" class="wp-ai-diff__more">+{{ more(grid.to, CAP.gridTo) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in cap(grid.from, CAP.gridFrom)" :key="f">
            <th scope="row" class="wp-ai-cgrid__tag" :title="f">{{ f }}</th>
            <td
              v-for="c in cellsFor(f)"
              :key="c.key"
              :data-effect="c.effect"
              :data-change="c.change"
              :title="c.title"
            >
              <s v-if="c.was" class="wp-ai-cgrid__was">{{ c.was }}</s>
              <s v-if="c.change === 'removed'">{{ c.text }}</s><template v-else>{{ c.text }}</template>
            </td>
            <td v-if="more(grid.to, CAP.gridTo)" />
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="grid && more(grid.from, CAP.gridFrom)" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more(grid.from, CAP.gridFrom) }} more source tag{{ more(grid.from, CAP.gridFrom) === 1 ? "" : "s" }}</p>
    <table v-if="pairs.length" class="wp-ai-cgrid__table">
      <tbody>
        <tr v-for="(r, i) in cap(pairs, CAP.pairs)" :key="i" :data-change="r.change" data-test="ai-card-rule-row">
          <td v-if="isChange" class="wp-ai-diff__mark" aria-hidden="true">{{ MARK[r.change ?? "same"] }}</td>
          <td :class="{ 'wp-ai-diff__was': r.change === 'removed' }"><span :class="r.byTag ? 'wp-ai-cgrid__tag' : undefined"><template v-if="r.byTag">{{ r.from }}</template><AiSyntax v-else :text="r.from" /></span></td>
          <td aria-hidden="true">→</td>
          <td :class="{ 'wp-ai-diff__was': r.change === 'removed' }"><span :class="r.byTag ? 'wp-ai-cgrid__tag' : undefined"><template v-if="r.byTag">{{ r.to }}</template><AiSyntax v-else :text="r.to" /></span></td>
          <td class="wp-ai-cgrid__effect" :data-effect="r.effect">
            <template v-if="r.was"><span class="wp-ai-diff__was">{{ effectText(r.was.effect, r.was.factor) }}</span><span class="wp-ai-diff__arrow">→</span></template>
            <span :class="{ 'wp-ai-diff__was': r.change === 'removed' }">{{ effectText(r.effect, r.factor) }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="more(pairs, CAP.pairs)" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more(pairs, CAP.pairs) }} more rule{{ more(pairs, CAP.pairs) === 1 ? "" : "s" }}</p>
    <p v-if="folded" class="wp-ai-diff__more" data-test="ai-card-unchanged">{{ folded }} rule{{ folded === 1 ? "" : "s" }} unchanged</p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-cgrid { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-cgrid__line { margin: 0; }
.wp-ai-cgrid__scroll { overflow-x: auto; max-width: 100%; }
.wp-ai-cgrid__grid { border-collapse: collapse; font-size: 11.5px; }
.wp-ai-cgrid__grid th, .wp-ai-cgrid__grid td { padding: 2px 6px; border: 1px solid var(--wp-border); text-align: center; font-weight: 400; }
.wp-ai-cgrid__grid th { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ai-cgrid__grid th[scope="row"] { text-align: left; }
.wp-ai-cgrid__grid td { color: var(--wp-text-dim); }
.wp-ai-cgrid__grid td[data-effect="exclude"] { color: var(--wp-danger, #e5484d); }
.wp-ai-cgrid__grid td[data-effect="boost"], .wp-ai-cgrid__grid td[data-effect="only"] { color: var(--wp-success, #46a758); }
.wp-ai-cgrid__grid td[data-effect="reduce"] { color: var(--wp-warn); }
.wp-ai-cgrid__grid td[data-change="same"] { opacity: 0.55; }
.wp-ai-cgrid__grid td[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 14%, transparent); }
.wp-ai-cgrid__grid td[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 12%, transparent); }
.wp-ai-cgrid__grid td[data-change="changed"] { background: color-mix(in oklab, var(--wp-warn) 14%, transparent); }
.wp-ai-cgrid__was { color: var(--wp-text-muted); margin-right: 3px; }
.wp-ai-cgrid__table { border-collapse: collapse; width: 100%; }
.wp-ai-cgrid__table td { padding: 2px 6px 2px 0; vertical-align: top; overflow-wrap: anywhere; }
.wp-ai-cgrid__table tr[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 9%, transparent); }
.wp-ai-cgrid__table tr[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 8%, transparent); }
.wp-ai-cgrid__tag { color: var(--wp-accent-400, var(--wp-accent-500)); }
.wp-ai-cgrid__effect { white-space: nowrap; color: var(--wp-text-muted); }
.wp-ai-cgrid__effect[data-effect="exclude"] { color: var(--wp-danger, #e5484d); }
.wp-ai-cgrid__effect[data-effect="boost"] { color: var(--wp-success, #30a46c); }
.wp-ai-cgrid__effect[data-effect="only"] { color: var(--wp-warn); }
</style>
