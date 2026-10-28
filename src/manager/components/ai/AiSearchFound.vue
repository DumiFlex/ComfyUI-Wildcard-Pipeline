<script setup lang="ts">
/**
 * AiSearchFound — what the allowed web searches found, shown before the
 * model gets any of it (`composables/searchFound.ts` holds the state).
 * "Use what fits" sends everything and lets the model keep what fits; ticking
 * rows sends only those; "None of these" sends nothing. Afterwards it folds
 * to one line saying what was used.
 */
import Button from "../ui/Button.vue";
import Checkbox from "../ui/Checkbox.vue";
import { siteOf, type SearchFound } from "../../composables/searchFound";

const props = withDefaults(defineProps<{
  state: SearchFound;
  busy?: boolean;
  /** Who reads the results: "the planner", "the AI". */
  who?: string;
  /** What happens after, for the buttons: "update the plan", "refine". */
  then?: string;
  compact?: boolean;
}>(), { busy: false, who: "the AI", then: "refine", compact: false });
const emit = defineEmits<{
  /** Send the results: all of them (`fits`) or the ticked ones. */
  (e: "use", fits: boolean): void;
  (e: "none"): void;
}>();

const s = props.state;
</script>

<template>
  <section
    v-if="s.found.value.length"
    class="wp-ai-found"
    :data-compact="compact || undefined"
    aria-label="What the web searches found"
    data-test="ai-found"
  >
    <header class="wp-ai-found__head">
      <i class="pi pi-globe" aria-hidden="true" />
      <span>What the searches found</span>
    </header>
    <p class="wp-ai-found__why">
      Nothing goes to {{ who }} until you choose. <b>Use what fits</b> sends all of it and {{ who }} keeps only
      what matches; tick results to send just those. Either way it reads them as reference, never as instructions.
    </p>
    <div v-for="(r, qi) in s.found.value" :key="r.query" class="wp-ai-found__query">
      <p class="wp-ai-found__q"><i class="pi pi-search" aria-hidden="true" /> {{ r.query }}</p>
      <p v-if="r.error" class="wp-ai-found__none" data-test="ai-found-error">The search failed: {{ r.error }}</p>
      <p v-else-if="!r.rows?.length" class="wp-ai-found__none">Nothing found.</p>
      <ul v-else class="wp-ai-found__rows">
        <li v-for="(row, ri) in r.rows" :key="row.url + ri" :data-picked="s.picks.value.has(`${qi}:${ri}`) || undefined">
          <label>
            <Checkbox class="wp-checkbox--inline" :model-value="s.picks.value.has(`${qi}:${ri}`)" :disabled="busy" :aria-label="`Use ${row.title}`" data-test="ai-found-row" @update:model-value="s.toggle(qi, ri)" />
            <span class="wp-ai-found__body">
              <span class="wp-ai-found__title">{{ row.title }}</span>
              <span class="wp-ai-found__site" :title="row.url">{{ siteOf(row.url) }}</span>
              <span v-if="row.snippet" class="wp-ai-found__snippet">{{ row.snippet }}</span>
            </span>
          </label>
        </li>
      </ul>
    </div>
    <div class="wp-ai-found__actions">
      <button
        v-if="s.count.value > 1"
        type="button"
        class="wp-ai-found__mini"
        :disabled="busy"
        data-test="ai-found-all"
        @click="s.setAll(s.picks.value.size < s.count.value)"
      >{{ s.picks.value.size < s.count.value ? "Tick all" : "Untick all" }}</button>
      <span class="wp-ai-found__spacer" />
      <Button size="sm" variant="ghost" :disabled="busy" data-test="ai-found-none" @click="emit('none')">None of these</Button>
      <Button
        v-if="s.picks.value.size"
        size="sm"
        variant="secondary"
        icon="pi-check-square"
        :disabled="busy"
        data-test="ai-found-use"
        @click="emit('use', false)"
      >Use {{ s.picks.value.size }} ticked</Button>
      <Button
        size="sm"
        variant="primary"
        icon="pi-sparkles"
        :disabled="busy"
        data-test="ai-found-fits"
        @click="emit('use', true)"
      >Use what fits and {{ then }}</Button>
    </div>
  </section>
  <p v-else-if="s.used.value.length" class="wp-ai-found__used" data-test="ai-found-used">
    <i class="pi pi-globe" aria-hidden="true" />
    <span>Web search: {{ s.usedLine.value }}.</span>
  </p>
</template>

<style scoped>
.wp-ai-found {
  display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: min(10px, var(--wp-radius-cap, 999px));
  border: 1px solid var(--wp-accent-400); background: color-mix(in oklab, var(--wp-accent-500) 6%, var(--wp-bg-1));
}
.wp-ai-found[data-compact] { padding: 10px 12px; gap: 8px; border-radius: min(8px, var(--wp-radius-cap, 999px)); }
.wp-ai-found__head { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--wp-text); }
.wp-ai-found[data-compact] .wp-ai-found__head { font-size: 13px; }
.wp-ai-found__head .pi { color: var(--wp-accent-text); font-size: 16px; }
.wp-ai-found__why { margin: 0; font-size: 12px; line-height: 1.5; color: var(--wp-text-muted); }
.wp-ai-found__why b { color: var(--wp-text); font-weight: 600; }
.wp-ai-found__query { display: flex; flex-direction: column; gap: 4px; }
.wp-ai-found__q { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--wp-text); display: flex; gap: 6px; align-items: baseline; }
.wp-ai-found__q .pi { font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-found__none { margin: 0 0 0 18px; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-found__rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-found__rows label { display: flex; gap: 10px; align-items: flex-start; padding: 6px 8px; border-radius: min(6px, var(--wp-radius-cap, 999px)); cursor: pointer; }
.wp-ai-found__rows li:hover label { background: var(--wp-bg-3); }
.wp-ai-found__rows li[data-picked] label { background: color-mix(in oklab, var(--wp-accent-500) 10%, transparent); }
.wp-ai-found__rows .wp-checkbox { margin-top: 3px; }
.wp-ai-found__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-ai-found__title { font-size: 13px; color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-found__site { font-size: 11.5px; color: var(--wp-success); }
.wp-ai-found__snippet {
  font-size: 12px; line-height: 1.45; color: var(--wp-text-muted); display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; overflow-wrap: anywhere;
}
.wp-ai-found__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wp-ai-found__spacer { flex: 1; }
.wp-ai-found__mini { border: 0; background: none; padding: 0 4px; font-size: 11.5px; color: var(--wp-text-dim); cursor: pointer; }
.wp-ai-found__mini:hover { color: var(--wp-text); }
.wp-ai-found__used { margin: 0; display: flex; gap: 6px; align-items: baseline; font-size: 12px; color: var(--wp-text-muted); }
</style>
