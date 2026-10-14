<script setup lang="ts">
/**
 * AiCardView — what a chat create card makes, laid out the way its editor
 * shows it: a constraint as source → target rule rows, a derivation as
 * IF / ELIF / ELSE per rule, fixed values as a table, a combine or template
 * as its text. Read-only; "Open in editor" is where it gets changed.
 *
 * In the chat it stays small: the grid, rules, rows and text are capped
 * (with "+N more") and the card's magnifier shows it `full` in a modal.
 */
import { computed } from "vue";
import type { CardView, ConstraintRowView } from "../../composables/aiCards";

const props = defineProps<{ view: CardView; full?: boolean }>();

/** What the chat card shows before "+N more" (the preview shows all). */
const CAP = { gridFrom: 8, gridTo: 6, pairs: 8, rules: 3, branches: 4, actions: 3, rows: 8 };

function cap<T>(list: T[], n: number): T[] {
  return props.full ? list : list.slice(0, n);
}

function more(list: unknown[], n: number): number {
  return props.full ? 0 : Math.max(0, list.length - n);
}

/** Tag rules as a grid (source tags down, target tags across) once there
 *  are two or more of each, the way the constraint editor's matrix reads. */
const grid = computed(() => {
  const v = props.view;
  if (v.kind !== "constraint") return null;
  const cells = v.rows.filter((r) => r.byTag);
  const from = [...new Set(cells.map((r) => r.from))];
  const to = [...new Set(cells.map((r) => r.to))];
  if (from.length < 2 || to.length < 2) return null;
  const at = (f: string, t: string): ConstraintRowView | undefined => cells.find((r) => r.from === f && r.to === t);
  return { from, to, at };
});
const pairs = computed(() => (props.view.kind === "constraint"
  ? props.view.rows.filter((r) => !grid.value || !r.byTag) : []));

function cellText(r: ConstraintRowView | undefined): string {
  if (!r) return "·";
  if (r.effect === "exclude") return "never";
  if (r.effect === "only") return "only";
  if ((r.effect === "boost" || r.effect === "reduce") && r.factor !== null) return `×${r.factor}`;
  return r.effect;
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
  <div class="wp-ai-card-view" :data-kind="view.kind" data-test="ai-card-view">
    <template v-if="view.kind === 'constraint'">
      <p class="wp-ai-card-view__line">
        When <b>{{ view.source }}</b> picks…, <b>{{ view.target }}</b>{{ view.reach ? ` (${view.reach})` : "" }}:
      </p>
      <div v-if="grid" class="wp-ai-card-view__scroll">
      <table class="wp-ai-card-view__grid" data-test="ai-card-matrix">
        <thead>
          <tr>
            <th />
            <th v-for="t in cap(grid.to, CAP.gridTo)" :key="t" scope="col" class="wp-ai-card-view__tag" :title="t">{{ t }}</th>
            <th v-if="more(grid.to, CAP.gridTo)" scope="col" class="wp-ai-card-view__more">+{{ more(grid.to, CAP.gridTo) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in cap(grid.from, CAP.gridFrom)" :key="f">
            <th scope="row" class="wp-ai-card-view__tag" :title="f">{{ f }}</th>
            <td v-for="t in cap(grid.to, CAP.gridTo)" :key="t" :data-effect="grid.at(f, t)?.effect ?? ''">
              {{ cellText(grid.at(f, t)) }}
            </td>
            <td v-if="more(grid.to, CAP.gridTo)" />
          </tr>
        </tbody>
      </table>
      </div>
      <p v-if="grid && more(grid.from, CAP.gridFrom)" class="wp-ai-card-view__more" data-test="ai-card-more">+{{ more(grid.from, CAP.gridFrom) }} more source tag{{ more(grid.from, CAP.gridFrom) === 1 ? "" : "s" }}</p>
      <table v-if="pairs.length" class="wp-ai-card-view__table">
        <tbody>
          <tr v-for="(r, i) in cap(pairs, CAP.pairs)" :key="i">
            <td><span :class="r.byTag ? 'wp-ai-card-view__tag' : undefined">{{ r.from }}</span></td>
            <td aria-hidden="true">→</td>
            <td><span :class="r.byTag ? 'wp-ai-card-view__tag' : undefined">{{ r.to }}</span></td>
            <td class="wp-ai-card-view__effect" :data-effect="r.effect">{{ effectText(r.effect, r.factor) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="more(pairs, CAP.pairs)" class="wp-ai-card-view__more" data-test="ai-card-more">+{{ more(pairs, CAP.pairs) }} more rule{{ more(pairs, CAP.pairs) === 1 ? "" : "s" }}</p>
    </template>

    <template v-else-if="view.kind === 'derivation'">
      <ol class="wp-ai-card-view__rules">
        <li v-for="(rule, i) in cap(view.rules, CAP.rules)" :key="i">
          <span class="wp-ai-card-view__rule-n">Rule {{ i + 1 }}</span>
          <div v-for="(b, j) in cap(rule, CAP.branches)" :key="j" class="wp-ai-card-view__branch">
            <span class="wp-ai-card-view__kw" :data-kw="b.key">{{ b.key }}</span>
            <code v-if="b.test" :class="{ 'wp-ai-card-view__clamp': !full }">{{ b.test }}</code>
            <ul>
              <li v-for="(a, k) in cap(b.actions, CAP.actions)" :key="k" :class="{ 'wp-ai-card-view__clamp': !full }">{{ a }}</li>
              <li v-if="more(b.actions, CAP.actions)" class="wp-ai-card-view__more">+{{ more(b.actions, CAP.actions) }} more</li>
            </ul>
          </div>
          <p v-if="more(rule, CAP.branches)" class="wp-ai-card-view__more">+{{ more(rule, CAP.branches) }} more branch{{ more(rule, CAP.branches) === 1 ? "" : "es" }}</p>
        </li>
      </ol>
      <p v-if="more(view.rules, CAP.rules)" class="wp-ai-card-view__more" data-test="ai-card-more">+{{ more(view.rules, CAP.rules) }} more rule{{ more(view.rules, CAP.rules) === 1 ? "" : "s" }}</p>
    </template>

    <template v-else-if="view.kind === 'values'">
      <table class="wp-ai-card-view__table">
        <tbody>
          <tr v-for="r in cap(view.rows, CAP.rows)" :key="r.name">
            <td><code>${{ r.name }}</code></td>
            <td :class="{ 'wp-ai-card-view__clamp': !full }">{{ r.value }}<span v-if="r.negative" class="wp-ai-card-view__neg"> − {{ r.negative }}</span></td>
          </tr>
        </tbody>
      </table>
      <p v-if="more(view.rows, CAP.rows)" class="wp-ai-card-view__more" data-test="ai-card-more">+{{ more(view.rows, CAP.rows) }} more value{{ more(view.rows, CAP.rows) === 1 ? "" : "s" }}</p>
    </template>

    <dl v-else class="wp-ai-card-view__text">
      <template v-for="r in view.rows" :key="r.label">
        <dt>{{ r.label }}</dt>
        <dd :class="{ 'wp-ai-card-view__clamp wp-ai-card-view__clamp--6': !full }">{{ r.text }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
.wp-ai-card-view { font-size: 12.5px; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 6px; background: var(--wp-bg-sunken, rgb(0 0 0 / 15%)); }
.wp-ai-card-view__line { margin: 0; }
.wp-ai-card-view__grid { border-collapse: collapse; font-size: 11.5px; }
.wp-ai-card-view__grid th, .wp-ai-card-view__grid td { padding: 2px 6px; border: 1px solid var(--wp-border); text-align: center; font-weight: 400; }
.wp-ai-card-view__grid th[scope="row"] { text-align: left; }
.wp-ai-card-view__grid td { color: var(--wp-text-dim); }
.wp-ai-card-view__grid td[data-effect="exclude"] { color: var(--wp-danger, #e5484d); }
.wp-ai-card-view__grid td[data-effect="boost"], .wp-ai-card-view__grid td[data-effect="only"] { color: var(--wp-success, #46a758); }
.wp-ai-card-view__grid td[data-effect="reduce"] { color: var(--wp-warn); }
.wp-ai-card-view__table { border-collapse: collapse; width: 100%; }
.wp-ai-card-view__table td { padding: 2px 6px 2px 0; vertical-align: top; overflow-wrap: anywhere; }
.wp-ai-card-view__tag { color: var(--wp-accent-400, var(--wp-accent-500)); }
.wp-ai-card-view__effect { white-space: nowrap; color: var(--wp-text-muted); }
.wp-ai-card-view__effect[data-effect="exclude"] { color: var(--wp-danger, #e5484d); }
.wp-ai-card-view__effect[data-effect="boost"] { color: var(--wp-success, #30a46c); }
.wp-ai-card-view__effect[data-effect="only"] { color: var(--wp-warn); }
.wp-ai-card-view__neg { color: var(--wp-text-muted); }
.wp-ai-card-view__rules { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.wp-ai-card-view__rule-n { font-size: 11px; color: var(--wp-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.wp-ai-card-view__branch { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 8px; align-items: baseline; margin-top: 2px; }
.wp-ai-card-view__branch ul { grid-column: 2; margin: 0; padding-left: 16px; }
.wp-ai-card-view__branch code { overflow-wrap: anywhere; }
.wp-ai-card-view__kw { font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: color-mix(in oklab, var(--wp-warn) 22%, transparent); color: var(--wp-warn); }
.wp-ai-card-view__kw[data-kw="ELSE"] { grid-row: span 1; }
.wp-ai-card-view__text { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 0; }
.wp-ai-card-view__text dt { color: var(--wp-text-muted); }
.wp-ai-card-view__text dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-ai-card-view__scroll { overflow-x: auto; max-width: 100%; }
.wp-ai-card-view__grid th { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ai-card-view__more { margin: 0; font-size: 11.5px; color: var(--wp-text-muted); }
th.wp-ai-card-view__more { border: 0; }
/* Long values: a few lines in the chat; the preview shows them whole. */
.wp-ai-card-view__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.wp-ai-card-view__clamp--6 { -webkit-line-clamp: 6; line-clamp: 6; }
code.wp-ai-card-view__clamp { display: -webkit-box; }
</style>
