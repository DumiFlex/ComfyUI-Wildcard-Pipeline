<script setup lang="ts">
/**
 * AiValuesTable — fixed values the way the Fixed values editor lists them:
 * one row per value with its variable, value and negative in their own
 * columns. On a change card each row is marked (+ new, − removed struck,
 * ~ changed with old → new per column) and the rows left alone fold into
 * "N unchanged" (the magnifier lists them, dimmed).
 */
import { computed } from "vue";
import type { CardView, ValueRowView } from "../../../composables/card-views/types";
import AiSyntax from "../AiSyntax.vue";

type View = Extract<CardView, { kind: "values" }>;
const props = defineProps<{ view: View; full?: boolean }>();

const CAP = 8;
const MARK: Record<string, string> = { added: "+", removed: "−", changed: "~", same: "" };

const isChange = computed(() => props.view.rows.some((r) => r.change));
const listed = computed<ValueRowView[]>(() => (props.full || !isChange.value ? props.view.rows
  : props.view.rows.filter((r) => r.change !== "same")));
const shown = computed(() => (props.full ? listed.value : listed.value.slice(0, CAP)));
const more = computed(() => (props.full ? 0 : Math.max(0, listed.value.length - CAP)));
const hasNegative = computed(() => props.view.rows.some((r) => r.negative || r.wasNegative));
</script>

<template>
  <div class="wp-ai-values">
    <table class="wp-ai-values__table" data-test="ai-card-values">
      <thead>
        <tr>
          <th v-if="isChange" aria-hidden="true" />
          <th scope="col">Variable</th>
          <th scope="col">Value</th>
          <th v-if="hasNegative" scope="col">Negative</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in shown" :key="i" :data-change="r.change" data-test="ai-card-value-row">
          <td v-if="isChange" class="wp-ai-diff__mark" aria-hidden="true">{{ MARK[r.change ?? "same"] }}</td>
          <td class="wp-ai-values__name" :class="{ 'wp-ai-diff__was': r.change === 'removed' }">
            <template v-if="r.wasName"><code class="wp-ai-diff__was">${{ r.wasName }}</code><span class="wp-ai-diff__arrow">→</span></template><code>${{ r.name }}</code>
          </td>
          <td :class="{ 'wp-ai-diff__was': r.change === 'removed' }">
            <div :class="{ 'wp-ai-values__clamp': !full }">
              <template v-if="r.wasValue !== null && r.wasValue !== undefined"><span class="wp-ai-diff__was"><AiSyntax :text="r.wasValue" /></span><span class="wp-ai-diff__arrow">→</span></template><AiSyntax :text="r.value" />
            </div>
          </td>
          <td v-if="hasNegative" class="wp-ai-values__neg" :class="{ 'wp-ai-diff__was': r.change === 'removed' }">
            <div :class="{ 'wp-ai-values__clamp': !full }">
              <template v-if="r.wasNegative !== null && r.wasNegative !== undefined"><span class="wp-ai-diff__was"><AiSyntax v-if="r.wasNegative" :text="r.wasNegative" /><template v-else>none</template></span><span class="wp-ai-diff__arrow">→</span></template>
              <AiSyntax v-if="r.negative" :text="r.negative" /><span v-else class="wp-ai-diff__none">none</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="more" class="wp-ai-diff__more" data-test="ai-card-more">+{{ more }} more value{{ more === 1 ? "" : "s" }}</p>
    <p v-if="view.same && !full" class="wp-ai-diff__more" data-test="ai-card-unchanged">{{ view.same }} value{{ view.same === 1 ? "" : "s" }} unchanged</p>
  </div>
</template>

<style scoped src="./card-diff.css"></style>
<style scoped>
.wp-ai-values { display: flex; flex-direction: column; gap: 4px; }
.wp-ai-values__table { border-collapse: collapse; width: 100%; table-layout: auto; }
.wp-ai-values__table th { text-align: left; font-weight: 500; font-size: 11px; color: var(--wp-text-muted); padding: 0 8px 2px 0; }
.wp-ai-values__table td { padding: 2px 8px 2px 0; vertical-align: top; overflow-wrap: anywhere; }
.wp-ai-values__table tr[data-change="added"] { background: color-mix(in oklab, var(--wp-success, #30a46c) 9%, transparent); }
.wp-ai-values__table tr[data-change="removed"] { background: color-mix(in oklab, var(--wp-danger, #e5484d) 8%, transparent); }
.wp-ai-values__name { white-space: nowrap; }
.wp-ai-values__neg { color: var(--wp-text-muted); }
.wp-ai-values__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
</style>
