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

/* Insert-at-cursor palette for the advanced editor (#7) — mirrors the SPA
 * SubcategoryFilterPicker so the user sees which sub-categories + operators
 * are available instead of guessing the grammar. */
const exprInput = ref<HTMLInputElement | null>(null);
const OPERATORS = ["and", "or", "not", "(", ")"] as const;

/** Splice `token` at the caret (or over the selection), padding with a
 *  single space so adjacent tokens stay parseable, then re-validate +
 *  commit. Re-focuses and restores the caret after the inserted token. */
function insertToken(token: string): void {
  const el = exprInput.value;
  const current = draft.value;
  const selStart = el?.selectionStart ?? current.length;
  const selEnd = el?.selectionEnd ?? current.length;
  const before = current.slice(0, selStart);
  const after = current.slice(selEnd);
  const needLead = before.length > 0 && !/\s$/.test(before);
  const needTrail = after.length > 0 && !/^\s/.test(after);
  const insert = (needLead ? " " : "") + token + (needTrail ? " " : "");
  draft.value = before + insert + after;
  onDraftInput();
  const caret = (before + insert).length;
  void Promise.resolve().then(() => {
    const e = exprInput.value;
    if (!e) return;
    e.focus();
    e.setSelectionRange(caret, caret);
  });
}

/* ── Exclude null ───────────────────────────────────────────────────── */

const excludeNull = computed(() => instance.value.exclude_null === true);
function setExcludeNull(next: boolean): void {
  emit("update", patchInstance(props.module, "exclude_null", next));
}

/* ── Multi-select (SP2a) ─────────────────────────────────────────────── */
const pickMin = computed(() =>
  typeof instance.value.pick_min === "number" ? instance.value.pick_min : 1,
);
const pickMax = computed(() =>
  typeof instance.value.pick_max === "number" ? instance.value.pick_max : 1,
);
const pickSeparator = computed(() =>
  typeof instance.value.pick_separator === "string"
    ? instance.value.pick_separator
    : ", ",
);
/** Multi-pick active when the count range is anything other than 1..1. In
 *  multi mode the null option leaves the pool (use Min 0 for "maybe
 *  nothing"), so the null controls go inert. */
const multiActive = computed(() => {
  const lo = Math.max(0, Math.min(pickMin.value, pickMax.value));
  const hi = Math.max(lo, pickMax.value);
  return !(lo === 1 && hi === 1);
});
function setPickMin(next: number): void {
  emit("update", patchInstance(props.module, "pick_min", Math.max(0, Math.floor(next || 0))));
}
function setPickMax(next: number): void {
  emit("update", patchInstance(props.module, "pick_max", Math.max(0, Math.floor(next || 0))));
}
function setPickSeparator(next: string): void {
  emit("update", patchInstance(props.module, "pick_separator", next));
}

/* ── Option rows (unchanged behaviour) ──────────────────────────────── */

function onOptionToggle(optionId: string): void {
  const toggled = allOptions.value.find((o) => o.id === optionId);
  if (toggled?.is_null) {
    // The null row's checkbox IS the "Exclude null" control — the engine
    // governs the null slot solely via exclude_null. Drive that flag so the
    // two controls stay in lockstep (#3) rather than writing a stale
    // enabled_options entry the resolver ignores for the null slot.
    setExcludeNull(!excludeNull.value);
    return;
  }
  // enabled_options tracks only the tag-bearing (non-null) options; the null
  // slot lives on exclude_null.
  const ids = allOptions.value.filter((o) => !o.is_null).map((o) => o.id);
  const currentlyEnabled = instance.value.enabled_options;
  const enabledSet = new Set<string>(
    Array.isArray(currentlyEnabled) ? currentlyEnabled : ids,
  );
  if (enabledSet.has(optionId)) enabledSet.delete(optionId);
  else enabledSet.add(optionId);
  // Preserve library order in the emitted array.
  const next = ids.filter((id) => enabledSet.has(id));
  // Collapse to null when all non-null options are enabled (= library default).
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
        <span class="pool__group-name" :style="{ color: axisHue(group.axis) }">{{ group.axis }}</span>
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
            <span v-if="isTagTicked(cat)" class="cat-chip__check" aria-hidden="true">✓</span>
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
        ref="exprInput"
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
      <!-- Insert-at-cursor palette (#7): grouped sub-categories + operators
           so the user sees what they can type, like the SPA ref-filter. -->
      <div v-if="subCategories.length > 0" class="pool__palette" data-test="pool-palette">
        <div
          v-for="group in pillGroups"
          :key="group.axis"
          class="pool__palette-group"
        >
          <span class="pool__palette-axis" :style="{ color: axisHue(group.axis) }">{{ group.axis }}</span>
          <button
            v-for="cat in group.tags"
            :key="cat"
            type="button"
            class="pool__ins-chip"
            :style="{ '--chip-hue': axisHue(group.axis) }"
            :data-test="`pool-ins-${cat}`"
            @click="insertToken(cat)"
          >{{ cat }}</button>
        </div>
        <div class="pool__palette-ops">
          <button
            v-for="op in OPERATORS"
            :key="op"
            type="button"
            class="pool__ins-chip pool__ins-chip--op"
            @click="insertToken(op)"
          >{{ op }}</button>
        </div>
      </div>
    </div>

    <!-- SP2a multi-select: pick a count range (min..max). A range other than
         1..1 resolves N options (without replacement) into a list variable;
         the separator joins them for a bare `$var`. -->
    <div class="pool__pick" data-test="pool-pick">
      <span class="pool__pick-label">Pick</span>
      <input
        class="pool__pick-num"
        type="number"
        min="0"
        :value="pickMin"
        data-test="pool-pick-min"
        aria-label="Minimum picks"
        @input="setPickMin(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="pool__pick-dash" aria-hidden="true">–</span>
      <input
        class="pool__pick-num"
        type="number"
        min="0"
        :value="pickMax"
        data-test="pool-pick-max"
        aria-label="Maximum picks"
        @input="setPickMax(Number(($event.target as HTMLInputElement).value))"
      />
      <input
        v-if="pickMax > 1"
        class="pool__pick-sep"
        type="text"
        :value="pickSeparator"
        placeholder="separator"
        data-test="pool-pick-sep"
        aria-label="Join separator"
        @input="setPickSeparator(($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- Only shown when the wildcard actually has a null option to exclude
         (#5). Native @change on the input is the source of truth (#4) — the
         old label @click.prevent fought the checkbox's own toggle, so the
         box never reflected the new state. In multi-pick mode the null option
         leaves the pool entirely, so this control goes inert (use Min 0). -->
    <label
      v-if="hasNullOption"
      class="pool__exclude-null"
      :class="{ 'pool__exclude-null--off': multiActive }"
      data-test="pool-exclude-null"
    >
      <input
        type="checkbox"
        :checked="excludeNull"
        :disabled="multiActive"
        @change="setExcludeNull(($event.target as HTMLInputElement).checked)"
      />
      <i class="pi pi-ban" aria-hidden="true" />
      <span>{{ multiActive
        ? "Null excluded in multi-pick — use Min 0 for optional"
        : "Exclude null option" }}</span>
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
        :multi-active="multiActive"
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
/* SP2a multi-select pick-count control */
.pool__pick {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
}
.pool__pick-label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.pool__pick-num {
  /* Match the per-option weight stepper (.opt__weight): same height, border,
   * radius + suppressed native spin arrows so the two number inputs read as
   * one control family instead of a bare browser <input type=number>. */
  width: 44px;
  height: 22px;
  padding: 0 6px;
  font: 11px var(--wp-font-mono);
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  color: var(--wp-text);
  text-align: right;
  -moz-appearance: textfield;
}
.pool__pick-num::-webkit-outer-spin-button,
.pool__pick-num::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.pool__pick-num:focus { outline: none; border-color: var(--wp-accent); }
.pool__pick-dash { color: var(--wp-text-dim, var(--wp-text3)); }
.pool__pick-sep {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  font: 11px var(--wp-font-mono);
  background: var(--wp-bg-soft, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  color: var(--wp-text);
}
.pool__exclude-null--off { opacity: 0.55; }
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
  /* Faint axis-hue border so a group's chips read as a coloured cluster
   * even when unselected (#9). */
  border: 1px solid color-mix(in srgb, var(--chip-hue, var(--wp-border)) 30%, var(--wp-border));
  border-radius: 999px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.cat-chip:hover { border-color: var(--chip-hue, var(--wp-border-soft, var(--wp-border))); }
/* Selected: a solid hue border + 30% fill + bold + leading ✓ so "on" reads
 * at a glance for ANY hue — the old 14% tint vanished against the grey
 * ungrouped hue, which read as a dim, not a selection (#6). */
.cat-chip--on {
  border-color: var(--chip-hue, var(--wp-accent));
  color: var(--wp-text);
  background: color-mix(in srgb, var(--chip-hue, var(--wp-accent)) 30%, transparent);
  font-weight: 600;
}
.cat-chip__check { font-size: 9px; line-height: 1; }
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
/* Insert-at-cursor palette under the advanced expression input (#7). */
.pool__palette {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
  padding-top: 8px;
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.pool__palette-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.pool__palette-axis {
  flex: 0 0 auto;
  min-width: 40px;
  font: 600 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.pool__palette-ops {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-top: 4px;
  border-top: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.pool__ins-chip {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--chip-hue, var(--wp-border)) 35%, var(--wp-border));
  border-radius: 999px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 10px var(--wp-font-sans);
  cursor: pointer;
}
.pool__ins-chip:hover {
  border-color: var(--chip-hue, var(--wp-accent));
  color: var(--wp-text);
}
.pool__ins-chip--op {
  font-family: var(--wp-font-mono);
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
