<script setup lang="ts">
/**
 * AiOptionDiff — a wildcard edit drawn like the wildcard editor's option
 * list: each option with its share of the draw, tags and negative, marked
 * + new, − removed or ~ changed (old struck → new). The options the edit
 * leaves alone fold into "N unchanged" in the chat; the magnifier (`full`)
 * lists them, dimmed.
 */
import { computed } from "vue";
import type { CardView, OptionDiffRow } from "../../../composables/card-views/types";
import { formatProbability } from "../../../utils/percent";
import AiSyntax from "../AiSyntax.vue";
import AiInfoDiff from "./AiInfoDiff.vue";

type View = Extract<CardView, { kind: "options" }>;
const props = defineProps<{ view: View; full?: boolean }>();

/** Changed rows the chat card shows before "+N more". */
const CAP = 8;

const MARK: Record<string, string> = { added: "+", removed: "−", changed: "~", same: "" };
const LABEL: Record<string, string> = { added: "New option", removed: "Removed", changed: "Changed", same: "Unchanged" };

const changed = computed(() => props.view.rows.filter((r) => r.change !== "same"));
const shown = computed<OptionDiffRow[]>(() => (props.full ? props.view.rows : changed.value.slice(0, CAP)));
const more = computed(() => (props.full ? 0 : Math.max(0, changed.value.length - CAP)));

/** The share old → new, only when it moves enough to read differently. */
function shareMoved(r: OptionDiffRow): boolean {
  return r.wasShare !== null && formatProbability(r.wasShare) !== formatProbability(r.share);
}
</script>

<template>
  <div class="wp-ai-optdiff" data-test="ai-card-option-diff">
    <AiInfoDiff v-if="view.fields.length" :rows="view.fields" :full="full" />
    <template v-if="view.rows.length">
      <p class="wp-ai-optdiff__head">
        <span>{{ view.before }} → {{ view.after }} option{{ view.after === 1 ? "" : "s" }}</span>
        <span v-if="view.same && !full" data-test="ai-card-unchanged"> · {{ view.same }} unchanged</span>
      </p>
      <ul class="wp-ai-optdiff__rows">
        <li v-for="r in shown" :key="r.id + r.change" :data-change="r.change" data-test="ai-card-option-row">
          <span class="wp-ai-diff__mark" aria-hidden="true">{{ MARK[r.change] }}</span><span class="wp-ai-diff__sr">{{ LABEL[r.change] }}: </span>
          <div class="wp-ai-optdiff__body">
            <div class="wp-ai-optdiff__line">
              <span class="wp-ai-optdiff__text" :class="{ 'wp-ai-diff__was': r.change === 'removed', 'wp-ai-optdiff__clamp': !full }">
                <template v-if="r.wasText !== null"><span class="wp-ai-diff__was"><AiSyntax v-if="r.wasText" :text="r.wasText" /><template v-else>nothing</template></span><span class="wp-ai-diff__arrow" aria-label="becomes">→</span></template>
                <template v-if="r.empty">∅ nothing</template><AiSyntax v-else :text="r.text" />
              </span>
              <span class="wp-ai-optdiff__share wp-mono" :title="r.wasWeight !== null ? `Weight ${r.wasWeight} → ${r.weight}` : `Weight ${r.weight}`">
                <template v-if="shareMoved(r)"><span class="wp-ai-diff__was">{{ formatProbability(r.wasShare!) }}</span><span class="wp-ai-diff__arrow">→</span></template>{{ formatProbability(r.share) }}
              </span>
            </div>
            <div v-if="r.tags.length || r.fallback || r.wasFallback !== null" class="wp-ai-optdiff__chips">
              <span v-if="r.fallback || r.wasFallback !== null" class="wp-ai-diff__chip" :data-change="r.wasFallback === null ? undefined : r.fallback ? 'added' : 'removed'"><i class="pi pi-shield" aria-hidden="true" />&nbsp;fallback</span>
              <span v-for="t in r.tags" :key="t.tag" class="wp-ai-diff__chip" :data-change="t.change === 'same' ? undefined : t.change">#{{ t.tag }}</span>
            </div>
            <div v-if="r.negative || r.wasNegative" class="wp-ai-optdiff__neg" :class="{ 'wp-ai-optdiff__clamp': !full }">
              <span class="wp-ai-optdiff__neg-label">Negative</span>
              <template v-if="r.wasNegative !== null"><span class="wp-ai-diff__was"><AiSyntax v-if="r.wasNegative" :text="r.wasNegative" /><template v-else>none</template></span><span class="wp-ai-diff__arrow" aria-label="becomes">→</span></template>
              <AiSyntax v-if="r.negative" :text="r.negative" /><span v-else class="wp-ai-diff__none">none</span>
            </div>
          </div>
        </li>
      </ul>
      <p v-if="more" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more }} more change{{ more === 1 ? "" : "s" }}</p>
    </template>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-optdiff { display: flex; flex-direction: column; gap: 6px; }
.wp-ai-optdiff__head { margin: 0; font-size: 11.5px; color: var(--wp-text-muted); }
.wp-ai-optdiff__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wp-ai-optdiff__rows > li { display: flex; gap: 6px; align-items: baseline; padding: 2px 6px 2px 2px; border-radius: 4px; }
.wp-ai-optdiff__rows > li[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 9%, transparent); }
.wp-ai-optdiff__rows > li[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 8%, transparent); }
.wp-ai-optdiff__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-optdiff__line { display: flex; gap: 8px; align-items: baseline; }
.wp-ai-optdiff__text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.wp-ai-optdiff__share { flex: none; font-size: 11.5px; color: var(--wp-text-muted); white-space: nowrap; }
.wp-ai-optdiff__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.wp-ai-optdiff__neg { font-size: 12px; color: var(--wp-text-muted); overflow-wrap: anywhere; }
.wp-ai-optdiff__neg-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 6px; color: var(--wp-danger, #e5484d); }
.wp-ai-optdiff__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
</style>
