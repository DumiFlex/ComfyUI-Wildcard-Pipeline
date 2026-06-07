<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import type { PairingBadge } from "../../../../../extension/constraint-pairs";
import { patchInstance, patchInstanceMapEntry } from "../../instance/patch";
import { isEnabled, type WildcardOption } from "../probability";
import {
  parse,
  matches,
  readsAs,
  validateExpression,
  type Ast,
} from "@/manager/parsing/subcatFilter";
import OptionRow from "./OptionRow.vue";

interface OptionFull extends WildcardOption {
  value: string;
}

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** Per-option pair badges for via-nested constraint carriers.
     *  Keyed by option id. Empty when this wildcard is not a carrier. */
    viaOptionPairs?: Map<string, PairingBadge[]>;
  }>(),
  { viaOptionPairs: () => new Map() },
);
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const payload = computed(() => (props.module.payload ?? {}) as {
  options?: OptionFull[];
  sub_categories?: string[];
  tag_groups?: Record<string, string[]>;
});
const instance = computed(() => props.module.instance ?? {});
const allOptions = computed<OptionFull[]>(() => payload.value.options ?? []);
const subCategories = computed<string[]>(() => payload.value.sub_categories ?? []);
const tagGroups = computed<Record<string, string[]>>(() => payload.value.tag_groups ?? {});
const knownSet = computed(() => new Set(subCategories.value));

/** True when the payload declares a null option (resolves to empty).
 *  Surfaces the exclude-null toggle only when it can apply. */
const hasNullOption = computed(() => allOptions.value.some((o) => o.is_null));

/** Current filter as a string (new multi-tag model). Empty = no filter. */
const filterExpr = computed(() => (instance.value.category_filter ?? "").trim());

/* ── Grouped quick pills ────────────────────────────────────────────
 * Pills are clustered by `tag_groups` axis (insertion order); any tag
 * not in a group falls into a trailing "other" cluster. Toggling a pill
 * rebuilds `category_filter`: OR within an axis, AND across axes, with a
 * multi-term axis clause wrapped in parens. */

const OTHER = "other";

interface PillGroup {
  axis: string;
  tags: string[];
}

const pillGroups = computed<PillGroup[]>(() => {
  const groups: PillGroup[] = [];
  const claimed = new Set<string>();
  for (const [axis, members] of Object.entries(tagGroups.value)) {
    const tags = (members ?? []).filter((t) => subCategories.value.includes(t));
    tags.forEach((t) => claimed.add(t));
    if (tags.length > 0) groups.push({ axis, tags });
  }
  const ungrouped = subCategories.value.filter((t) => !claimed.has(t));
  if (ungrouped.length > 0) groups.push({ axis: OTHER, tags: ungrouped });
  return groups;
});

/** Tag atoms present in a parsed filter expression (structure ignored).
 *  Round-trips pill-built expressions and degrades gracefully for advanced
 *  ones (toggling a pill rebuilds the simple OR/AND form). */
function tagsInExpression(expr: string): Set<string> {
  const seen = new Set<string>();
  let ast: Ast | null;
  try {
    ast = parse(expr);
  } catch {
    return seen;
  }
  const walk = (n: Ast | null): void => {
    if (!n) return;
    if ("tag" in n) { seen.add(n.tag); return; }
    if (n.op === "not") { walk(n.x); return; }
    n.kids.forEach(walk);
  };
  walk(ast);
  return seen;
}

/** Local pill selection. Seeded from the incoming filter, mutated locally
 *  on each click so consecutive ticks accumulate without waiting for the
 *  parent to feed the patched instance back as a prop. Re-syncs whenever
 *  the upstream filter changes by a route other than our own pill clicks
 *  (e.g. the advanced editor, or an external reset). */
const ticked = ref<Set<string>>(tagsInExpression(filterExpr.value));
watch(filterExpr, (next) => {
  const incoming = tagsInExpression(next);
  // Only overwrite when the upstream set genuinely differs from ours —
  // avoids clobbering an in-flight local toggle on the same tick.
  const same =
    incoming.size === ticked.value.size &&
    [...incoming].every((t) => ticked.value.has(t));
  if (!same) ticked.value = incoming;
});

function isTagTicked(tag: string): boolean {
  return ticked.value.has(tag);
}

/** Recompute the filter string from a ticked-tag set, respecting group
 *  structure: OR within a group, AND across groups, parens around a
 *  multi-term group clause, empty selection → "". */
function buildExpression(ticked: Set<string>): string {
  const clauses: string[] = [];
  for (const group of pillGroups.value) {
    const picked = group.tags.filter((t) => ticked.has(t));
    if (picked.length === 0) continue;
    const clause = picked.join(" or ");
    clauses.push(picked.length > 1 ? `(${clause})` : clause);
  }
  return clauses.join(" and ");
}

function onPillClick(tag: string): void {
  const next = new Set(ticked.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  ticked.value = next;
  const expr = buildExpression(next);
  emit("update", patchInstance(props.module, "category_filter", expr));
}

/** Per-axis pill colour — mirrors OptionRow's CATEGORY chip hues so a tag
 *  reads with the same colour in both surfaces. */
const AXIS_HUES = [
  "var(--wp-kind-wildcard, #a78bfa)",
  "var(--wp-teal, #33d6c6)",
  "var(--wp-status-modified, #fb923c)",
  "var(--wp-accent2, #a970ff)",
  "var(--wp-success, #22c55e)",
];
function axisHue(axis: string): string {
  if (axis === OTHER) return "var(--wp-text-dim, var(--wp-text3))";
  const idx = pillGroups.value.findIndex((g) => g.axis === axis);
  return AXIS_HUES[(idx < 0 ? 0 : idx) % AXIS_HUES.length];
}

function categoryOptionCount(cat: string): number {
  return allOptions.value.filter((o) => (o.sub_categories ?? []).includes(cat)).length;
}

/* ── Advanced expression editor ─────────────────────────────────────
 * Text-first boolean editor (§4.1 grammar) bound to the same
 * `category_filter`. Local draft + live validation: only a valid (or
 * empty) expression commits upward, mirroring the picker's Apply-disabled-
 * while-invalid contract — so `category_filter` is never persisted broken. */

const advanced = ref(false);
const draft = ref(filterExpr.value);

// Re-seed the draft when the upstream filter changes (e.g. pills edited it
// before the user opened Advanced).
watch(filterExpr, (next) => {
  if (next !== draft.value.trim()) draft.value = next;
});

const draftError = computed<string | null>(() => validateExpression(draft.value, knownSet.value));
const draftReadsAs = computed<string>(() => {
  if (draftError.value) return "";
  try {
    return readsAs(parse(draft.value));
  } catch {
    return "";
  }
});

/** Live match count for the current valid draft — "N of M options match". */
const draftMatchCount = computed<number>(() => {
  if (draftError.value) return 0;
  let ast: Ast | null;
  try {
    ast = parse(draft.value);
  } catch {
    return 0;
  }
  return allOptions.value.filter(
    (o) => o.is_null || matches(ast, new Set(o.sub_categories ?? [])),
  ).length;
});

function onDraftInput(): void {
  if (draftError.value) return; // hold — don't persist a broken expression
  emit("update", patchInstance(props.module, "category_filter", draft.value.trim()));
}

function toggleAdvanced(): void {
  advanced.value = !advanced.value;
  if (advanced.value) draft.value = filterExpr.value;
}

/* ── Exclude null ───────────────────────────────────────────────────── */

const excludeNull = computed(() => instance.value.exclude_null === true);
function setExcludeNull(next: boolean): void {
  emit("update", patchInstance(props.module, "exclude_null", next));
}

/* ── Option rows (unchanged behaviour) ──────────────────────────────── */

function onOptionToggle(optionId: string): void {
  const ids = allOptions.value.map((o) => o.id);
  const currentlyEnabled = instance.value.enabled_options;
  const enabledSet = new Set<string>(
    Array.isArray(currentlyEnabled) ? currentlyEnabled : ids,
  );
  if (enabledSet.has(optionId)) enabledSet.delete(optionId);
  else enabledSet.add(optionId);
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
    <div class="pool__head">
      <div class="pool__label">Pool · what RNG can pick from</div>
      <button
        type="button"
        class="pool__adv-toggle"
        :class="{ 'pool__adv-toggle--on': advanced }"
        data-test="pool-advanced"
        :aria-pressed="advanced"
        @click="toggleAdvanced"
      >ƒ(x) Advanced</button>
    </div>

    <!-- Quick mode — grouped pills. OR within an axis, AND across axes. -->
    <div v-if="!advanced" class="pool__groups">
      <div
        v-for="group in pillGroups"
        :key="group.axis"
        class="pool__group"
        :data-test="`pool-group-${group.axis}`"
      >
        <span class="pool__group-name">{{ group.axis }}</span>
        <div class="pool__chips">
          <button
            v-for="cat in group.tags"
            :key="cat"
            type="button"
            class="cat-chip"
            :class="{ 'cat-chip--on': isTagTicked(cat) }"
            :style="{ '--chip-hue': axisHue(group.axis) }"
            :data-test="`cat-chip-${cat}`"
            role="checkbox"
            :aria-checked="isTagTicked(cat)"
            @click="onPillClick(cat)"
          >
            {{ cat }}
            <span class="cat-chip__count">{{ categoryOptionCount(cat) }}</span>
          </button>
        </div>
      </div>
      <div v-if="filterExpr" class="pool__effective" data-test="pool-effective">
        <span class="pool__effective-label">filter</span>
        <code>{{ filterExpr }}</code>
      </div>
    </div>

    <!-- Advanced mode — boolean expression editor (§4.1 grammar). -->
    <div v-else class="pool__advanced">
      <input
        v-model="draft"
        type="text"
        aria-label="Sub-category filter expression"
        class="pool__expr-input"
        :class="{ 'pool__expr-input--invalid': draftError }"
        data-test="expr-input"
        placeholder="e.g. feline and warm, not lynx"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        @input="onDraftInput"
      />
      <div v-if="draftError" class="pool__expr-error" data-test="expr-error">
        {{ draftError }}
      </div>
      <div v-else class="pool__expr-meta">
        <span class="pool__expr-reads" data-test="expr-reads-as">
          <span class="pool__expr-reads-label">reads as</span>
          <code>{{ draftReadsAs || "(no filter)" }}</code>
        </span>
        <span class="pool__expr-count" data-test="expr-match-count">
          {{ draftMatchCount }} of {{ totalCount }} match
        </span>
      </div>
    </div>

    <label
      class="pool__exclude-null"
      :class="{ 'pool__exclude-null--hint': !hasNullOption }"
      data-test="pool-exclude-null"
      @click.prevent="setExcludeNull(!excludeNull)"
    >
      <input type="checkbox" :checked="excludeNull" tabindex="-1" />
      <i class="pi pi-ban" aria-hidden="true" />
      <span>Exclude null option</span>
    </label>

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
        :tag-groups="tagGroups"
        :pair-badges="viaOptionPairs.get(option.id) ?? []"
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
.pool__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.pool__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.pool__adv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text-muted, var(--wp-text2));
  font: 10px var(--wp-font-mono);
  cursor: pointer;
}
.pool__adv-toggle:hover { border-color: var(--wp-border2, var(--wp-border)); }
.pool__adv-toggle--on {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
  background: var(--wp-accent-glow, rgba(99, 102, 241, 0.15));
}
.pool__groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.pool__group {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pool__group-name {
  flex: 0 0 auto;
  min-width: 44px;
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
  padding-top: 3px;
}
.pool__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
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
.cat-chip:hover { border-color: var(--chip-hue, var(--wp-border-soft, var(--wp-border))); }
.cat-chip--on {
  border-color: color-mix(in srgb, var(--chip-hue, var(--wp-accent)) 60%, transparent);
  color: var(--chip-hue, var(--wp-accent-text, var(--wp-text)));
  background: color-mix(in srgb, var(--chip-hue, var(--wp-accent)) 14%, transparent);
}
.cat-chip__count {
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.cat-chip--on .cat-chip__count { color: inherit; }
.pool__effective {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 2px;
}
.pool__effective-label {
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.pool__effective code {
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
}
.pool__advanced {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.pool__expr-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 9px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  color: var(--wp-text);
  font: 11px var(--wp-font-mono);
}
.pool__expr-input:focus {
  outline: none;
  border-color: var(--wp-accent);
}
.pool__expr-input--invalid {
  border-color: var(--wp-danger, #ef4444);
}
.pool__expr-error {
  font: 10px var(--wp-font-mono);
  color: var(--wp-danger, #ef4444);
}
.pool__expr-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.pool__expr-reads {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.pool__expr-reads-label {
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
  flex: 0 0 auto;
}
.pool__expr-reads code {
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  word-break: break-word;
}
.pool__expr-count {
  flex: 0 0 auto;
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.pool__exclude-null {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
}
.pool__exclude-null .pi { font-size: 10px; }
/* No null option to exclude on this wildcard — keep the control present
 * (it round-trips a stored flag) but dim it so it reads as inert. */
.pool__exclude-null--hint { opacity: 0.55; }
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
  /* Match OptionRow column widths so cell alignment stays in lockstep. */
  grid-template-columns: 22px 1fr 110px 64px 96px;
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
