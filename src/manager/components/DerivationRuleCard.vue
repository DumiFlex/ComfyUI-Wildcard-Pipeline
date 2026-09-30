<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Card from "./ui/Card.vue";
import Button from "./ui/Button.vue";
import Select from "./ui/Select.vue";
import Chip from "./ui/Chip.vue";
import RichTextInput from "./RichTextInput.vue";
import type { VarProducerLike } from "./RefChip.vue";
import VarAutocompleteInput from "./VarAutocompleteInput.vue";
import type {
  DerivationAction,
  DerivationBranch,
  DerivationCondition,
  DerivationElse,
  DerivationMode,
  DerivationRule,
} from "../api/types";
import DerivationConditionEditor from "./DerivationConditionEditor.vue";
import { clauseActions, conditionLeaves, isNegativeMode, withClauseActions } from "../../extension/derivation-conditions";
import { brokenRefLabels } from "../utils/validateModule";

interface Props {
  modelValue: DerivationRule;
  index: number;
  varSuggestions?: string[];
  /** `$var` → the library module that binds it, for the chip hover cards. */
  varProducers?: Map<string, VarProducerLike>;
  /** UUID → display-name map forwarded to every nested RichTextInput so
   *  `@{uuid}` chips read as `@name` instead of raw hex. */
  uuidToName?: Map<string, string>;
  /** Wildcard-ref autocomplete + step-2 sub-cat picker data, forwarded to
   *  the ACTION-value inputs only (the engine resolves `@{}` there as a
   *  carrier; condition values are compared raw). Same maps the wildcard
   *  editor feeds — built once by `buildWildcardRefData`. */
  refSuggestions?: string[];
  uuidToSubCategories?: Map<string, string[]>;
  uuidToHasNull?: Map<string, boolean>;
  uuidToOptionsCount?: Map<string, number>;
  uuidToOptionTagSets?: Map<string, string[][]>;
  uuidToTagGroups?: Map<string, Record<string, string[]>>;
  /** Default-collapsed when many rules exist (set by editor). */
  defaultCollapsed?: boolean;
  /** Broadcast from the editor's Collapse-all / Expand-all buttons. When
   *  `nonce` changes, the card adopts `collapsed` — but the user can still
   *  toggle any card individually afterwards. */
  collapseCommand?: { nonce: number; collapsed: boolean };
}

const props = withDefaults(defineProps<Props>(), {
  varSuggestions: () => [],
  varProducers: () => new Map(),
  uuidToName: () => new Map(),
  refSuggestions: () => [],
  uuidToSubCategories: () => new Map(),
  uuidToHasNull: () => new Map(),
  uuidToOptionsCount: () => new Map(),
  uuidToOptionTagSets: () => new Map(),
  uuidToTagGroups: () => new Map(),
  defaultCollapsed: false,
});

const collapsed = ref<boolean>(props.defaultCollapsed);
function toggleCollapsed() { collapsed.value = !collapsed.value; }

// Editor-driven Collapse-all / Expand-all: adopt the broadcast state whenever
// its nonce ticks (individual toggles still work afterwards).
watch(
  () => props.collapseCommand?.nonce,
  () => {
    if (props.collapseCommand) collapsed.value = props.collapseCommand.collapsed;
  },
);

// Per-branch collapse. Branch index → collapsed; the ELSE clause is keyed as
// -1. Collapsing hides the condition/action editors and shows a one-line
// summary in the branch head.
/** Every branch key for this rule (IF/ELIF indices + `-1` for ELSE). */
function allBranchKeys(): number[] {
  const r = props.modelValue;
  const keys = r.branches.map((_, i) => i);
  if (r.else) keys.push(-1);
  return keys;
}
// Branches start COLLAPSED on open (matches the request for a compact
// editor). Newly-added branches aren't in this set, so they open expanded
// for immediate editing.
const collapsedBranches = ref<Set<number>>(new Set(allBranchKeys()));
function toggleBranch(bi: number): void {
  const next = new Set(collapsedBranches.value);
  if (next.has(bi)) next.delete(bi);
  else next.add(bi);
  collapsedBranches.value = next;
}
function isBranchCollapsed(bi: number): boolean {
  return collapsedBranches.value.has(bi);
}
/** Click anywhere on a branch header toggles it. Clicks that originated inside
 *  an interactive descendant are left alone: the chevron button already calls
 *  `toggleBranch` (handling it here too would cancel it out), and the enable
 *  checkbox / delete action must not collapse the branch as a side effect. */
function onBranchHeadClick(ev: MouseEvent, bi: number): void {
  const t = ev.target as HTMLElement | null;
  if (t?.closest?.("button, input, select, textarea, a, label, [role='checkbox']")) return;
  toggleBranch(bi);
}
/** Collapse / expand every branch in THIS rule (the inline per-rule control). */
function collapseAllBranches(): void {
  collapsedBranches.value = new Set(allBranchKeys());
}
function expandAllBranches(): void {
  collapsedBranches.value = new Set();
}
/** Compact `$cond → $target` peek for a collapsed branch head. A grouped
 *  condition names its first test and counts the rest (`$a +2 → $b`). */
function branchPeek(branch: DerivationBranch): string {
  const tests = conditionLeaves<DerivationCondition>(branch.condition);
  const cvar = tests[0]?.var ?? "";
  const more = tests.length > 1 ? ` +${tests.length - 1}` : "";
  return `${cvar ? "$" + cvar : "$?"}${more} → ${targetsPeek(branch)}`;
}

/** The targets of a clause's actions, `$a, $b` (THEN ... AND ...). */
function targetsPeek(clause: DerivationBranch | DerivationElse): string {
  return clauseActions<DerivationAction>(clause)
    .map((a) => (a.target_var ? "$" + a.target_var : "$?"))
    .join(", ");
}

/** Missing `@` refs in a clause's action values (the only fields that
 *  resolve refs; test values compare raw), labelled `@name`. */
function clauseBrokenRefs(clause: DerivationBranch | DerivationElse | undefined): string[] {
  const out: string[] = [];
  for (const a of clauseActions<DerivationAction>(clause)) {
    for (const label of brokenRefLabels(a.value, props.uuidToName)) {
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}
function branchBrokenRefs(branch: DerivationBranch): string[] {
  return clauseBrokenRefs(branch);
}
const elseBrokenRefs = computed(() => clauseBrokenRefs(rule.value.else));
const ruleHasBrokenRef = computed(() =>
  elseBrokenRefs.value.length > 0
  || rule.value.branches.some((b) => branchBrokenRefs(b).length > 0));

function brokenTitle(labels: string[]): string {
  return `${labels.join(", ")} not in the library. Click the red chip to point it at a module.`;
}

const emit = defineEmits<{
  "update:modelValue": [value: DerivationRule];
  remove: [];
}>();

const MODE_OPTIONS: Array<{ label: string; value: DerivationMode }> = [
  { label: "Replace", value: "replace" },
  { label: "Append", value: "append" },
  { label: "Prepend", value: "prepend" },
  // Send-to-negative (schema v8): the value goes to the target variable's
  // negatives; the variable itself is not written.
  { label: "Add to negative", value: "negative" },
  // Also v8: the value becomes the variable's only negative.
  { label: "Replace negative", value: "negative_replace" },
];

/** Placeholder for an action value, by mode. */
function valuePlaceholder(mode: DerivationMode): string {
  return mode === "negative_replace"
    ? "Words to use as this variable's whole negative"
    : mode === "negative"
    ? "Words to add to this variable's negative"
    : "The new / appended / prepended value";
}

/** Single-line hint shown below the action value input, listing the
 *  syntax the engine resolves on the derivation surface
 *  (`resolve_text(action.value, surface="derivation")`). Includes `@{}`
 *  nested-wildcard refs — the derivation surface resolves them as carriers
 *  post-Layer-A (engine/syntax/resolve.py). Kept in one place so the wording
 *  stays consistent across the rule + ELSE action blocks. */
const SUPPORTED_SYNTAX_HINT = "Supports $var · @{wildcard} · {a|b|c} · $$ · {N$$sep$$...}";

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

/* ── Actions (THEN ... AND ...) ──────────────────────────────────────────
 * A clause is a branch (keyed by its index) or the ELSE (key -1). It runs its
 * `action`, then each `extra_actions` entry, in order. */
type ClauseKey = number;

function clauseAt(key: ClauseKey): DerivationBranch | DerivationElse | undefined {
  return key === -1 ? rule.value.else : rule.value.branches[key];
}
function actionsOf(key: ClauseKey): DerivationAction[] {
  return clauseActions<DerivationAction>(clauseAt(key));
}
function setActions(key: ClauseKey, actions: DerivationAction[]): void {
  const clause = clauseAt(key);
  if (!clause || actions.length === 0) return;
  if (key === -1) patch({ else: withClauseActions(clause as DerivationElse, actions) });
  else setBranch(key, withClauseActions(clause as DerivationBranch, actions));
}
function patchAction(key: ClauseKey, ai: number, next: Partial<DerivationAction>): void {
  setActions(key, actionsOf(key).map((a, i) => (i === ai ? { ...a, ...next } : a)));
}
function addAction(key: ClauseKey): void {
  setActions(key, [...actionsOf(key), blankAction()]);
}
function removeAction(key: ClauseKey, ai: number): void {
  if (ai === 0) return; // the first action is the THEN itself
  setActions(key, actionsOf(key).filter((_, i) => i !== ai));
}
/** Test id for one action's control: the first action keeps the id it always
 *  had, later ones append `-K`. */
function actTid(base: string, ai: number): string {
  return ai === 0 ? base : `${base}-${ai}`;
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
      <i
        v-if="ruleHasBrokenRef"
        class="pi pi-exclamation-triangle dvr-broken-mark"
        title="A branch in this rule references a module that is not in the library"
        :data-test="`rule-broken-${index}`"
      />
      <span class="spacer" />
      <!-- Inline per-rule collapse/expand of THIS rule's conditions. Only
           useful when the rule card itself is open. -->
      <span v-if="!collapsed" class="rule-head__branch-ctrls">
        <Button
          icon="pi-angle-double-up"
          variant="ghost"
          size="sm"
          :aria-label="`Collapse all conditions in rule ${ruleNumber}`"
          :data-test="`collapse-branches-${index}`"
          @click.stop="collapseAllBranches"
        />
        <Button
          icon="pi-angle-double-down"
          variant="ghost"
          size="sm"
          :aria-label="`Expand all conditions in rule ${ruleNumber}`"
          :data-test="`expand-branches-${index}`"
          @click.stop="expandAllBranches"
        />
      </span>
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
        :class="{ 'branch--broken': branchBrokenRefs(branch).length > 0 }"
        :data-kind="bi === 0 ? 'if' : 'elif'"
        :data-test="`branch-${index}-${bi}`"
      >
        <!-- Whole header toggles — the chevron alone was a ~14px target on a
             full-width bar that already looked pressable. `onBranchHeadClick`
             ignores clicks that came from a control inside the header (the
             chevron button, the enable checkbox, the delete action) so those
             keep their own behaviour and don't double-toggle. -->
        <div class="branch-head" @click="onBranchHeadClick($event, bi)">
          <button
            type="button"
            class="branch-collapse"
            :aria-expanded="!isBranchCollapsed(bi)"
            :aria-label="`${isBranchCollapsed(bi) ? 'Expand' : 'Collapse'} branch ${bi + 1} of rule ${ruleNumber}`"
            :data-test="`toggle-branch-${index}-${bi}`"
            @click="toggleBranch(bi)"
          >
            <i :class="isBranchCollapsed(bi) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" aria-hidden="true" />
          </button>
          <span class="branch-tag" :data-kind="bi === 0 ? 'if' : 'elif'">
            {{ bi === 0 ? "IF" : "ELIF" }}
          </span>
          <span
            v-if="isBranchCollapsed(bi)"
            class="branch-peek"
            :data-test="`branch-peek-${index}-${bi}`"
          >{{ branchPeek(branch) }}</span>
          <span class="spacer" />
          <span
            v-if="branchBrokenRefs(branch).length"
            class="dvr-broken-mark"
            :title="brokenTitle(branchBrokenRefs(branch))"
            :data-test="`branch-broken-${index}-${bi}`"
          ><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ branchBrokenRefs(branch).join(", ") }}</span>
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

        <div v-show="!isBranchCollapsed(bi)" class="branch-body">
        <!-- Compact grid (Proposal B, 2026-05-09 cycle):
             row 1 = WHEN var + op on a single line so the prose
             reads "When $age equals". Row 2 = condition value below
             with explicit "value" label. Same for THEN. Halves the
             vertical space of the prior stacked layout. -->
        <!-- WHEN: one test, or an AND / OR group of them. -->
        <DerivationConditionEditor
          :model-value="branch.condition"
          :test-base="`${index}-${bi}`"
          :a11y-name="`rule ${ruleNumber} branch ${bi + 1}`"
          :var-suggestions="varSuggestions"
          :var-producers="varProducers"
          :uuid-to-name="uuidToName"
          @update:model-value="(v) => setCondition(bi, v)"
        />

        <!-- THEN var + mode on row 1, action value below. Each extra action
             (THEN ... AND ...) repeats the block under an AND label. -->
        <div
          v-for="(act, ai) in actionsOf(bi)"
          :key="ai"
          class="dvr-action"
          :class="{ 'dvr-action--and': ai > 0 }"
          :data-test="actTid(`act-block-${index}-${bi}`, ai)"
        >
        <div class="dvr-grid dvr-grid--then">
          <span class="dvr-label" :class="{ 'dvr-label--and': ai > 0 }">{{ ai === 0 ? "Then" : "And" }}</span>
          <div class="dvr-var-wrap">
            <span class="dvr-prefix">$</span>
            <VarAutocompleteInput
              :model-value="act.target_var"
              :suggestions="varSuggestions"
              placeholder="target_var"
              input-color="var(--wp-success, #34d399)"
              :aria-label="`Action target variable for rule ${ruleNumber} branch ${bi + 1}${ai ? ` (action ${ai + 1})` : ''}`"
              :data-test="actTid(`act-target-${index}-${bi}`, ai)"
              @update:model-value="(v) => patchAction(bi, ai, { target_var: v })"
            />
          </div>
          <span class="dvr-label">action</span>
          <div class="dvr-mode-cell">
            <Select
              :model-value="act.mode"
              :options="MODE_OPTIONS"
              class="dvr-op"
              :data-test="actTid(`act-mode-${index}-${bi}`, ai)"
              :aria-label="`Action mode for rule ${ruleNumber} branch ${bi + 1}${ai ? ` (action ${ai + 1})` : ''}`"
              @update:model-value="(v) => patchAction(bi, ai, { mode: v as DerivationMode })"
            />
            <Button
              v-if="ai > 0"
              icon="pi-times"
              variant="ghost"
              size="sm"
              :aria-label="`Remove action ${ai + 1} from the action list of rule ${ruleNumber} branch ${bi + 1}`"
              :data-test="`act-remove-${index}-${bi}-${ai}`"
              @click="removeAction(bi, ai)"
            />
          </div>
        </div>
        <div class="dvr-value-row">
          <span class="dvr-label">value</span>
          <!-- no module-id here: derivation warnings clear at the editor level -->
          <RichTextInput
            :model-value="act.value"
            surface="derivation"            :var-producers="varProducers"
            wrap
            allow-nested-refs
            :var-suggestions="varSuggestions"
            :uuid-to-name="uuidToName"
            :ref-suggestions="refSuggestions"
            :uuid-to-sub-categories="uuidToSubCategories"
            :uuid-to-has-null="uuidToHasNull"
            :uuid-to-options-count="uuidToOptionsCount"
            :uuid-to-option-tag-sets="uuidToOptionTagSets"
            :uuid-to-tag-groups="uuidToTagGroups"
            class="dvr-value-input"
            :class="{ 'dvr-value-input--neg': isNegativeMode(act.mode) }"
            :placeholder="valuePlaceholder(act.mode)"
            :aria-label="`Action value for rule ${ruleNumber} branch ${bi + 1}${ai ? ` (action ${ai + 1})` : ''}`"
            :data-test="actTid(`act-value-${index}-${bi}`, ai)"
            @update:model-value="(v) => patchAction(bi, ai, { value: v })"
          />
        </div>
        <div class="dvr-hint" :data-test="actTid(`act-hint-${index}-${bi}`, ai)">
          <span
            v-if="isNegativeMode(act.mode)"
            class="dvr-hint--neg"
            :data-test="actTid(`act-neg-hint-${index}-${bi}`, ai)"
          >{{ act.mode === 'negative_replace' ? 'Replaces' : 'Adds to' }} {{ act.target_var ? "$" + act.target_var : "the variable" }}'s negative — its value is not changed. </span>{{ SUPPORTED_SYNTAX_HINT }}
        </div>
        </div>
        <button
          type="button"
          class="dvr-add-action"
          :data-test="`act-add-${index}-${bi}`"
          @click="addAction(bi)"
        ><i class="pi pi-plus" aria-hidden="true" /> And</button>
        </div>
      </div>

      <!-- ELSE branch -->
      <div
        v-if="rule.else"
        class="branch branch--else"
        :class="{ 'branch--broken': elseBrokenRefs.length > 0 }"
        data-kind="else"
        :data-test="`branch-else-${index}`"
      >
        <div class="branch-head" @click="onBranchHeadClick($event, -1)">
          <button
            type="button"
            class="branch-collapse"
            :aria-expanded="!isBranchCollapsed(-1)"
            :aria-label="`${isBranchCollapsed(-1) ? 'Expand' : 'Collapse'} ELSE branch of rule ${ruleNumber}`"
            :data-test="`toggle-branch-else-${index}`"
            @click="toggleBranch(-1)"
          >
            <i :class="isBranchCollapsed(-1) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" aria-hidden="true" />
          </button>
          <span class="branch-tag" data-kind="else">ELSE</span>
          <span
            v-if="isBranchCollapsed(-1)"
            class="branch-peek"
            :data-test="`branch-peek-else-${index}`"
          >→ {{ targetsPeek(rule.else) }}</span>
          <span class="spacer" />
          <span
            v-if="elseBrokenRefs.length"
            class="dvr-broken-mark"
            :title="brokenTitle(elseBrokenRefs)"
            :data-test="`branch-broken-else-${index}`"
          ><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ elseBrokenRefs.join(", ") }}</span>
          <Button
            icon="pi-times"
            variant="ghost"
            size="sm"
            :aria-label="`Remove ELSE branch from rule ${ruleNumber}`"
            :data-test="`remove-else-${index}`"
            @click="removeElse"
          />
        </div>
        <div v-show="!isBranchCollapsed(-1)" class="branch-body">
        <!-- THEN var + mode on row 1, action value below. Each extra action
             (THEN ... AND ...) repeats the block under an AND label. -->
        <div
          v-for="(act, ai) in actionsOf(-1)"
          :key="ai"
          class="dvr-action"
          :class="{ 'dvr-action--and': ai > 0 }"
          :data-test="actTid(`else-block-${index}`, ai)"
        >
        <div class="dvr-grid dvr-grid--then">
          <span class="dvr-label" :class="{ 'dvr-label--and': ai > 0 }">{{ ai === 0 ? "Then" : "And" }}</span>
          <div class="dvr-var-wrap">
            <span class="dvr-prefix">$</span>
            <VarAutocompleteInput
              :model-value="act.target_var"
              :suggestions="varSuggestions"
              placeholder="target_var"
              input-color="var(--wp-success, #34d399)"
              :aria-label="`ELSE action target variable for rule ${ruleNumber}${ai ? ` (action ${ai + 1})` : ''}`"
              :data-test="actTid(`else-target-${index}`, ai)"
              @update:model-value="(v) => patchAction(-1, ai, { target_var: v })"
            />
          </div>
          <span class="dvr-label">action</span>
          <div class="dvr-mode-cell">
            <Select
              :model-value="act.mode"
              :options="MODE_OPTIONS"
              class="dvr-op"
              :data-test="actTid(`else-mode-${index}`, ai)"
              :aria-label="`ELSE action mode for rule ${ruleNumber}${ai ? ` (action ${ai + 1})` : ''}`"
              @update:model-value="(v) => patchAction(-1, ai, { mode: v as DerivationMode })"
            />
            <Button
              v-if="ai > 0"
              icon="pi-times"
              variant="ghost"
              size="sm"
              :aria-label="`Remove action ${ai + 1} from the ELSE of rule ${ruleNumber}`"
              :data-test="`else-remove-${index}-${ai}`"
              @click="removeAction(-1, ai)"
            />
          </div>
        </div>
        <div class="dvr-value-row">
          <span class="dvr-label">value</span>
          <!-- no module-id here: derivation warnings clear at the editor level -->
          <RichTextInput
            :model-value="act.value"
            surface="derivation"            :var-producers="varProducers"
            wrap
            allow-nested-refs
            :var-suggestions="varSuggestions"
            :uuid-to-name="uuidToName"
            :ref-suggestions="refSuggestions"
            :uuid-to-sub-categories="uuidToSubCategories"
            :uuid-to-has-null="uuidToHasNull"
            :uuid-to-options-count="uuidToOptionsCount"
            :uuid-to-option-tag-sets="uuidToOptionTagSets"
            :uuid-to-tag-groups="uuidToTagGroups"
            class="dvr-value-input"
            :class="{ 'dvr-value-input--neg': isNegativeMode(act.mode) }"
            :placeholder="valuePlaceholder(act.mode)"
            :aria-label="`ELSE action value for rule ${ruleNumber}${ai ? ` (action ${ai + 1})` : ''}`"
            :data-test="actTid(`else-value-${index}`, ai)"
            @update:model-value="(v) => patchAction(-1, ai, { value: v })"
          />
        </div>
        <div class="dvr-hint" :data-test="actTid(`else-hint-${index}`, ai)">
          <span
            v-if="isNegativeMode(act.mode)"
            class="dvr-hint--neg"
            :data-test="actTid(`else-neg-hint-${index}`, ai)"
          >{{ act.mode === 'negative_replace' ? 'Replaces' : 'Adds to' }} {{ act.target_var ? "$" + act.target_var : "the variable" }}'s negative — its value is not changed. </span>{{ SUPPORTED_SYNTAX_HINT }}
        </div>
        </div>
        <button
          type="button"
          class="dvr-add-action"
          :data-test="`else-add-action-${index}`"
          @click="addAction(-1)"
        ><i class="pi pi-plus" aria-hidden="true" /> And</button>
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
.rule-head__branch-ctrls { display: inline-flex; gap: 2px; }

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
/* A branch holding a ref that points at nothing. */
.branch--broken {
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 55%, transparent);
  box-shadow: inset 3px 0 0 var(--wp-danger, #ef4444);
}
.dvr-value-input--neg.wp-rt:not(.wp-rt--focused) {
  border-color: color-mix(in oklab, var(--wp-danger, #ef4444) 45%, transparent);
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 7%, var(--wp-bg-2));
}
.dvr-hint--neg { color: var(--wp-danger, #ef4444); }
/* THEN ... AND ...: each action is a block; later ones sit under an AND. */
.dvr-action {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.dvr-action--and {
  padding-top: var(--wp-space-4);
  border-top: 1px dashed var(--wp-border, #2c2c34);
}
.dvr-label--and { color: var(--wp-kind-derivation, #fbbf24); font-weight: 600; }
.dvr-mode-cell { display: flex; align-items: center; gap: var(--wp-space-2); min-width: 0; }
.dvr-mode-cell .dvr-op { flex: 1; min-width: 0; }
.dvr-add-action {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  padding: 2px var(--wp-space-4); /* audit-exempt: compact inline add chip */
  border: 1px dashed var(--wp-border, #2c2c34);
  border-radius: var(--wp-radius-sm);
  background: transparent;
  color: var(--wp-text-muted);
  font: inherit;
  font-size: var(--wp-text-xs);
  cursor: pointer;
}
.dvr-add-action:hover { color: var(--wp-text); border-color: var(--wp-kind-derivation, #fbbf24); }
.dvr-add-action:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.dvr-broken-mark {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  font-size: var(--wp-text-xs);
  color: var(--wp-danger, #ef4444);
}

.branch-head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  /* Whole bar toggles (see `onBranchHeadClick`) — advertise it, and reset the
     cursor on the controls that own their own clicks. */
  cursor: pointer;
}
.branch-head button,
.branch-head input,
.branch-head label { cursor: revert; }
/* Per-branch collapse chevron — mirrors the rule-card head toggle. */
.branch-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--wp-text-muted);
  cursor: pointer;
  border-radius: 4px;
}
.branch-collapse:hover { background: var(--wp-bg-3); color: var(--wp-text); }
.branch-collapse:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.branch-collapse i { font-size: var(--wp-text-xs); }
/* One-line peek shown in a collapsed branch head. */
.branch-peek {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.branch-body {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
  margin-top: var(--wp-space-4);
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

.addbar {
  display: flex;
  gap: var(--wp-space-3);
  margin-top: var(--wp-space-5);
  padding-left: var(--wp-space-5);
}
</style>

<style scoped src="./derivation-rule-grid.css"></style>
