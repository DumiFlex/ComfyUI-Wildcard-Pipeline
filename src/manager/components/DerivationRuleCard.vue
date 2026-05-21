<script setup lang="ts">
import { computed, ref } from "vue";
import Card from "./ui/Card.vue";
import Button from "./ui/Button.vue";
import Select from "./ui/Select.vue";
import Chip from "./ui/Chip.vue";
import RichTextInput from "./RichTextInput.vue";
import VarAutocompleteInput from "./VarAutocompleteInput.vue";
import type {
  DerivationAction,
  DerivationBranch,
  DerivationElse,
  DerivationMode,
  DerivationOp,
  DerivationRule,
} from "../api/types";
import {
  DERIVATION_OPS,
  OP_LABELS,
  OP_TOOLTIPS,
  OP_PLACEHOLDERS,
  VALUE_DISABLED_OPS,
} from "../../components/context/editors/_shared/derivation-ops";

interface Props {
  modelValue: DerivationRule;
  index: number;
  varSuggestions?: string[];
  /** UUID → display-name map forwarded to every nested RichTextInput so
   *  stray `@{uuid}` chips read as `@name` instead of raw hex. */
  uuidToName?: Map<string, string>;
  /** Default-collapsed when many rules exist (set by editor). */
  defaultCollapsed?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  varSuggestions: () => [],
  uuidToName: () => new Map(),
  defaultCollapsed: false,
});

const collapsed = ref<boolean>(props.defaultCollapsed);
function toggleCollapsed() { collapsed.value = !collapsed.value; }

const emit = defineEmits<{
  "update:modelValue": [value: DerivationRule];
  remove: [];
}>();

// Op dropdown lists 6 ops — the 4 compare ops plus the two presence-
// base ops. `is_set`/`is_unset` are intentionally hidden from the
// dropdown: they're surfaced via the "must have value" tick box next
// to `exists`/`not_exists` instead. Engine still accepts all 8 ops;
// the UI just remaps presence + tick → `is_set` / `is_unset` on save
// (and reverse-maps on load via `displayedOp` below). User feedback
// on 2026-05-10: "is set" reads as redundant when "exists" + tick
// captures the same intent more cleanly.
const VISIBLE_OPS = DERIVATION_OPS.filter(
  (op) => op !== "is_set" && op !== "is_unset",
);
const OP_OPTIONS: Array<{ label: string; value: DerivationOp; title: string }> =
  VISIBLE_OPS.map((op) => ({
    label: OP_LABELS[op],
    value: op,
    title: OP_TOOLTIPS[op],
  }));

/** UI-displayed base op for the dropdown: collapses `is_set` →
 *  `exists`, `is_unset` → `not_exists` so the dropdown only ever
 *  shows the 6 visible ops. The "must have value" tick state is
 *  derived from the saved op (see `requiresValue`). */
function displayedOp(op: DerivationOp): DerivationOp {
  if (op === "is_set") return "exists";
  if (op === "is_unset") return "not_exists";
  return op;
}

/** Whether the saved op is the "must have value" variant of a
 *  presence-base op. Drives the tick checkbox state. */
function requiresValue(op: DerivationOp): boolean {
  return op === "is_set" || op === "is_unset";
}

/** Toggle the "must have value" tick — maps the displayed base op
 *  to its strict-value counterpart and back:
 *    exists       ↔ is_set
 *    not_exists   ↔ is_unset
 *  Engine sees the new op directly, so payload reflects intent. */
function toggleRequiresValue(currentOp: DerivationOp): DerivationOp {
  switch (currentOp) {
    case "exists": return "is_set";
    case "is_set": return "exists";
    case "not_exists": return "is_unset";
    case "is_unset": return "not_exists";
    default: return currentOp; // Non-presence ops can't have the tick
  }
}

/** Whether the displayed base op is one that supports the "must have
 *  value" tick. Only `exists` qualifies — the tick asks "and the
 *  value is non-empty?", which is meaningless when the var doesn't
 *  exist in the first place (`not_exists`). `is_unset` is the engine-
 *  level variant of `not_exists`; we don't expose a tick for it
 *  either, so a saved `is_unset` rule round-trips as `not_exists` in
 *  the UI with no tick. Compare ops never get the tick. */
function isPresenceOp(op: DerivationOp): boolean {
  return displayedOp(op) === "exists";
}

const MODE_OPTIONS: Array<{ label: string; value: DerivationMode }> = [
  { label: "Replace", value: "replace" },
  { label: "Append", value: "append" },
  { label: "Prepend", value: "prepend" },
];

/** Whether the condition-value input should be disabled for this op.
 *  Presence-check ops (`exists`/`not_exists`/`is_set`/`is_unset`) read
 *  no value — engine ignores `condition.value` for these. UI grays
 *  the field + sets `disabled` so users see at a glance that no value
 *  is needed. Payload value persists on toggle so flipping back to
 *  `equals` restores the user's typed value. */
function isValueDisabled(op: DerivationOp): boolean {
  return VALUE_DISABLED_OPS.has(op);
}

/** Operator-specific placeholder for the condition-value input —
 *  `30` for equals, `^a.*z$` for matches, "no value needed" for
 *  presence ops. From the shared registry so the example matches
 *  the op's tooltip semantics. */
function placeholderFor(op: DerivationOp): string {
  return OP_PLACEHOLDERS[op] ?? "value";
}

/** Single-line hint shown below the action value input, listing the
 *  inline-syntax tokens the engine resolves on derivation surface
 *  (`resolve_text(action.value, surface="derivation")`). Keeps the
 *  copy in one place so wording stays consistent across rule + ELSE
 *  blocks. `@{uuid}` refs deliberately omitted — derivation surface
 *  doesn't resolve them per the surface gate matrix. */
const SUPPORTED_SYNTAX_HINT = "Supports $var · {a|b|c} · $$ · {N$$sep$$...}";

/** Open a regex tester in a new tab when the user clicks the [?]
 *  affordance next to a `matches`-op condition value. Python flavor
 *  matches the engine's `re.search` impl. */
const REGEX_HELP_URL = "https://regex101.com/?flavor=python";

function blankAction(): DerivationAction {
  return { target_var: "", mode: "replace", value: "" };
}

function blankBranch(): DerivationBranch {
  return {
    condition: { var: "", op: "equals", value: "" },
    action: blankAction(),
  };
}

const rule = computed<DerivationRule>(() => props.modelValue);

function patch(next: Partial<DerivationRule>) {
  emit("update:modelValue", { ...rule.value, ...next });
}

function setBranch(bi: number, branch: DerivationBranch) {
  const branches = rule.value.branches.map((b, i) => (i === bi ? branch : b));
  patch({ branches });
}

function setCondition(bi: number, condition: DerivationBranch["condition"]) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setBranch(bi, { ...branch, condition });
}

function setAction(bi: number, action: DerivationAction) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setBranch(bi, { ...branch, action });
}

function addBranch() {
  patch({ branches: [...rule.value.branches, blankBranch()] });
}

function removeBranch(bi: number) {
  if (bi === 0) return; // first branch is the IF — can't be removed
  const branches = rule.value.branches.filter((_, i) => i !== bi);
  patch({ branches });
}

function addElse() {
  patch({ else: { action: blankAction() } });
}

function removeElse() {
  const next = { ...rule.value };
  delete next.else;
  emit("update:modelValue", next);
}

function setElseAction(action: DerivationAction) {
  const elseClause: DerivationElse = { action };
  patch({ else: elseClause });
}

function onConditionVar(bi: number, value: string) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setCondition(bi, { ...branch.condition, var: value });
}
function onConditionOp(bi: number, value: DerivationOp) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setCondition(bi, { ...branch.condition, op: value });
}
function onConditionValue(bi: number, value: string) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setCondition(bi, { ...branch.condition, value });
}
function onActionTarget(bi: number, value: string) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setAction(bi, { ...branch.action, target_var: value });
}
function onActionMode(bi: number, value: DerivationMode) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setAction(bi, { ...branch.action, mode: value });
}
function onActionValue(bi: number, value: string) {
  const branch = rule.value.branches[bi];
  if (!branch) return;
  setAction(bi, { ...branch.action, value });
}

function onElseTarget(value: string) {
  const cur = rule.value.else?.action ?? blankAction();
  setElseAction({ ...cur, target_var: value });
}
function onElseMode(value: DerivationMode) {
  const cur = rule.value.else?.action ?? blankAction();
  setElseAction({ ...cur, mode: value });
}
function onElseValue(value: string) {
  const cur = rule.value.else?.action ?? blankAction();
  setElseAction({ ...cur, value });
}

const ruleNumber = computed(() => props.index + 1);
const branchCount = computed(() => rule.value.branches.length);
</script>

<template>
  <Card class="derivation-rule-card" :data-test="`rule-card-${index}`">
    <button
      type="button"
      class="rule-head"
      :aria-expanded="!collapsed"
      :data-test="`toggle-rule-${index}`"
      @click="toggleCollapsed"
    >
      <i :class="collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" class="rule-head__chev" aria-hidden="true" />
      <Chip tone="info" data-test="rule-label">Rule {{ ruleNumber }}</Chip>
      <span class="rule-meta">
        {{ branchCount }} branch{{ branchCount === 1 ? "" : "es" }}
        <span v-if="rule.else"> + ELSE</span>
      </span>
      <span class="spacer" />
      <Button
        icon="pi-trash"
        variant="ghost"
        size="sm"
        :aria-label="`Remove rule ${ruleNumber}`"
        :data-test="`remove-rule-${index}`"
        @click.stop="emit('remove')"
      />
    </button>

    <div v-show="!collapsed" class="branches">
      <div
        v-for="(branch, bi) in rule.branches"
        :key="bi"
        class="branch"
        :data-kind="bi === 0 ? 'if' : 'elif'"
        :data-test="`branch-${index}-${bi}`"
      >
        <div class="branch-head">
          <span class="branch-tag" :data-kind="bi === 0 ? 'if' : 'elif'">
            {{ bi === 0 ? "IF" : "ELIF" }}
          </span>
          <span class="spacer" />
          <Button
            v-if="bi > 0"
            icon="pi-times"
            variant="ghost"
            size="sm"
            :aria-label="`Remove ELIF branch ${bi} from rule ${ruleNumber}`"
            :data-test="`remove-elif-${index}-${bi}`"
            @click="removeBranch(bi)"
          />
        </div>

        <!-- Compact grid (Proposal B, 2026-05-09 cycle):
             row 1 = WHEN var + op on a single line so the prose
             reads "When $age equals". Row 2 = condition value below
             with explicit "value" label. Same for THEN. Halves the
             vertical space of the prior stacked layout. -->
        <div
          class="dvr-grid"
          :class="{ 'dvr-grid--has-tick': isPresenceOp(branch.condition.op) }"
        >
          <span class="dvr-label">When</span>
          <div
            class="dvr-var-wrap"
            :data-test="`cond-var-wrap-${index}-${bi}`"
          >
            <span class="dvr-prefix">$</span>
            <VarAutocompleteInput
              :model-value="branch.condition.var"
              :suggestions="varSuggestions"
              placeholder="variable"
              :aria-label="`Condition variable for rule ${ruleNumber} branch ${bi + 1}`"
              :data-test="`cond-var-${index}-${bi}`"
              @update:model-value="(v) => onConditionVar(bi, v)"
            />
          </div>
          <span class="dvr-label">is</span>
          <div class="dvr-op-cell">
            <Select
              :model-value="displayedOp(branch.condition.op)"
              :options="OP_OPTIONS"
              class="dvr-op"
              :data-test="`cond-op-${index}-${bi}`"
              :aria-label="`Condition operator for rule ${ruleNumber} branch ${bi + 1}`"
              @update:model-value="(v) => onConditionOp(bi, v as DerivationOp)"
            />
            <label
              v-if="isPresenceOp(branch.condition.op)"
              class="dvr-tick"
              :data-test="`cond-must-have-value-${index}-${bi}`"
              :title="branch.condition.op === 'exists' || branch.condition.op === 'is_set'
                ? 'Tick: variable must have a non-empty value (engine maps to is_set)'
                : 'Tick: variable must be absent OR empty (engine maps to is_unset)'"
            >
              <input
                type="checkbox"
                :checked="requiresValue(branch.condition.op)"
                :data-test="`cond-must-have-value-input-${index}-${bi}`"
                @change="onConditionOp(bi, toggleRequiresValue(branch.condition.op))"
              />
              <span class="dvr-tick__label">must have value</span>
            </label>
          </div>
        </div>
        <div class="dvr-value-row">
          <span class="dvr-label">value</span>
          <div class="dvr-value-cell">
            <RichTextInput
              :model-value="branch.condition.value"
              surface="derivation"
              :var-suggestions="varSuggestions"
              :uuid-to-name="uuidToName"
              :placeholder="placeholderFor(branch.condition.op)"
              :disabled="isValueDisabled(branch.condition.op)"
              class="dvr-value-input"
              :class="{ 'dvr-value-input--disabled': isValueDisabled(branch.condition.op) }"
              :aria-label="`Condition value for rule ${ruleNumber} branch ${bi + 1}`"
              :data-test="`cond-value-${index}-${bi}`"
              @update:model-value="(v) => onConditionValue(bi, v)"
            />
            <a
              v-if="branch.condition.op === 'matches'"
              class="dvr-regex-help"
              :href="REGEX_HELP_URL"
              target="_blank"
              rel="noopener"
              :data-test="`cond-regex-help-${index}-${bi}`"
              aria-label="Regex help — opens regex101.com"
              title="Python regex (re.search) — open regex101.com to test patterns"
            >
              <i class="pi pi-question-circle" aria-hidden="true" />
            </a>
          </div>
        </div>

        <!-- THEN var + mode on row 1, action value below. -->
        <div class="dvr-grid dvr-grid--then">
          <span class="dvr-label">Then</span>
          <div
            class="dvr-var-wrap"
            :data-test="`act-var-wrap-${index}-${bi}`"
          >
            <span class="dvr-prefix">$</span>
            <VarAutocompleteInput
              :model-value="branch.action.target_var"
              :suggestions="varSuggestions"
              placeholder="target_var"
              input-color="var(--wp-success, #34d399)"
              :aria-label="`Action target variable for rule ${ruleNumber} branch ${bi + 1}`"
              :data-test="`act-target-${index}-${bi}`"
              @update:model-value="(v) => onActionTarget(bi, v)"
            />
          </div>
          <span class="dvr-label">action</span>
          <Select
            :model-value="branch.action.mode"
            :options="MODE_OPTIONS"
            class="dvr-op"
            :data-test="`act-mode-${index}-${bi}`"
            :aria-label="`Action mode for rule ${ruleNumber} branch ${bi + 1}`"
            @update:model-value="(v) => onActionMode(bi, v as DerivationMode)"
          />
        </div>
        <div class="dvr-value-row">
          <span class="dvr-label">value</span>
          <RichTextInput
            :model-value="branch.action.value"
            surface="derivation"
            :var-suggestions="varSuggestions"
            :uuid-to-name="uuidToName"
            class="dvr-value-input"
            placeholder="The new / appended / prepended value"
            :aria-label="`Action value for rule ${ruleNumber} branch ${bi + 1}`"
            :data-test="`act-value-${index}-${bi}`"
            @update:model-value="(v) => onActionValue(bi, v)"
          />
        </div>
        <div class="dvr-hint" :data-test="`act-hint-${index}-${bi}`">
          {{ SUPPORTED_SYNTAX_HINT }}
        </div>
      </div>

      <!-- ELSE branch -->
      <div v-if="rule.else" class="branch branch--else" data-kind="else" :data-test="`branch-else-${index}`">
        <div class="branch-head">
          <span class="branch-tag" data-kind="else">ELSE</span>
          <span class="spacer" />
          <Button
            icon="pi-times"
            variant="ghost"
            size="sm"
            :aria-label="`Remove ELSE branch from rule ${ruleNumber}`"
            :data-test="`remove-else-${index}`"
            @click="removeElse"
          />
        </div>
        <div class="dvr-grid dvr-grid--then">
          <span class="dvr-label">Then</span>
          <div class="dvr-var-wrap" :data-test="`else-var-wrap-${index}`">
            <span class="dvr-prefix">$</span>
            <VarAutocompleteInput
              :model-value="rule.else.action.target_var"
              :suggestions="varSuggestions"
              placeholder="target_var"
              input-color="var(--wp-success, #34d399)"
              :aria-label="`ELSE action target variable for rule ${ruleNumber}`"
              :data-test="`else-target-${index}`"
              @update:model-value="(v) => onElseTarget(v)"
            />
          </div>
          <span class="dvr-label">action</span>
          <Select
            :model-value="rule.else.action.mode"
            :options="MODE_OPTIONS"
            class="dvr-op"
            :data-test="`else-mode-${index}`"
            :aria-label="`ELSE action mode for rule ${ruleNumber}`"
            @update:model-value="(v) => onElseMode(v as DerivationMode)"
          />
        </div>
        <div class="dvr-value-row">
          <span class="dvr-label">value</span>
          <RichTextInput
            :model-value="rule.else.action.value"
            surface="derivation"
            :var-suggestions="varSuggestions"
            :uuid-to-name="uuidToName"
            class="dvr-value-input"
            placeholder="The new / appended / prepended value"
            :aria-label="`ELSE action value for rule ${ruleNumber}`"
            :data-test="`else-value-${index}`"
            @update:model-value="(v) => onElseValue(v)"
          />
        </div>
        <div class="dvr-hint" :data-test="`else-hint-${index}`">
          {{ SUPPORTED_SYNTAX_HINT }}
        </div>
      </div>
    </div>

    <div v-show="!collapsed" class="addbar">
      <Button
        icon="pi-plus"
        variant="ghost"
        size="sm"
        :aria-label="`Add ELIF branch to rule ${ruleNumber}`"
        :data-test="`add-elif-${index}`"
        @click="addBranch"
      >Add elif</Button>
      <Button
        v-if="!rule.else"
        icon="pi-plus"
        variant="ghost"
        size="sm"
        :aria-label="`Add ELSE branch to rule ${ruleNumber}`"
        :data-test="`add-else-${index}`"
        @click="addElse"
      >Add else</Button>
    </div>

  </Card>
</template>

<style scoped>
.derivation-rule-card {
  border-left: var(--wp-kind-stripe-w) solid var(--wp-kind-derivation, #fbbf24);
  background: var(--wp-bg, #1e1e22);
}

.rule-head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  margin-bottom: 0;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  font: inherit;
  color: var(--wp-text);
}
.rule-head[aria-expanded="true"] { margin-bottom: var(--wp-space-5); }
.rule-head__chev {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  width: 12px;
  text-align: center;
  transition: transform 0.15s ease;
}
.rule-meta {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted, #9ca3af);
}
.spacer { flex: 1; }

.branches {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  padding-left: var(--wp-space-5);
  border-left: 2px solid color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 30%, transparent);
}

.branch {
  background: var(--wp-bg-2, #18181b);
  border: 1px solid var(--wp-border, #2c2c34);
  border-radius: var(--wp-radius);
  padding: var(--wp-space-5) var(--wp-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.branch--else {
  border-style: dashed;
}

.branch-head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
}

.branch-tag {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10px; /* audit-exempt: micro branch-tag uppercase — below scale floor */
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 7px; /* audit-exempt: 2px vertical hairline, 7px horiz compact badge */
  border-radius: var(--wp-radius-sm);
  text-transform: uppercase;
}
.branch-tag[data-kind="if"] {
  background: color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 22%, transparent);
  color: var(--wp-kind-derivation, #fbbf24);
}
.branch-tag[data-kind="elif"] {
  background: color-mix(in oklab, var(--wp-info, #60a5fa) 22%, transparent);
  color: var(--wp-info, #60a5fa);
}
.branch-tag[data-kind="else"] {
  background: color-mix(in oklab, var(--wp-warn, #f59e0b) 22%, transparent);
  color: var(--wp-warn, #f59e0b);
}

/* Compact grid layout (Proposal B, 2026-05-09 cycle).
 *
 * Row 1 puts the var input and operator on a single row so the prose
 * reads naturally: "When $age equals". Row 2 places the comparison
 * value below with an explicit "value" label — previously the
 * condition value had no label, leaving users guessing what the
 * field meant. Same shape repeats for THEN target + action.
 *
 * Grid columns:
 *   - 60px: row label ("When" / "Then" / "value")
 *   - 1fr:  var-input wrap (or value input on row 2)
 *   - 60px: in-line connective label ("is" / "action")
 *   - 1fr:  op / mode select
 */
.dvr-grid {
  display: grid;
  grid-template-columns: 60px 1fr 60px 1fr;
  gap: var(--wp-space-3) var(--wp-space-4);
  align-items: center;
  margin-bottom: var(--wp-space-2);
}
.dvr-grid--then {
  margin-top: var(--wp-space-5);
}
.dvr-value-row {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: var(--wp-space-4);
  align-items: center;
  margin-bottom: var(--wp-space-2);
}
.dvr-label {
  font-size: 10px; /* audit-exempt: micro grid row-label — below scale floor */
  color: var(--wp-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  text-align: right;
}
/* `$` prefix wrapper — matches the fixed_values + identity-section idiom
 * (see src/components/context/editors/wildcard/sections/IdentitySection.vue).
 * The prefix sits in its own column with a divider; focus shifts the
 * whole wrap's border to `--wp-accent`. */
.dvr-var-wrap {
  display: flex;
  align-items: stretch;
  background: var(--wp-bg-2, #161616);
  border: 1px solid var(--wp-border, #3a3a3a);
  border-radius: var(--wp-radius-sm);
  overflow: hidden;
}
.dvr-var-wrap:focus-within {
  border-color: var(--wp-accent, #6366f1);
}
.dvr-prefix {
  display: flex;
  align-items: center;
  padding: 0 9px; /* audit-exempt: 9px compact prefix inset */
  background: var(--wp-bg-3, #2a2a2a);
  color: var(--wp-text-muted, #9ca3af);
  border-right: 1px solid var(--wp-border, #3a3a3a);
  font: 11px var(--wp-font-mono, ui-monospace, monospace); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
}
.dvr-var-input {
  flex: 1;
  background: transparent;
  border: 0;
  padding: var(--wp-space-3) var(--wp-space-5);
  color: var(--wp-kind-derivation, #fbbf24);
  font: 600 11px var(--wp-font-mono, ui-monospace, monospace); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  min-width: 0;
}
.dvr-var-input:focus {
  outline: none;
}
.dvr-var-input--target {
  /* Target var color = green so condition (amber) and action (green)
   * read distinctly even when both are mono-styled. */
  color: var(--wp-success, #34d399);
}
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
.dvr-tick {
  position: absolute;
  top: calc(100% + var(--wp-space-2));
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px; /* audit-exempt: 5px optical icon+text gap inside compact tick */
  font: 10px var(--wp-font-sans, sans-serif); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  color: var(--wp-text-muted, #9ca3af);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  /* Sit above the VALUE row's input but visually under the op cell;
   * z-index keeps the click target above the input border. */
  z-index: 1;
}
.dvr-tick input[type="checkbox"] {
  margin: 0;
  width: 14px;
  height: 14px;
  accent-color: var(--wp-accent, #6366f1);
  cursor: pointer;
}
.dvr-tick__label { line-height: 1; }
/* Reserve space for the tick under the op cell when it's rendered.
 * Without this, the absolute-positioned tick would overlap the
 * VALUE row beneath. Bumps the value-row's top margin only when the
 * grid has the `--has-tick` modifier set by the template. */
.dvr-grid--has-tick + .dvr-value-row {
  margin-top: var(--wp-space-6);
}
.dvr-value-cell {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.dvr-value-input {
  flex: 1;
  min-width: 0;
}
.dvr-value-input--disabled {
  opacity: 0.45;
  filter: grayscale(0.6);
  pointer-events: none;
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
.dvr-hint {
  margin-top: 3px; /* audit-exempt: 3px hairline nudge */
  margin-left: 68px; /* audit-exempt: 68px = 60px label col + 4+4px gap; aligns under value input column */
  font: 10px var(--wp-font-sans, sans-serif); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  color: var(--wp-text-muted, #9ca3af);
  font-style: italic;
}

.addbar {
  display: flex;
  gap: var(--wp-space-3);
  margin-top: var(--wp-space-5);
  padding-left: var(--wp-space-5);
}
</style>
