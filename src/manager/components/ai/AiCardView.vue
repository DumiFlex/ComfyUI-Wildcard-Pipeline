<script setup lang="ts">
/**
 * AiCardView — what a chat create card makes, laid out the way its editor
 * shows it: a constraint as source → target rule rows, a derivation as
 * IF / ELIF / ELSE per rule, fixed values as a table, a combine or template
 * as its text. Read-only; "Open in editor" is where it gets changed.
 */
import type { CardView } from "../../composables/aiCards";

defineProps<{ view: CardView }>();

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
      <table class="wp-ai-card-view__table">
        <tbody>
          <tr v-for="(r, i) in view.rows" :key="i">
            <td><span :class="r.byTag ? 'wp-ai-card-view__tag' : undefined">{{ r.from }}</span></td>
            <td aria-hidden="true">→</td>
            <td><span :class="r.byTag ? 'wp-ai-card-view__tag' : undefined">{{ r.to }}</span></td>
            <td class="wp-ai-card-view__effect" :data-effect="r.effect">{{ effectText(r.effect, r.factor) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-else-if="view.kind === 'derivation'">
      <ol class="wp-ai-card-view__rules">
        <li v-for="(rule, i) in view.rules" :key="i">
          <span class="wp-ai-card-view__rule-n">Rule {{ i + 1 }}</span>
          <div v-for="(b, j) in rule" :key="j" class="wp-ai-card-view__branch">
            <span class="wp-ai-card-view__kw" :data-kw="b.key">{{ b.key }}</span>
            <code v-if="b.test">{{ b.test }}</code>
            <ul>
              <li v-for="(a, k) in b.actions" :key="k">{{ a }}</li>
            </ul>
          </div>
        </li>
      </ol>
    </template>

    <table v-else-if="view.kind === 'values'" class="wp-ai-card-view__table">
      <tbody>
        <tr v-for="r in view.rows" :key="r.name">
          <td><code>${{ r.name }}</code></td>
          <td>{{ r.value }}<span v-if="r.negative" class="wp-ai-card-view__neg"> − {{ r.negative }}</span></td>
        </tr>
      </tbody>
    </table>

    <dl v-else class="wp-ai-card-view__text">
      <template v-for="r in view.rows" :key="r.label">
        <dt>{{ r.label }}</dt>
        <dd>{{ r.text }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
.wp-ai-card-view { font-size: 12.5px; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 6px; background: var(--wp-bg-sunken, rgb(0 0 0 / 15%)); }
.wp-ai-card-view__line { margin: 0; }
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
</style>
