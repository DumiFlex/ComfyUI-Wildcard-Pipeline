<script setup lang="ts">
/**
 * Derivation RulesSection — accordion + branch-table per the
 * 2026-05-10 tier-D modal expansion. Each rule renders as a
 * collapsible card; expanded body shows IF/ELIF/ELSE rows with
 * per-branch enable + condition.value override + action.value
 * override columns.
 *
 * Library editing (rule structure: var/op/target/mode + add/remove
 * rules + add/remove branches) lives in the SPA. Modal exposes only
 * runtime overrides:
 *
 *   - `disabled_rule_ids` — whole-rule on/off (existing)
 *   - `disabled_branch_keys` — silence ELIF/ELSE without disabling
 *     the rule. Encoded `"{rule_id}:{branch_idx}"` for ELIF or
 *     `"{rule_id}:else"` for ELSE. IF (branch_idx=0) NEVER appears
 *     in the list — disabling IF would be redundant with the per-
 *     rule toggle, so the UI doesn't render the checkbox for IF
 *     rows and the engine ignores `r:0` entries defensively.
 *   - `action_value_overrides` — per-rule per-branch action.value
 *     swaps. Engine reads override before payload value at resolve
 *     time. Empty string drops the entry; empty rule_id key
 *     collapses; empty top-level dict collapses to null.
 *   - `condition_value_overrides` — same shape, but for IF + ELIF
 *     conditions only (ELSE has no condition).
 */
import { computed, defineAsyncComponent, ref } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import type { PairingBadge } from "../../../../../extension/constraint-pairs";
import { patchInstance } from "../../instance/patch";
import { varColorClass } from "../../../../shared/var-color";
import RuleValueChips from "./RuleValueChips.vue";
import PairBadge from "../../../PairBadge.vue";

// Async-import the rich-text editor so its chunk stays split + is only
// pulled in when a derivation instance modal expands a rule. RichTextInput
// is ALREADY a lazy chunk in the extension (combine's TemplateSection imports
// the same module) — Vite dedupes, so reusing the identical specifier adds
// ~0 to the bundle. Bug parity: this brings `@{}` chips + autocomplete + the
// sub-cat picker to the canvas override fields, matching the SPA editor.
const RichTextInput = defineAsyncComponent(
  () => import("../../../../../manager/components/RichTextInput.vue"),
);

interface DerivationCondition { var?: string; op?: string; value?: string }
interface DerivationAction { target_var?: string; mode?: string; value?: string }
interface DerivationBranch { condition?: DerivationCondition; action?: DerivationAction }
interface DerivationRule {
  id: string;
  branches?: DerivationBranch[];
  else?: { action?: DerivationAction };
}

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** `$var` autocomplete list for the override RichTextInputs —
     *  upstream + sibling producer vars, forwarded by the modal. */
    varSuggestions?: string[];
    /** Library WILDCARD uuids for the `@{}` autocomplete (ACTION /
     *  ELSE-action inputs only — `condition.value` is compared raw). */
    refSuggestions?: string[];
    /** The six per-wildcard maps `buildWildcardRefData` returns — used
     *  both to chipify `@{uuid}` in the read-only summary and to feed the
     *  ACTION-value RichTextInputs' nested-ref autocomplete + step-2
     *  sub-cat picker. Empty until the modal's catalog fetch resolves. */
    uuidToName?: Map<string, string>;
    uuidToSubCategories?: Map<string, string[]>;
    uuidToHasNull?: Map<string, boolean>;
    uuidToOptionsCount?: Map<string, number>;
    uuidToOptionTagSets?: Map<string, string[][]>;
    uuidToTagGroups?: Map<string, Record<string, string[]>>;
    /** Via-nested constraint pairs that reach a downstream target through a
     *  nested `@{uuid}` ref hosted in this derivation's rule ACTION values.
     *  Keyed by the engine branch key (`${rule_id}:${bi}` / `${rule_id}:else`)
     *  — the SAME carrier-occurrence key `computePairingsFull` stamps. Drives
     *  the inline `↪#N` PairBadge after the value chips in each branch's
     *  summary row, mirroring the wildcard editor's per-option badge. Empty
     *  when this derivation isn't a constraint carrier. */
    viaOptionPairs?: Map<string, readonly PairingBadge[]>;
  }>(),
  {
    varSuggestions: () => [],
    refSuggestions: () => [],
    uuidToName: () => new Map(),
    uuidToSubCategories: () => new Map(),
    uuidToHasNull: () => new Map(),
    uuidToOptionsCount: () => new Map(),
    uuidToOptionTagSets: () => new Map(),
    uuidToTagGroups: () => new Map(),
    viaOptionPairs: () => new Map(),
  },
);
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const rules = computed<DerivationRule[]>(() => {
  const p = (props.module.payload ?? {}) as { rules?: DerivationRule[] };
  return Array.isArray(p.rules) ? p.rules : [];
});

const instance = computed(() => props.module.instance ?? {});

// ── Disabled rules (whole-rule toggle) ─────────────────────────────

const disabledRuleIds = computed<Set<string>>(() => {
  const ids = instance.value.disabled_rule_ids;
  return new Set(Array.isArray(ids) ? ids : []);
});

function isRuleEnabled(rule: DerivationRule): boolean {
  return !disabledRuleIds.value.has(rule.id);
}

function toggleRule(rule: DerivationRule): void {
  const next = new Set(disabledRuleIds.value);
  if (next.has(rule.id)) next.delete(rule.id);
  else next.add(rule.id);
  const value = next.size === 0 ? null : Array.from(next);
  emit("update", patchInstance(props.module, "disabled_rule_ids", value));
}

// ── Disabled branch keys (per-branch toggle) ───────────────────────

const disabledBranchKeys = computed<Set<string>>(() => {
  const keys = instance.value.disabled_branch_keys;
  return new Set(Array.isArray(keys) ? keys : []);
});

function branchKey(ruleId: string, branchIdx: number | "else"): string {
  return `${ruleId}:${branchIdx}`;
}

/** Via-nested constraint-pair badges for one branch occurrence, looked up
 *  by its engine branch key. Empty array when this derivation isn't a
 *  carrier for that branch — keeps the template `v-for` inert without a
 *  surrounding `v-if`. */
function pairBadgesFor(ruleId: string, branchIdx: number | "else"): readonly PairingBadge[] {
  return props.viaOptionPairs.get(branchKey(ruleId, branchIdx)) ?? [];
}

function isBranchEnabled(ruleId: string, branchIdx: number | "else"): boolean {
  return !disabledBranchKeys.value.has(branchKey(ruleId, branchIdx));
}

function toggleBranch(ruleId: string, branchIdx: number | "else"): void {
  const next = new Set(disabledBranchKeys.value);
  const key = branchKey(ruleId, branchIdx);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  const value = next.size === 0 ? null : Array.from(next);
  emit("update", patchInstance(props.module, "disabled_branch_keys", value));
}

// ── Value overrides (action + condition) ───────────────────────────

type OverrideMap = Record<string, Record<string, string>>;

function readOverrideMap(field: "action_value_overrides" | "condition_value_overrides"): OverrideMap {
  const v = instance.value[field];
  return v && typeof v === "object" ? (v as OverrideMap) : {};
}

function getOverride(
  field: "action_value_overrides" | "condition_value_overrides",
  ruleId: string,
  key: string,
): string {
  const map = readOverrideMap(field);
  return map[ruleId]?.[key] ?? "";
}

/** Patch helper — sets `map[ruleId][key] = value` (or deletes the
 *  entry when value is empty). Collapses empty rule_id sub-objects
 *  and finally collapses an empty top-level map to null so the
 *  modified-state computed never lights up over an empty shell. */
function setOverride(
  field: "action_value_overrides" | "condition_value_overrides",
  ruleId: string,
  key: string,
  value: string,
): void {
  const current = readOverrideMap(field);
  // Deep-clone the rule's submap so the proxy comparison in the
  // ModuleEditModal save reconciliation sees a fresh object.
  const next: OverrideMap = { ...current };
  const sub: Record<string, string> = { ...(next[ruleId] ?? {}) };
  if (value === "") {
    delete sub[key];
  } else {
    sub[key] = value;
  }
  if (Object.keys(sub).length === 0) {
    delete next[ruleId];
  } else {
    next[ruleId] = sub;
  }
  const collapsed = Object.keys(next).length === 0 ? null : next;
  emit("update", patchInstance(props.module, field, collapsed));
}

// RichTextInput emits the resolved string directly (not a DOM Event), so
// these handlers take the value as-is. `setOverride` already collapses an
// empty string to a dropped entry / null map.
function onActionOverrideInput(ruleId: string, key: string, value: string): void {
  setOverride("action_value_overrides", ruleId, key, value);
}

function onCondOverrideInput(ruleId: string, key: string, value: string): void {
  setOverride("condition_value_overrides", ruleId, key, value);
}

// ── Mod-count chip ─────────────────────────────────────────────────

function modCount(rule: DerivationRule): number {
  const ruleId = rule.id;
  let count = 0;
  // Disabled branches that belong to this rule.
  for (const k of disabledBranchKeys.value) {
    if (k.startsWith(`${ruleId}:`)) count += 1;
  }
  // Action value overrides on this rule.
  const aMap = readOverrideMap("action_value_overrides")[ruleId];
  if (aMap) count += Object.keys(aMap).length;
  // Condition value overrides on this rule.
  const cMap = readOverrideMap("condition_value_overrides")[ruleId];
  if (cMap) count += Object.keys(cMap).length;
  return count;
}

// ── Accordion state ────────────────────────────────────────────────

const expandedRules = ref<Set<string>>(new Set());

function isExpanded(ruleId: string): boolean {
  return expandedRules.value.has(ruleId);
}

function toggleExpand(ruleId: string): void {
  const next = new Set(expandedRules.value);
  if (next.has(ruleId)) next.delete(ruleId);
  else next.add(ruleId);
  expandedRules.value = next;
}

// ── Drag-to-reorder rules (instance-only override) ────────────────

const draggingRuleId = ref<string | null>(null);
const dragOverRuleId = ref<string | null>(null);

/** Effective rule order — instance override when set, else library
 *  payload order. Used as the base for drop-to-reorder math so the
 *  next emit reflects what the user actually sees on screen. */
function effectiveRuleOrder(): string[] {
  const override = instance.value.rule_order_override;
  if (Array.isArray(override) && override.length > 0) {
    // Append any rule_ids missing from the override (library tail).
    const seen = new Set(override);
    const tail = rules.value.map((r) => r.id).filter((id) => !seen.has(id));
    return [...override, ...tail];
  }
  return rules.value.map((r) => r.id);
}

/** Library-order array — used as the "no override" baseline. When the
 *  drop result equals this, we collapse rule_order_override to null
 *  so the modified-state computed doesn't light up unnecessarily. */
function libraryRuleOrder(): string[] {
  return rules.value.map((r) => r.id);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function onRuleDragStart(ruleId: string, ev: DragEvent): void {
  draggingRuleId.value = ruleId;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    // Set some payload so Firefox actually fires drag events.
    ev.dataTransfer.setData("text/plain", ruleId);
  }
}

function onRuleDragOver(ruleId: string, ev: DragEvent): void {
  if (!draggingRuleId.value) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  if (dragOverRuleId.value !== ruleId) dragOverRuleId.value = ruleId;
}

function onRuleDragLeave(ruleId: string): void {
  if (dragOverRuleId.value === ruleId) dragOverRuleId.value = null;
}

function onRuleDragEnd(): void {
  draggingRuleId.value = null;
  dragOverRuleId.value = null;
}

function onRuleDrop(targetId: string, ev: DragEvent): void {
  ev.preventDefault();
  const sourceId = draggingRuleId.value;
  draggingRuleId.value = null;
  dragOverRuleId.value = null;
  if (!sourceId || sourceId === targetId) return;

  const order = effectiveRuleOrder();
  const sourceIdx = order.indexOf(sourceId);
  const targetIdx = order.indexOf(targetId);
  if (sourceIdx < 0 || targetIdx < 0) return;

  // Move source BEFORE target — drop indicator visually sits on
  // target, source slides into target's old slot, target shifts down.
  const next = order.slice();
  next.splice(sourceIdx, 1);
  // After removal, target's index may have shifted by 1 if source
  // was earlier in the list.
  const insertIdx = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
  next.splice(insertIdx, 0, sourceId);

  // Collapse to null when the new order matches library order — keeps
  // modified-state honest.
  const collapsed = arraysEqual(next, libraryRuleOrder()) ? null : next;
  emit("update", patchInstance(props.module, "rule_order_override", collapsed));
}

/** Rules sorted by effective order so the v-for renders in the
 *  override sequence. Library payload is read-only; we only swap the
 *  visual order. */
const orderedRules = computed<DerivationRule[]>(() => {
  const order = effectiveRuleOrder();
  const byId = new Map(rules.value.map((r) => [r.id, r]));
  return order.map((id) => byId.get(id)).filter((r): r is DerivationRule => r !== undefined);
});

// ── Display helpers (read-only summary tokens) ─────────────────────

function opSymbol(op: string | undefined): string {
  switch (op) {
    case "equals": return "=";
    case "not_equals": return "≠";
    case "contains": return "contains";
    case "matches": return "matches";
    case "exists": return "exists";
    case "not_exists": return "absent";
    case "is_set": return "is set";
    case "is_unset": return "is unset";
    default: return op ?? "";
  }
}

function modeLabel(mode: string | undefined): string {
  if (mode === "append") return "+=";
  if (mode === "prepend") return "=+";
  return "=";
}

/** Whether the op needs a value field at all (presence-check ops
 *  ignore condition.value). Drives the cond-override input being
 *  rendered or skipped per branch. */
function opUsesValue(op: string | undefined): boolean {
  return op !== "exists" && op !== "not_exists" && op !== "is_set" && op !== "is_unset";
}
</script>

<template>
  <section class="rules">
    <div class="rules__head">
      <span class="rules__label">Rules</span>
      <span class="rules__hint" data-test="rules-spa-hint">
        Click a rule to expand · toggle branches · override values · edit logic in SPA
      </span>
    </div>

    <div v-if="rules.length === 0" class="rules__empty" data-test="rules-empty">
      No rules defined. Open the library entry in SPA to add rules.
    </div>

    <div v-else class="rules__list">
      <div
        v-for="(rule, ruleIdx) in orderedRules"
        :key="rule.id"
        class="rule-card"
        :class="{
          'rule-card--off': !isRuleEnabled(rule),
          'rule-card--open': isExpanded(rule.id),
          'rule-card--dragging': draggingRuleId === rule.id,
          'rule-card--drop-target': dragOverRuleId === rule.id && draggingRuleId !== null && draggingRuleId !== rule.id,
        }"
        :data-test="`rule-card-${rule.id}`"
        @dragover="(ev) => onRuleDragOver(rule.id, ev)"
        @dragleave="() => onRuleDragLeave(rule.id)"
        @drop="(ev) => onRuleDrop(rule.id, ev)"
        @dragend="onRuleDragEnd"
      >
        <!-- Head row -->
        <button
          type="button"
          class="rule-head"
          :data-test="`rule-head-${rule.id}`"
          :aria-expanded="isExpanded(rule.id)"
          @click="toggleExpand(rule.id)"
        >
          <i
            :class="['pi', isExpanded(rule.id) ? 'pi-chevron-down' : 'pi-chevron-right']"
            class="rule-head__caret"
            aria-hidden="true"
          />
          <span
            class="rule-head__toggle"
            :class="{ 'rule-head__toggle--on': isRuleEnabled(rule) }"
            :data-test="`rule-toggle-${rule.id}`"
            role="switch"
            :aria-checked="isRuleEnabled(rule)"
            :aria-label="isRuleEnabled(rule) ? `Disable rule ${rule.id}` : `Enable rule ${rule.id}`"
            @click.stop="toggleRule(rule)"
          >
            <i :class="['pi', isRuleEnabled(rule) ? 'pi-check' : 'pi-times']" aria-hidden="true" />
          </span>

          <span class="rule-head__num" :title="`Rule id ${rule.id}`">Rule {{ ruleIdx + 1 }}</span>

          <span class="rule-head__summary" :data-test="`rule-summary-${rule.id}`">
            <template v-if="rule.branches && rule.branches.length > 0">
              <span
                v-if="rule.branches[0].condition?.var"
                :class="['rule-tok-var', varColorClass(rule.branches[0].condition.var)]"
              >${{ rule.branches[0].condition.var }}</span>
              <span class="rule-tok-op">{{ opSymbol(rule.branches[0].condition?.op) }}</span>
              <span
                v-if="opUsesValue(rule.branches[0].condition?.op)"
                class="rule-tok-val"
              ><RuleValueChips :value="rule.branches[0].condition?.value" :uuid-to-name="uuidToName" /></span>
              <span class="rule-tok-arrow">→</span>
              <span
                v-if="rule.branches[0].action?.target_var"
                :class="['rule-tok-var', varColorClass(rule.branches[0].action.target_var)]"
              >${{ rule.branches[0].action.target_var }}</span>
              <span class="rule-tok-op">{{ modeLabel(rule.branches[0].action?.mode) }}</span>
              <span class="rule-tok-val"><RuleValueChips :value="rule.branches[0].action?.value" :uuid-to-name="uuidToName" /></span>
              <!-- Inline ↪#N constraint-pair badge — rendered when this
                   derivation is a constraint carrier through the IF branch's
                   nested `@{uuid}` ref. Mirrors OptionRow's per-option badge
                   so the summary reads "@{tint} ↪#1". -->
              <PairBadge
                v-for="p in pairBadgesFor(rule.id, 0)"
                :key="`${p.number}-${p.targetUuid}`"
                :pair="p"
                variant="option"
              />
            </template>
          </span>

          <span
            v-if="modCount(rule) > 0"
            class="rule-head__chip rule-head__chip--mod"
            :data-test="`rule-mod-count-${rule.id}`"
          >{{ modCount(rule) }} mod{{ modCount(rule) === 1 ? "" : "s" }}</span>

          <!-- Drag handle — `draggable` lives on the handle (not the
               whole card) so users only initiate reorder from this
               grip. Drop targets are the entire rule cards (handled
               via @dragover/@drop on the parent div). -->
          <span
            class="rule-head__drag"
            :data-test="`rule-drag-${rule.id}`"
            draggable="true"
            aria-label="Drag to reorder rule"
            @dragstart="(ev) => onRuleDragStart(rule.id, ev)"
            @click.stop
          >⋮⋮</span>
        </button>

        <!-- Expanded body — branch table -->
        <div
          v-if="isExpanded(rule.id)"
          class="rule-body"
          :data-test="`rule-body-${rule.id}`"
        >
          <div class="branch-table">
            <div class="branch-row branch-row--head">
              <span class="branch-cell branch-cell--head">on</span>
              <span class="branch-cell branch-cell--head">tag</span>
              <span class="branch-cell branch-cell--head">summary</span>
              <span class="branch-cell branch-cell--head">condition override</span>
              <span class="branch-cell branch-cell--head">action override</span>
            </div>

            <!-- IF + ELIF branch rows -->
            <div
              v-for="(branch, bi) in rule.branches"
              :key="bi"
              class="branch-row"
              :class="{
                'branch-row--off': bi !== 0 && !isBranchEnabled(rule.id, bi),
              }"
              :data-test="`branch-row-${rule.id}-${bi}`"
            >
              <span class="branch-cell branch-cell--toggle">
                <!-- IF (bi=0) gets no checkbox — disabling IF would be
                     redundant with the per-rule toggle. Placeholder
                     keeps the column aligned. -->
                <span
                  v-if="bi !== 0"
                  class="branch-toggle"
                  :class="{ 'branch-toggle--on': isBranchEnabled(rule.id, bi) }"
                  :data-test="`branch-toggle-${rule.id}-${bi}`"
                  role="switch"
                  :aria-checked="isBranchEnabled(rule.id, bi)"
                  :aria-label="isBranchEnabled(rule.id, bi) ? `Disable branch ${bi}` : `Enable branch ${bi}`"
                  @click="toggleBranch(rule.id, bi)"
                >
                  <i :class="['pi', isBranchEnabled(rule.id, bi) ? 'pi-check' : 'pi-times']" aria-hidden="true" />
                </span>
              </span>
              <span class="branch-cell branch-cell--tag" :data-kind="bi === 0 ? 'if' : 'elif'">
                {{ bi === 0 ? "IF" : "ELIF" }}
              </span>
              <span class="branch-cell branch-cell--summary">
                <span
                  v-if="branch.condition?.var"
                  :class="['rule-tok-var', varColorClass(branch.condition.var)]"
                >${{ branch.condition.var }}</span>
                <span class="rule-tok-op">{{ opSymbol(branch.condition?.op) }}</span>
                <span
                  v-if="opUsesValue(branch.condition?.op)"
                  class="rule-tok-val"
                ><RuleValueChips :value="branch.condition?.value" :uuid-to-name="uuidToName" /></span>
                <span class="rule-tok-arrow">→</span>
                <span
                  v-if="branch.action?.target_var"
                  :class="['rule-tok-var', varColorClass(branch.action.target_var)]"
                >${{ branch.action.target_var }}</span>
                <span class="rule-tok-op">{{ modeLabel(branch.action?.mode) }}</span>
                <span class="rule-tok-val"><RuleValueChips :value="branch.action?.value" :uuid-to-name="uuidToName" /></span>
                <PairBadge
                  v-for="p in pairBadgesFor(rule.id, bi)"
                  :key="`${p.number}-${p.targetUuid}`"
                  :pair="p"
                  variant="option"
                />
              </span>
              <span class="branch-cell branch-cell--cond-override">
                <!-- condition.value override — RichTextInput on the
                     `derivation` surface gives `$var` chips/autocomplete, but
                     NO `@{}` machinery: the engine compares condition.value
                     RAW (never resolves refs/vars there). Matches the SPA
                     DerivationRuleCard condition field. -->
                <RichTextInput
                  v-if="opUsesValue(branch.condition?.op)"
                  surface="derivation"
                  :var-suggestions="varSuggestions"
                  :uuid-to-name="uuidToName"
                  :model-value="getOverride('condition_value_overrides', rule.id, String(bi))"
                  :placeholder="branch.condition?.value || ''"
                  class="branch-override-input"
                  :class="{ 'branch-override-input--mod': getOverride('condition_value_overrides', rule.id, String(bi)) !== '' }"
                  :data-test="`cond-override-${rule.id}-${bi}`"
                  :aria-label="`Condition value override for rule ${rule.id} branch ${bi}`"
                  @update:model-value="(v: string) => onCondOverrideInput(rule.id, String(bi), v)"
                />
              </span>
              <span class="branch-cell branch-cell--action-override">
                <!-- action.value override — full `@{}` carrier machinery
                     (allow-nested-refs + the six ref-data maps): the engine
                     resolves `@{}` here post-Layer-A. Matches the SPA
                     DerivationRuleCard action field. -->
                <RichTextInput
                  surface="derivation"
                  allow-nested-refs
                  :var-suggestions="varSuggestions"
                  :ref-suggestions="refSuggestions"
                  :uuid-to-name="uuidToName"
                  :uuid-to-sub-categories="uuidToSubCategories"
                  :uuid-to-has-null="uuidToHasNull"
                  :uuid-to-options-count="uuidToOptionsCount"
                  :uuid-to-option-tag-sets="uuidToOptionTagSets"
                  :uuid-to-tag-groups="uuidToTagGroups"
                  :model-value="getOverride('action_value_overrides', rule.id, String(bi))"
                  :placeholder="branch.action?.value || ''"
                  class="branch-override-input"
                  :class="{ 'branch-override-input--mod': getOverride('action_value_overrides', rule.id, String(bi)) !== '' }"
                  :data-test="`action-override-${rule.id}-${bi}`"
                  :aria-label="`Action value override for rule ${rule.id} branch ${bi}`"
                  @update:model-value="(v: string) => onActionOverrideInput(rule.id, String(bi), v)"
                />
              </span>
            </div>

            <!-- ELSE row (when present) -->
            <div
              v-if="rule.else"
              class="branch-row"
              :class="{ 'branch-row--off': !isBranchEnabled(rule.id, 'else') }"
              :data-test="`branch-row-${rule.id}-else`"
            >
              <span class="branch-cell branch-cell--toggle">
                <span
                  class="branch-toggle"
                  :class="{ 'branch-toggle--on': isBranchEnabled(rule.id, 'else') }"
                  :data-test="`branch-toggle-${rule.id}-else`"
                  role="switch"
                  :aria-checked="isBranchEnabled(rule.id, 'else')"
                  :aria-label="isBranchEnabled(rule.id, 'else') ? 'Disable ELSE branch' : 'Enable ELSE branch'"
                  @click="toggleBranch(rule.id, 'else')"
                >
                  <i :class="['pi', isBranchEnabled(rule.id, 'else') ? 'pi-check' : 'pi-times']" aria-hidden="true" />
                </span>
              </span>
              <span class="branch-cell branch-cell--tag" data-kind="else">ELSE</span>
              <span class="branch-cell branch-cell--summary">
                <span class="rule-tok-arrow">→</span>
                <span
                  v-if="rule.else.action?.target_var"
                  :class="['rule-tok-var', varColorClass(rule.else.action.target_var)]"
                >${{ rule.else.action.target_var }}</span>
                <span class="rule-tok-op">{{ modeLabel(rule.else.action?.mode) }}</span>
                <span class="rule-tok-val"><RuleValueChips :value="rule.else.action?.value" :uuid-to-name="uuidToName" /></span>
                <PairBadge
                  v-for="p in pairBadgesFor(rule.id, 'else')"
                  :key="`${p.number}-${p.targetUuid}`"
                  :pair="p"
                  variant="option"
                />
              </span>
              <!-- ELSE has no condition → no condition override cell -->
              <span class="branch-cell branch-cell--cond-override"></span>
              <span class="branch-cell branch-cell--action-override">
                <!-- ELSE action.value override — full `@{}` carrier machinery,
                     same as the IF/ELIF action field. -->
                <RichTextInput
                  surface="derivation"
                  allow-nested-refs
                  :var-suggestions="varSuggestions"
                  :ref-suggestions="refSuggestions"
                  :uuid-to-name="uuidToName"
                  :uuid-to-sub-categories="uuidToSubCategories"
                  :uuid-to-has-null="uuidToHasNull"
                  :uuid-to-options-count="uuidToOptionsCount"
                  :uuid-to-option-tag-sets="uuidToOptionTagSets"
                  :uuid-to-tag-groups="uuidToTagGroups"
                  :model-value="getOverride('action_value_overrides', rule.id, 'else')"
                  :placeholder="rule.else.action?.value || ''"
                  class="branch-override-input"
                  :class="{ 'branch-override-input--mod': getOverride('action_value_overrides', rule.id, 'else') !== '' }"
                  :data-test="`action-override-${rule.id}-else`"
                  :aria-label="`ELSE action value override for rule ${rule.id}`"
                  @update:model-value="(v: string) => onActionOverrideInput(rule.id, 'else', v)"
                />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rules {
  padding: 12px 16px;
  background: var(--wp-bg);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.rules__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.rules__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
.rules__hint {
  font: 400 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.rules__empty {
  padding: 12px;
  text-align: center;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px dashed var(--wp-border);
  border-radius: 3px;
}
.rules__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Rule card */
.rule-card {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
}
.rule-card--off { opacity: 0.55; }
.rule-card--dragging { opacity: 0.5; }
.rule-card--drop-target {
  /* Visual cue that dropping here will insert the dragged rule
   * BEFORE this card. Border-top accent matches drag-handle color. */
  border-top: 2px solid var(--wp-accent);
}

/* Head — single-row clickable bar */
.rule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: var(--wp-bg2);
  border: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--wp-text);
}
.rule-card--open .rule-head { border-bottom: 1px solid var(--wp-border); }
.rule-head:hover { background: var(--wp-bg3); }
.rule-head__caret {
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3));
}
.rule-head__toggle {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: var(--wp-bg);
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  flex-shrink: 0;
}
.rule-head__toggle--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: white;
}
.rule-head__toggle .pi { font-size: 9px; }
.rule-head__num {
  font: 600 10px var(--wp-font-sans);
  color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 12%, transparent);
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.rule-head__summary {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  font: 11px var(--wp-font-mono);
  flex-wrap: wrap;
}
.rule-card--off .rule-head__summary { text-decoration: line-through; }
.rule-head__chip {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.rule-head__chip--mod {
  color: var(--wp-status-modified, #f59e0b);
  border-color: color-mix(in srgb, var(--wp-status-modified, #f59e0b) 35%, transparent);
  background: color-mix(in srgb, var(--wp-status-modified, #f59e0b) 10%, transparent);
}
.rule-head__drag {
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 11px;
  cursor: grab;
  padding: 0 2px;
}

/* Body — branch table */
.rule-body {
  padding: 8px 10px;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.branch-table {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.branch-row {
  display: grid;
  grid-template-columns: 28px 38px 1fr 1fr 1fr;
  gap: 6px;
  align-items: center;
  padding: 4px 6px;
  font: 11px var(--wp-font-mono);
  border-bottom: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.branch-row:last-child { border-bottom: 0; }
.branch-row--head {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim, var(--wp-text3));
  border-bottom: 1px solid var(--wp-border);
  margin-bottom: 2px;
  padding-bottom: 4px;
}
.branch-row--off {
  opacity: 0.5;
}
.branch-row--off .branch-cell--summary { text-decoration: line-through; }
.branch-cell {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.branch-cell--summary {
  flex-wrap: wrap;
}
.branch-cell--head {
  color: var(--wp-text-dim, var(--wp-text3));
  font-weight: 600;
}
.branch-cell--toggle { justify-content: center; }
.branch-cell--tag {
  justify-content: flex-start;
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.branch-cell--tag[data-kind="if"] { color: var(--wp-kind-derivation, #fbbf24); }
.branch-cell--tag[data-kind="elif"] { color: var(--wp-info, #60a5fa); }
.branch-cell--tag[data-kind="else"] { color: var(--wp-warn, var(--wp-status-modified, #f59e0b)); }

.branch-toggle {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  background: var(--wp-bg);
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  flex-shrink: 0;
}
.branch-toggle--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: white;
}
.branch-toggle .pi { font-size: 8px; }

/* The override fields are now RichTextInput hosts (atomic-chip editors)
 * rather than bare `<input>`s — RichTextInput supplies its own `.wp-rt`
 * border / background / padding / mono font. We only own the grid-cell
 * sizing here + the `--mod` accent (same minimal approach combine's
 * TemplateSection uses with `.wp-tpl__input--mod`). The `:deep()` rules
 * tighten the embedded host to the compact 10px branch-table scale so the
 * canvas override field doesn't tower over the summary row. */
.branch-override-input {
  width: 100%;
  min-width: 0;
}
.branch-override-input :deep(.wp-rt) {
  font: 10px var(--wp-font-mono);
  border-style: dashed;
}
.branch-override-input :deep(.wp-rt__host) {
  padding: 3px 6px;
}
.branch-override-input--mod :deep(.wp-rt) {
  border-style: solid;
  border-color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 6%, var(--wp-bg2));
}

/* Token coloring (re-used from prior list rendering) */
.rule-tok-var { font-weight: 600; }
.rule-tok-op {
  color: var(--wp-text-dim, var(--wp-text3));
  font-weight: 600;
  padding: 0 2px;
}
.rule-tok-val {
  color: var(--wp-text);
  background: color-mix(in srgb, var(--wp-text-dim, var(--wp-text3)) 12%, transparent);
  padding: 0 4px;
  border-radius: 2px;
}
.rule-tok-arrow {
  color: var(--wp-text-dim, var(--wp-text3));
  margin: 0 2px;
}
</style>
