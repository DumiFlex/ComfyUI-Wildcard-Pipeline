<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance, patchInstanceMapEntry } from "../../instance/patch";
import { isEnabled, type WildcardOption } from "../probability";
import OptionRow from "./OptionRow.vue";

interface OptionFull extends WildcardOption {
  value: string;
}

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const payload = computed(() => (props.module.payload ?? {}) as {
  options?: OptionFull[];
  sub_categories?: string[];
});
const instance = computed(() => props.module.instance ?? {});
const allOptions = computed<OptionFull[]>(() => payload.value.options ?? []);
const subCategories = computed<string[]>(() => payload.value.sub_categories ?? []);

function isCategoryOn(cat: string): boolean {
  const filter = instance.value.category_filter;
  if (!Array.isArray(filter)) return true;
  return filter.includes(cat);
}

function categoryOptionCount(cat: string): number {
  return allOptions.value.filter((o) => o.sub_category === cat).length;
}

function onCategoryClick(cat: string): void {
  const filter = instance.value.category_filter;
  let next: string[] | null;
  if (!Array.isArray(filter)) {
    // Currently null (all on) → click removes the clicked cat → others on
    next = subCategories.value.filter((c) => c !== cat);
  } else if (filter.includes(cat)) {
    next = filter.filter((c) => c !== cat);
  } else {
    next = [...filter, cat];
  }
  // If next contains every category, collapse back to null (= library default).
  if (next && next.length === subCategories.value.length) {
    next = null;
  }
  emit("update", patchInstance(props.module, "category_filter", next));
}

function onOptionToggle(optionId: string): void {
  const ids = allOptions.value.map((o) => o.id);
  const currentlyEnabled = instance.value.enabled_options;
  const enabledSet = new Set<string>(
    Array.isArray(currentlyEnabled) ? currentlyEnabled : ids,
  );
  if (enabledSet.has(optionId)) {
    enabledSet.delete(optionId);
  } else {
    enabledSet.add(optionId);
  }
  // Preserve library order in the emitted array.
  const next = ids.filter((id) => enabledSet.has(id));
  // Collapse to null when all options are enabled (= library default).
  const collapsed = next.length === ids.length ? null : next;
  emit("update", patchInstance(props.module, "enabled_options", collapsed));
}

function onOptionWeight(optionId: string, weight: number | null): void {
  emit("update", patchInstanceMapEntry(props.module, "option_weights", optionId, weight));
}

const enabledCount = computed(
  () => allOptions.value.filter((o) => isEnabled(o, instance.value)).length,
);
const totalCount = computed(() => allOptions.value.length);
const skewedTowards = computed(() => {
  const overrides = instance.value.option_weights;
  if (!overrides || Object.keys(overrides).length === 0) return null;
  let topId: string | null = null;
  let topWeight = -Infinity;
  for (const [id, w] of Object.entries(overrides)) {
    if (w > topWeight) {
      topWeight = w;
      topId = id;
    }
  }
  if (!topId) return null;
  return allOptions.value.find((o) => o.id === topId)?.value ?? null;
});
</script>

<template>
  <section class="pool">
    <div class="pool__label">Pool · what RNG can pick from</div>

    <div class="pool__chips">
      <button
        v-for="cat in subCategories"
        :key="cat"
        type="button"
        class="cat-chip"
        :class="{ 'cat-chip--on': isCategoryOn(cat) }"
        :data-test="`cat-chip-${cat}`"
        role="checkbox"
        :aria-checked="isCategoryOn(cat)"
        @click="onCategoryClick(cat)"
      >
        {{ cat }}
        <span class="cat-chip__count">{{ categoryOptionCount(cat) }}</span>
      </button>
    </div>

    <div class="pool__opts">
      <div class="pool__opt-head">
        <span></span>
        <span class="pool__opt-head-cell">Option</span>
        <span class="pool__opt-head-cell">Probability</span>
        <span class="pool__opt-head-cell pool__opt-head-cell--right">Weight</span>
        <span class="pool__opt-head-cell pool__opt-head-cell--right">Category</span>
      </div>
      <OptionRow
        v-for="option in allOptions"
        :key="option.id"
        :option="option"
        :all-options="allOptions"
        :instance="instance"
        @toggle="onOptionToggle"
        @weight="onOptionWeight"
      />
    </div>

    <div class="pool__summary" data-test="pool-summary">
      <strong>{{ enabledCount }} of {{ totalCount }}</strong> enabled
      <template v-if="skewedTowards">
        <span class="pool__summary-dot">·</span>
        skewed toward <strong>{{ skewedTowards }}</strong>
      </template>
    </div>
  </section>
</template>

<style scoped>
.pool {
  padding: 12px 16px;
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.pool__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 8px;
}
.pool__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.cat-chip:hover { border-color: var(--wp-border-soft, var(--wp-border)); }
.cat-chip--on {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.10);
}
.cat-chip__count {
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.cat-chip--on .cat-chip__count { color: var(--wp-accent-text, var(--wp-text)); }
.pool__opts {
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
}
.pool__opt-head {
  display: grid;
  grid-template-columns: 22px 130px 1fr 56px 60px;
  gap: 12px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
.pool__opt-head-cell {
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.pool__opt-head-cell--right { text-align: right; }
.pool__summary {
  margin-top: 10px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  display: flex;
  align-items: center;
  gap: 6px;
}
.pool__summary strong {
  color: var(--wp-accent-text, var(--wp-text));
  font-weight: 600;
}
.pool__summary-dot { color: var(--wp-border-soft, var(--wp-border)); }
</style>
