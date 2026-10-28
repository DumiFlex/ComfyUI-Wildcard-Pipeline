<script setup lang="ts">
/**
 * PackItemEditor — one plan item edited by hand (no model), or rewritten
 * by the model from a one-line ask. Fields commit on change (blur or
 * Enter) so the server's check never rewrites a field mid-typing.
 */
import WpNumber from "@/components/shared/WpNumber.vue";
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import Select from "../ui/Select.vue";
import type { SelectOption } from "../ui/select-types";
import type { AiPackItem } from "../../api/types";
import { usePackBuilder } from "../../composables/usePackBuilder";
import PackGraphItem from "./PackGraphItem.vue";

const props = defineProps<{ item: AiPackItem }>();
const pb = usePackBuilder();
const ask = ref("");

const i = computed(() => props.item);
const busy = computed(() => pb.convo.loading.value || !!pb.changing.value);
const wild = computed(() => i.value.kind === "wildcard");
/** A graph plan: the item is compiled from the graph, so its rules,
 *  axes, use and template come from the graph editor below. */
const graphed = computed(() => !!pb.draft.value?.graph && i.value.kind !== "library");
const hasVar = computed(() => !["constraint", "template", "library"].includes(i.value.kind)
  && !(graphed.value && i.value.kind === "derivation"));
const hasUse = computed(() => !graphed.value && i.value.kind !== "constraint" && i.value.kind !== "template"
  && !(wild.value && !i.value.var));
const wildcardVars = computed<SelectOption[]>(() => (pb.plan.value?.items ?? [])
  .filter((x) => (x.kind === "wildcard" || (x.kind === "library" && x.library_type !== "fixed_values")) && x.var)
  .map((x) => ({ value: x.var, label: `$${x.var} · ${x.name}` })));
const sections = computed(() => (pb.draft.value?.sections ?? []).map((s) => s.name));

function text(ev: Event): string {
  return (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
}

/** A graph slot's "what" without the axes the plan line adds to it: the
 *  axes are edited below, and showing them here twice read as a repeat
 *  (and an edit wrote them into the slot's own words). */
const aboutText = computed(() => (graphed.value && wild.value
  ? i.value.about.replace(/\.\s+(?:Axes: |Sweep axis).*$/s, "")
  : i.value.about));

function set(field: keyof AiPackItem, value: unknown): void {
  pb.editItem(i.value.key, { [field]: value } as Partial<AiPackItem>);
}

function setTags(raw: string): void {
  const tags = [...new Set(raw.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean))];
  set("tags", tags);
}

function setCount(v: number | null): void {
  const n = Math.round(Number(v));
  if (Number.isFinite(n) && n > 0) set("count", Math.min(60, n));
}

function makeNew(): void {
  pb.editItem(i.value.key, { kind: "wildcard", count: 12, library_id: "", library_type: "" });
}

async function send(): Promise<void> {
  if (await pb.changeItem(i.value.key, ask.value)) ask.value = "";
}
</script>

<template>
  <div class="wp-pack-edit" data-test="pack-item-editor">
    <p v-if="i.kind === 'library'" class="wp-pack-edit__note">
      Your {{ i.library_type === 'fixed_values' ? 'fixed values' : 'wildcard' }}, used as it is.
      <button type="button" class="wp-pack-edit__link" :disabled="busy" @click="makeNew">Write a new one instead</button>
    </p>
    <div class="wp-pack-edit__grid">
      <label v-if="i.kind !== 'library'" class="wp-pack-edit__field">
        <span>Name</span>
        <input class="wp-input wp-input--sm" :value="i.name" :disabled="busy" data-test="pack-edit-name" @change="set('name', text($event))">
      </label>
      <label v-if="hasVar" class="wp-pack-edit__field">
        <span>Variable</span>
        <input class="wp-input wp-input--sm" :value="i.var" :placeholder="wild ? 'none: a vocabulary' : ''" :disabled="busy" data-test="pack-edit-var" @change="set('var', text($event).replace(/^\$/, '').trim())">
      </label>
      <label class="wp-pack-edit__field">
        <span>Section</span>
        <input class="wp-input wp-input--sm" :value="i.section" list="wp-pack-sections" placeholder="the pack bundle" :disabled="busy || i.kind === 'constraint'" data-test="pack-edit-section" @change="set('section', text($event).trim())">
      </label>
      <label v-if="wild" class="wp-pack-edit__field">
        <span>Options</span>
        <WpNumber commit="input" size="sm" :model-value="i.count" :min="4" :max="60" :disabled="busy" aria-label="Options" @update:model-value="setCount" />
      </label>
      <template v-if="i.kind === 'constraint' && !graphed">
        <label class="wp-pack-edit__field">
          <span>When</span>
          <Select size="sm" :model-value="i.source" :options="wildcardVars" :disabled="busy" aria-label="Source wildcard" @update:model-value="(v) => set('source', v)" />
        </label>
        <label class="wp-pack-edit__field">
          <span>Limits</span>
          <Select size="sm" :model-value="i.target" :options="wildcardVars" :disabled="busy" aria-label="Target wildcard" @update:model-value="(v) => set('target', v)" />
        </label>
      </template>
    </div>
    <label v-if="i.kind !== 'library' && (!graphed || wild)" class="wp-pack-edit__field">
      <span>{{ i.kind === 'derivation' ? 'Rules, in plain words' : i.kind === 'constraint' ? 'What it rules out or favours' : 'What it holds' }}</span>
      <textarea class="wp-textarea wp-pack-edit__about" rows="2" :value="aboutText" :disabled="busy" data-test="pack-edit-about" @change="set('about', text($event))" />
    </label>
    <PackGraphItem v-if="graphed" :item="i" />
    <label v-if="wild && !graphed" class="wp-pack-edit__field">
      <span>Tags (rules key on them)</span>
      <input class="wp-input wp-input--sm" :value="i.tags.join(', ')" placeholder="warm, cold, formal" :disabled="busy" data-test="pack-edit-tags" @change="setTags(text($event))">
    </label>
    <label v-if="hasUse" class="wp-pack-edit__field">
      <span>Use in the bundle</span>
      <input class="wp-input wp-input--sm" :value="i.use" placeholder="pick 2-3; hold the pick across the batch" :disabled="busy" data-test="pack-edit-use" @change="set('use', text($event))">
    </label>
    <datalist id="wp-pack-sections">
      <option v-for="s in sections" :key="s" :value="s" />
    </datalist>
    <div class="wp-pack-edit__ask">
      <input
        v-model="ask"
        class="wp-input wp-input--sm"
        placeholder="Ask the AI to change just this item…"
        aria-label="Ask the AI to change this item"
        :disabled="busy"
        data-test="pack-item-ask"
        @keydown.enter.prevent="send"
      >
      <Button size="sm" icon="pi-microchip-ai" :disabled="!ask.trim() || busy" :loading="pb.changing.value === i.key" data-test="pack-item-change" @click="send">Change</Button>
    </div>
  </div>
</template>

<style scoped>
.wp-pack-edit { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 10px; margin: 0 0 6px; border-radius: 8px; background: var(--wp-bg-1); }
.wp-pack-edit__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.wp-pack-edit__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-pack-edit__field > span { font-size: 11px; color: var(--wp-text-dim); }
.wp-pack-edit__field input, .wp-pack-edit__about { width: 100%; }
.wp-pack-edit__about { resize: vertical; font-size: 12.5px; }
.wp-pack-edit__note { margin: 0; font-size: 12.5px; color: var(--wp-text-muted); }
.wp-pack-edit__link { border: 0; background: none; padding: 0; color: var(--wp-accent-text); cursor: pointer; font: inherit; text-decoration: underline; }
.wp-pack-edit__ask { display: flex; gap: 6px; align-items: center; }
.wp-pack-edit__ask input { flex: 1; min-width: 0; }
</style>
