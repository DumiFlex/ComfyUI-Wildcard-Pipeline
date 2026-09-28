<script setup lang="ts">
/**
 * One derivation test — "WHEN $var is <op> [value]". Rendered once per test by
 * DerivationConditionEditor, which arranges tests into AND / OR groups.
 *
 * The op dropdown lists the 6 base ops. Emptiness refinement (`is_empty` /
 * `is_set`) is surfaced via a segmented switch shown only when `exists` is
 * selected — three positions:
 *   • "any"       → bare `exists` (key in ctx, value irrelevant)
 *   • "is empty"  → `is_empty`  (key in ctx AND value === "")
 *   • "has value" → `is_set`    (key in ctx AND value !== "")
 * This lets users tell "did this wildcard run?" from "did it run and resolve
 * to the null option?" from "did it run and produce a value?".
 */
import RichTextInput from "./RichTextInput.vue";
import Select from "./ui/Select.vue";
import VarAutocompleteInput from "./VarAutocompleteInput.vue";
import type { VarProducerLike } from "./RefChip.vue";
import type { DerivationCondition, DerivationOp } from "../api/types";
import {
  OP_LABELS,
  OP_TOOLTIPS,
  OP_PLACEHOLDERS,
  VALUE_DISABLED_OPS,
} from "../../components/context/editors/_shared/derivation-ops";

const props = withDefaults(defineProps<{
  modelValue: DerivationCondition;
  /** Row label in the left column ("When" for a branch's first test). */
  lead?: string;
  /** Appended to every `data-test` id, e.g. `0-1` or `0-1-2.0`. */
  testId: string;
  /** Human name for aria labels, e.g. "rule 1 branch 2 test 3". */
  a11yName: string;
  varSuggestions?: string[];
  varProducers?: Map<string, VarProducerLike>;
  uuidToName?: Map<string, string>;
}>(), {
  lead: "",
  varSuggestions: () => [],
  varProducers: () => new Map(),
  uuidToName: () => new Map(),
});

const emit = defineEmits<{ "update:modelValue": [value: DerivationCondition] }>();

defineSlots<{ lead?(): unknown; actions?(): unknown }>();

const VISIBLE_OPS: DerivationOp[] = [
  "equals", "not_equals", "contains", "matches", "exists", "not_exists",
];
const OP_OPTIONS: Array<{ label: string; value: DerivationOp; title: string }> =
  VISIBLE_OPS.map((op) => ({ label: OP_LABELS[op], value: op, title: OP_TOOLTIPS[op] }));

/** Dropdown op: the refinement variants of `exists` (is_set / is_empty) and
 *  `not_exists` (is_unset / is_not_empty) collapse onto their base op. */
function displayedOp(op: DerivationOp): DerivationOp {
  if (op === "is_set" || op === "is_empty") return "exists";
  if (op === "is_unset" || op === "is_not_empty") return "not_exists";
  return op;
}

type EmptinessRefinement = "any" | "empty" | "value";

function emptinessFor(op: DerivationOp): EmptinessRefinement {
  if (op === "is_empty") return "empty";
  if (op === "is_set" || op === "is_not_empty") return "value";
  return "any";
}

/** Compose the storage op from base + refinement. `not_exists` has no
 *  refinement: the var being absent dominates any emptiness question. */
function composeOp(base: DerivationOp, refinement: EmptinessRefinement): DerivationOp {
  if (base === "exists") {
    if (refinement === "empty") return "is_empty";
    if (refinement === "value") return "is_set";
    return "exists";
  }
  if (base === "not_exists") return "not_exists";
  return base;
}

function supportsRefinement(op: DerivationOp): boolean {
  return displayedOp(op) === "exists";
}

/** Python regex flavour, matching the engine's `re.search`. */
const REGEX_HELP_URL = "https://regex101.com/?flavor=python";

function set(patch: Partial<DerivationCondition>): void {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}
</script>

<template>
  <div class="dvc-test" :data-test="`cond-test-${testId}`">
    <div
      class="dvr-grid"
      :class="{ 'dvr-grid--has-tick': supportsRefinement(modelValue.op) }"
    >
      <span class="dvr-label dvc-lead"><slot name="lead">{{ lead }}</slot></span>
      <div class="dvr-var-wrap" :data-test="`cond-var-wrap-${testId}`">
        <span class="dvr-prefix">$</span>
        <VarAutocompleteInput
          :model-value="modelValue.var"
          :suggestions="varSuggestions"
          placeholder="variable"
          :aria-label="`Condition variable for ${a11yName}`"
          :data-test="`cond-var-${testId}`"
          @update:model-value="(v) => set({ var: v })"
        />
      </div>
      <span class="dvr-label">is</span>
      <div class="dvr-op-cell">
        <Select
          :model-value="displayedOp(modelValue.op)"
          :options="OP_OPTIONS"
          class="dvr-op"
          :data-test="`cond-op-${testId}`"
          :aria-label="`Condition operator for ${a11yName}`"
          @update:model-value="(v) => set({ op: v as DerivationOp })"
        />
        <div
          v-if="supportsRefinement(modelValue.op)"
          class="dvr-refinement"
          :data-test="`cond-refinement-${testId}`"
          role="radiogroup"
          aria-label="Variable value refinement"
        >
          <button
            type="button"
            class="dvr-refinement__btn"
            :class="{ 'dvr-refinement__btn--active': emptinessFor(modelValue.op) === 'any' }"
            :aria-pressed="emptinessFor(modelValue.op) === 'any'"
            :data-test="`cond-refinement-any-${testId}`"
            title="Just check that the variable is set in the context (value irrelevant)"
            @click="set({ op: composeOp('exists', 'any') })"
          >any</button>
          <button
            type="button"
            class="dvr-refinement__btn"
            :class="{ 'dvr-refinement__btn--active': emptinessFor(modelValue.op) === 'empty' }"
            :aria-pressed="emptinessFor(modelValue.op) === 'empty'"
            :data-test="`cond-refinement-empty-${testId}`"
            title="Variable is set AND its value is empty (e.g. wildcard rolled the null option)"
            @click="set({ op: composeOp('exists', 'empty') })"
          >∅ is empty</button>
          <button
            type="button"
            class="dvr-refinement__btn"
            :class="{ 'dvr-refinement__btn--active': emptinessFor(modelValue.op) === 'value' }"
            :aria-pressed="emptinessFor(modelValue.op) === 'value'"
            :data-test="`cond-refinement-value-${testId}`"
            title="Variable is set AND its value is non-empty"
            @click="set({ op: composeOp('exists', 'value') })"
          >✓ has value</button>
        </div>
      </div>
    </div>
    <div class="dvr-value-row">
      <span class="dvr-label">value</span>
      <div class="dvr-value-cell">
        <RichTextInput
          :model-value="modelValue.value"
          surface="derivation"
          :var-producers="varProducers"
          wrap
          :var-suggestions="varSuggestions"
          :uuid-to-name="uuidToName"
          :placeholder="OP_PLACEHOLDERS[modelValue.op] ?? 'value'"
          :disabled="VALUE_DISABLED_OPS.has(modelValue.op)"
          class="dvr-value-input"
          :class="{ 'dvr-value-input--disabled': VALUE_DISABLED_OPS.has(modelValue.op) }"
          :aria-label="`Condition value for ${a11yName}`"
          :data-test="`cond-value-${testId}`"
          @update:model-value="(v) => set({ value: v })"
        />
        <a
          v-if="modelValue.op === 'matches'"
          class="dvr-regex-help"
          :href="REGEX_HELP_URL"
          target="_blank"
          rel="noopener"
          :data-test="`cond-regex-help-${testId}`"
          aria-label="Regex help — opens regex101.com"
          title="Python regex (re.search) — open regex101.com to test patterns"
        >
          <i class="pi pi-question-circle" aria-hidden="true" />
        </a>
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped src="./derivation-rule-grid.css"></style>

<style scoped>
.dvc-test { display: flex; flex-direction: column; }
/* The lead cell can hold the AND / OR connector button instead of a word. */
.dvc-lead { display: flex; justify-content: flex-end; align-items: center; }
.dvr-op {
  /* Select dropdown trigger — let the existing Select styling handle
   * the visual; just ensure it stretches into its grid column. */
  min-width: 0;
}
.dvr-op-cell {
  /* Wraps the op Select + the optional "must have value" tick. The
   * tick is absolute-positioned below the Select so its presence
   * doesn't change the grid row height — toggling on/off used to
   * push the VALUE row up/down because the cell grew taller when
   * the tick wrapped onto a second line. Now the cell reserves a
   * single line for the Select and the tick floats over the gap
   * before the VALUE row. */
  position: relative;
  min-width: 0;
}
/* Segmented refinement switch — shown under the `exists` op only.
 * Three positions (any / is empty / has value) compose into the
 * stored op (exists / is_empty / is_set). */
.dvr-refinement {
  position: absolute;
  top: calc(100% + var(--wp-space-2));
  right: 0;
  display: inline-flex;
  gap: 0;
  font: 9px var(--wp-font-sans, sans-serif);
  white-space: nowrap;
  z-index: 1;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--wp-border, #2a2d35);
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
}
.dvr-refinement__btn {
  padding: 2px 7px;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--wp-border, #2a2d35);
  color: var(--wp-text-muted, #9ca3af);
  cursor: pointer;
  font: inherit;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  transition: background 0.12s, color 0.12s;
}
.dvr-refinement__btn:last-child { border-right: 0; }
.dvr-refinement__btn:hover {
  background: color-mix(in srgb, var(--wp-accent, #6366f1) 12%, transparent);
  color: var(--wp-text, #fff);
}
.dvr-refinement__btn--active {
  background: color-mix(in srgb, var(--wp-accent, #6366f1) 30%, transparent);
  color: var(--wp-text, #fff);
}
/* Reserve space for the tick under the op cell when it's rendered.
 * Without this, the absolute-positioned tick would overlap the
 * VALUE row beneath. Bumps the value-row's top margin only when the
 * grid has the `--has-tick` modifier set by the template. */
.dvr-grid--has-tick + .dvr-value-row {
  margin-top: var(--wp-space-6);
}
.dvr-regex-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted, #9ca3af);
  background: var(--wp-bg-3, #2a2a2a);
  border: 1px solid var(--wp-border, #3a3a3a);
  text-decoration: none;
}
.dvr-regex-help:hover {
  color: var(--wp-accent, #6366f1);
  border-color: color-mix(in oklab, var(--wp-accent, #6366f1) 40%, transparent);
}
.dvr-regex-help .pi { font-size: var(--wp-text-xs); }
</style>
