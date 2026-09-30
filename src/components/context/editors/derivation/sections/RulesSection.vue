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
import type { VarProducerLike } from "../../../../../manager/components/RefChip.vue";
import { patchInstance } from "../../instance/patch";
import { varColorClass } from "../../../../shared/var-color";
import RuleValueChips from "./RuleValueChips.vue";
import { tokenizeRich } from "../../../../../widgets/richTokenize";
import PairBadge from "../../../PairBadge.vue";
import {
  actionOverrideKey,
  clauseActions,
  isNegativeMode,
  conditionOverrideKey,
  isConditionGroup,
  matchWord,
} from "../../../../../extension/derivation-conditions";

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
/** `condition` is one test or an AND / OR group of them (schema v7). */
interface DerivationBranch { condition?: unknown; action?: DerivationAction; extra_actions?: DerivationAction[] }
interface DerivationElse { action?: DerivationAction; extra_actions?: DerivationAction[] }
interface DerivationRule {
  id: string;
  branches?: DerivationBranch[];
  else?: DerivationElse;
}

/** A clause's actions in run order: `action`, then `extra_actions`
 *  (THEN ... AND ...). */
function acts(clause: DerivationBranch | DerivationElse | undefined): DerivationAction[] {
  return clauseActions<DerivationAction>(clause);
}

/** One override field per action of a clause, keyed the way the engine reads
 *  `action_value_overrides` (the first action keeps the bare branch key). */
function actionOverrides(
  clause: DerivationBranch | DerivationElse | undefined,
  branch: number | "else",
): Array<{ key: string; action: DerivationAction }> {
  return acts(clause).map((action, ai) => ({ key: actionOverrideKey(branch, ai), action }));
}

/** `@` refs in a rule's action values (library and this node's overrides)
 *  whose target the catalog does not hold, labelled `@name`. Test values are
 *  compared raw, so they never carry a ref. Empty until the catalog has
 *  loaded, so a rule never flashes red while it fetches. */
function ruleBrokenRefs(rule: DerivationRule): string[] {
  const known = props.uuidToName;
  if (known.size === 0) return [];
  const texts: unknown[] = [];
  for (const clause of [...(rule.branches ?? []), rule.else]) {
    for (const a of acts(clause)) texts.push(a.value);
  }
  const inst = props.module.instance as Record<string, unknown> | undefined;
  const byRule = (inst?.action_value_overrides as Record<string, Record<string, unknown>> | null | undefined)?.[rule.id];
  if (byRule && typeof byRule === "object") texts.push(...Object.values(byRule));
  const out: string[] = [];
  for (const text of texts) {
    if (typeof text !== "string" || !text.includes("@")) continue;
    for (const tok of tokenizeRich(text)) {
      const uuid = tok.kind === "ref" ? tok.meta?.uuid : undefined;
      if (!uuid || known.has(uuid)) continue;
      const name = typeof tok.meta?.name === "string" && tok.meta.name ? tok.meta.name : "";
      const label = name ? `@${name}` : `@{${uuid}}`;
      if (!out.includes(label)) out.push(label);
    }
  }
  return out;
}

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** `$var` autocomplete list for the override RichTextInputs —
     *  upstream + sibling producer vars, forwarded by the modal. */
    varSuggestions?: string[];
    /** `$var` → producing module + node, forwarded to the override fields'
     *  RichTextInputs so their var chips can name the producer on hover. */
    varProducers?: Map<string, VarProducerLike>;
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
    varProducers: () => new Map(),
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
    case "is_empty": return "is empty";
    case "is_not_empty": return "is not empty";
    default: return op ?? "";
  }
}

function modeLabel(mode: string | undefined): string {
  if (mode === "append") return "+=";
  if (mode === "prepend") return "=+";
  // Send-to-negative: the value is filed under the variable's negatives;
  // the variable itself is not written.
  if (mode === "negative") return "neg +=";
  if (mode === "negative_replace") return "neg =";
  return "=";
}

/** Hover text for a negative action's mode, which reads as an odd assignment
 *  without it. */
function modeTitle(mode: string | undefined): string | undefined {
  if (mode === "negative") return "Add to negative — the variable is not changed";
  if (mode === "negative_replace") return "Replace negative — the variable is not changed";
  return undefined;
}

/** Whether the op needs a value field at all (presence-check ops
 *  ignore condition.value). Drives the cond-override input being
 *  rendered or skipped per branch. */
function opUsesValue(op: string | undefined): boolean {
  return op !== "exists" && op !== "not_exists" && op !== "is_set" && op !== "is_unset"
    && op !== "is_empty" && op !== "is_not_empty";
}

/** A branch condition as summary tokens: `$a = x AND ($b = y OR $c absent)`. */
interface CondPart { kind: "var" | "op" | "val" | "join" | "paren"; text: string }
function condParts(cond: unknown, nested = false): CondPart[] {
  if (isConditionGroup(cond)) {
    const kids = Array.isArray(cond.conditions) ? cond.conditions : [];
    const out: CondPart[] = nested ? [{ kind: "paren", text: "(" }] : [];
    kids.forEach((child, i) => {
      if (i > 0) out.push({ kind: "join", text: matchWord(cond.match) });
      out.push(...condParts(child, true));
    });
    if (nested) out.push({ kind: "paren", text: ")" });
    return out;
  }
  const c = (cond ?? {}) as DerivationCondition;
  const out: CondPart[] = [];
  if (c.var) out.push({ kind: "var", text: c.var });
  out.push({ kind: "op", text: opSymbol(c.op) });
  if (opUsesValue(c.op)) out.push({ kind: "val", text: c.value ?? "" });
  return out;
}

/**
 * Longest value a preview row will render before it gets cut.
 *
 * The summary wraps, which is what makes a multi-chip value readable — but a
 * paragraph-length override then ran to dozens of lines and pushed the rest of
 * the modal off screen. Capping the VALUE rather than the layout keeps every
 * normal row exactly as it was (chips, wrapping, all of it visible) and only
 * touches the outliers. `title` still carries the full text on hover.
 */
const SUMMARY_MAX_CHARS = 120;

/**
 * Cut `value` to `SUMMARY_MAX_CHARS` and append an ellipsis, never splitting a
 * `@{...}` token — half a token would render as literal text instead of a
 * chip, which looks like corruption rather than truncation. A token that would
 * straddle the limit is dropped whole.
 */
function clampPreviewValue(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  if (s.length <= SUMMARY_MAX_CHARS) return s;
  // Capturing split keeps the `@{...}` tokens as their own segments.
  const segments = s.split(/(@\{[^}]*\})/g);
  let out = "";
  for (const seg of segments) {
    if (out.length >= SUMMARY_MAX_CHARS) break;
    if (seg.startsWith("@{")) {
      if (out.length > 0 && out.length + seg.length > SUMMARY_MAX_CHARS) break;
      out += seg;
    } else {
      out += seg.slice(0, SUMMARY_MAX_CHARS - out.length);
    }
  }
  return out.length < s.length ? `${out.trimEnd()}…` : out;
}

/** Plain-text rendering of a branch, for the `title` on the preview rows —
 *  the visible summary caps long values, so this is how the user reads the
 *  rest. */
function branchSummaryText(
  branch: { condition?: unknown; action?: DerivationAction; extra_actions?: DerivationAction[] } | undefined,
): string {
  if (!branch) return "";
  const parts: string[] = [];
  const cond = condParts(branch.condition)
    .filter((p) => p.kind !== "val" || p.text !== "")
    .map((p) => (p.kind === "var" ? `$${p.text}` : p.text))
    .join(" ");
  if (cond) parts.push(cond);
  const then = acts(branch)
    .filter((a) => a.target_var)
    .map((a) => `$${a.target_var} ${modeLabel(a.mode)} ${a.value ?? ""}`.trim());
  if (then.length) parts.push(`→ ${then.join(" AND ")}`);
  return parts.join(" ").trim();
}

/** Same, for the collapsed rule head — which previews its FIRST branch. */
function ruleSummaryText(rule: DerivationRule): string {
  const first = rule.branches?.[0];
  const head = branchSummaryText(first);
  const n = rule.branches?.length ?? 0;
  return n > 1 ? `${head}  (+${n - 1} more branch${n - 1 === 1 ? "" : "es"})` : head;
}

/** A rule's clauses in order — IF, each ELIF, then ELSE — so the body renders
 *  them as one run of branch cards. `bi` is the engine branch index (or
 *  `"else"`), which every toggle / override key is built from. */
interface ClauseView { bi: number | "else"; clause: DerivationBranch | DerivationElse; hasCondition: boolean }
function clausesOf(rule: DerivationRule): ClauseView[] {
  const out: ClauseView[] = (rule.branches ?? []).map((clause, bi) => ({ bi, clause, hasCondition: true }));
  if (rule.else) out.push({ bi: "else", clause: rule.else, hasCondition: false });
  return out;
}

function clauseTag(bi: number | "else"): "IF" | "ELIF" | "ELSE" {
  return bi === "else" ? "ELSE" : bi === 0 ? "IF" : "ELIF";
}

/**
 * A branch condition as the rows of its WHEN block: one row per test, a
 * connector row (AND / OR) between siblings, and a header row ("ANY of" /
 * "ALL of") opening each nested group, whose rows sit one `depth` deeper.
 * Tests are numbered in the same depth-first order as `conditionLeaves`, so
 * each carries the override key the engine reads.
 */
interface CondRow { kind: "test" | "join" | "group"; depth: number; text: string; test?: DerivationCondition; key?: string }
function condRows(cond: unknown, bi: number): CondRow[] {
  const out: CondRow[] = [];
  let leaf = 0;
  const walk = (node: unknown, depth: number, top: boolean): void => {
    if (isConditionGroup(node)) {
      const kids = Array.isArray(node.conditions) ? node.conditions : [];
      let d = depth;
      if (!top) {
        out.push({ kind: "group", depth, text: node.match === "any" ? "ANY of" : "ALL of" });
        d = depth + 1;
      }
      kids.forEach((child, i) => {
        if (i > 0) out.push({ kind: "join", depth: d, text: matchWord(node.match) });
        walk(child, d, false);
      });
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const test = node as DerivationCondition;
    out.push({ kind: "test", depth, text: "", test, key: conditionOverrideKey(bi, leaf++) });
  };
  walk(cond, 0, true);
  return out;
}
</script>

<template>
  <section class="rules">
    <div class="rules__head">
      <span class="rules__label">Rules</span>
      <span class="rules__hint" data-test="rules-spa-hint">
        Click a rule to expand · grey text is the library, type in a field to override it on this node · edit logic in the library
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
          'rule-card--broken': ruleBrokenRefs(rule).length > 0,
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
          <i
            v-if="ruleBrokenRefs(rule).length"
            class="pi pi-exclamation-triangle rule-head__broken"
            :title="`${ruleBrokenRefs(rule).join(', ')} not in the library`"
            :data-test="`rule-broken-${rule.id}`"
          />

          <span
            class="rule-head__summary"
            :title="ruleSummaryText(rule)"
            :data-test="`rule-summary-${rule.id}`"
          >
            <template v-if="rule.branches && rule.branches.length > 0">
              <template v-for="(part, pi) in condParts(rule.branches[0].condition)" :key="pi">
                <span
                  v-if="part.kind === 'var'"
                  :class="['rule-tok-var', varColorClass(part.text)]"
                >${{ part.text }}</span>
                <span
                  v-else-if="part.kind === 'val'"
                  class="rule-tok-val"
                ><RuleValueChips :value="clampPreviewValue(part.text)" :uuid-to-name="uuidToName" :var-producers="varProducers" graph-aware /></span>
                <span v-else-if="part.kind === 'join'" class="rule-tok-join">{{ part.text }}</span>
                <span v-else class="rule-tok-op">{{ part.text }}</span>
              </template>
              <span class="rule-tok-arrow">→</span>
              <template v-for="(a, ai) in acts(rule.branches[0])" :key="ai">
                <span v-if="ai > 0" class="rule-tok-join">AND</span>
                <span
                  v-if="a.target_var"
                  :class="['rule-tok-var', varColorClass(a.target_var)]"
                >${{ a.target_var }}</span>
                <span class="rule-tok-op" :class="{ 'rule-tok-op--neg': isNegativeMode(a.mode) }" :title="modeTitle(a.mode)">{{ modeLabel(a.mode) }}</span>
                <span class="rule-tok-val"><RuleValueChips :value="clampPreviewValue(a.value)" :uuid-to-name="uuidToName" :var-producers="varProducers" graph-aware /></span>
              </template>
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

        <!-- Expanded body — one card per clause (IF / ELIF / ELSE), each a
             WHEN block (one row per test, AND / OR between them, nested
             groups indented) and a THEN block (one row per action). Every
             value is a full-width field: empty shows the library value as a
             ghost, typing overrides it on this node only. -->
        <div
          v-if="isExpanded(rule.id)"
          class="rule-body"
          :data-test="`rule-body-${rule.id}`"
        >
          <div
            v-for="{ bi, clause, hasCondition } in clausesOf(rule)"
            :key="bi"
            class="br"
            :class="{ 'br--off': bi !== 0 && !isBranchEnabled(rule.id, bi) }"
            :data-kind="clauseTag(bi).toLowerCase()"
            :data-test="`branch-row-${rule.id}-${bi}`"
          >
            <div class="br__head">
              <!-- IF gets no toggle: disabling it is the rule toggle. -->
              <span
                v-if="bi !== 0"
                class="branch-toggle"
                :class="{ 'branch-toggle--on': isBranchEnabled(rule.id, bi) }"
                :data-test="`branch-toggle-${rule.id}-${bi}`"
                role="switch"
                :aria-checked="isBranchEnabled(rule.id, bi)"
                :aria-label="`${isBranchEnabled(rule.id, bi) ? 'Disable' : 'Enable'} ${clauseTag(bi)} branch${bi === 'else' ? '' : ' ' + bi}`"
                @click="toggleBranch(rule.id, bi)"
              >
                <i :class="['pi', isBranchEnabled(rule.id, bi) ? 'pi-check' : 'pi-times']" aria-hidden="true" />
              </span>
              <span class="br__tag" :data-kind="clauseTag(bi).toLowerCase()">{{ clauseTag(bi) }}</span>
              <span v-if="bi === 0 && clausesOf(rule).length > 1" class="br__hint">first match wins</span>
              <span v-else-if="bi === 'else'" class="br__hint">when nothing above matched</span>
              <PairBadge
                v-for="p in pairBadgesFor(rule.id, bi)"
                :key="`${p.number}-${p.targetUuid}`"
                :pair="p"
                variant="option"
              />
            </div>

            <div v-if="hasCondition && typeof bi === 'number'" class="br__blk">
              <span class="br__lbl">When</span>
              <div class="br__rows">
                <template v-for="(row, ri) in condRows((clause as DerivationBranch).condition, bi)" :key="ri">
                  <div v-if="row.kind === 'test' && row.test && row.key" class="br__row">
                    <span v-for="g in row.depth" :key="g" class="br__guide" aria-hidden="true" />
                    <span class="br__lhs">
                      <span :class="['rule-tok-var', varColorClass(row.test.var ?? '')]">${{ row.test.var }}</span>
                      <span class="rule-tok-op">{{ opSymbol(row.test.op) }}</span>
                    </span>
                    <!-- condition.value override — `$var` chips, but NO `@{}`
                         machinery: the engine compares condition.value RAW. -->
                    <div
                      v-if="opUsesValue(row.test.op)"
                      class="fld"
                      :class="{ 'fld--mod': getOverride('condition_value_overrides', rule.id, row.key) !== '' }"
                    >
                      <div class="fld__stack">
                        <RichTextInput
                          surface="derivation"
                          wrap
                          :var-suggestions="varSuggestions"
                          :var-producers="varProducers"
                          graph-aware
                          :uuid-to-name="uuidToName"
                          :model-value="getOverride('condition_value_overrides', rule.id, row.key)"
                          :placeholder="row.test.value || ''"
                          class="fld__input"
                          :data-test="`cond-override-${rule.id}-${row.key}`"
                          :aria-label="`Condition value override for rule ${rule.id} branch ${bi}${row.key === String(bi) ? '' : ' test ' + row.key}`"
                          @update:model-value="(v: string) => onCondOverrideInput(rule.id, String(row.key), v)"
                        />
                        <span
                          v-if="getOverride('condition_value_overrides', rule.id, row.key) === ''"
                          class="fld__ghost"
                          aria-hidden="true"
                        ><RuleValueChips :value="row.test.value ?? ''" :uuid-to-name="uuidToName" :var-producers="varProducers" graph-aware /></span>
                      </div>
                      <div
                        v-if="getOverride('condition_value_overrides', rule.id, row.key) !== ''"
                        class="fld__lib"
                      >
                        <span class="fld__lib-label">library</span>
                        <RuleValueChips :value="row.test.value ?? ''" :uuid-to-name="uuidToName" :var-producers="varProducers" graph-aware />
                        <button
                          type="button"
                          class="fld__reset"
                          :data-test="`cond-reset-${rule.id}-${row.key}`"
                          @click="onCondOverrideInput(rule.id, String(row.key), '')"
                        >↺ Use library</button>
                      </div>
                    </div>
                  </div>
                  <div v-else-if="row.kind === 'group'" class="br__row br__row--conn">
                    <span v-for="g in row.depth" :key="g" class="br__guide" aria-hidden="true" />
                    <span class="br__group">{{ row.text }}</span>
                  </div>
                  <div v-else class="br__row br__row--conn">
                    <span v-for="g in row.depth" :key="g" class="br__guide" aria-hidden="true" />
                    <span class="rule-tok-join" :class="{ 'rule-tok-join--or': row.text === 'OR' }">{{ row.text }}</span>
                  </div>
                </template>
              </div>
            </div>

            <div class="br__blk">
              <span class="br__lbl">Then</span>
              <div class="br__rows">
                <template v-for="({ key, action }, ai) in actionOverrides(clause, bi)" :key="key">
                  <div v-if="ai > 0" class="br__row br__row--conn">
                    <span class="rule-tok-join">AND</span>
                  </div>
                  <div class="br__row">
                    <span class="br__lhs">
                      <span
                        v-if="action.target_var"
                        :class="['rule-tok-var', varColorClass(action.target_var)]"
                      >${{ action.target_var }}</span>
                      <span
                        class="rule-tok-op"
                        :class="{ 'rule-tok-op--neg': isNegativeMode(action.mode) }"
                        :title="modeTitle(action.mode)"
                      >{{ modeLabel(action.mode) }}</span>
                    </span>
                    <!-- action.value override — full `@{}` carrier machinery:
                         the engine resolves `@{}` here. -->
                    <div
                      class="fld"
                      :class="{ 'fld--mod': getOverride('action_value_overrides', rule.id, key) !== '' }"
                    >
                      <div class="fld__stack">
                        <RichTextInput
                          surface="derivation"
                          allow-nested-refs
                          wrap
                          :var-suggestions="varSuggestions"
                          :var-producers="varProducers"
                          graph-aware
                          :ref-suggestions="refSuggestions"
                          :uuid-to-name="uuidToName"
                          :uuid-to-sub-categories="uuidToSubCategories"
                          :uuid-to-has-null="uuidToHasNull"
                          :uuid-to-options-count="uuidToOptionsCount"
                          :uuid-to-option-tag-sets="uuidToOptionTagSets"
                          :uuid-to-tag-groups="uuidToTagGroups"
                          :model-value="getOverride('action_value_overrides', rule.id, key)"
                          :placeholder="action.value || ''"
                          class="fld__input"
                          :data-test="`action-override-${rule.id}-${key}`"
                          :aria-label="`${bi === 'else' ? 'ELSE action' : 'Action'} value override for rule ${rule.id}${bi === 'else' ? '' : ' branch ' + bi}${ai === 0 ? '' : ' action ' + key}`"
                          @update:model-value="(v: string) => onActionOverrideInput(rule.id, key, v)"
                        />
                        <span
                          v-if="getOverride('action_value_overrides', rule.id, key) === ''"
                          class="fld__ghost"
                          aria-hidden="true"
                        ><RuleValueChips :value="action.value ?? ''" :uuid-to-name="uuidToName" :var-producers="varProducers" graph-aware /></span>
                      </div>
                      <div v-if="getOverride('action_value_overrides', rule.id, key) !== ''" class="fld__lib">
                        <span class="fld__lib-label">library</span>
                        <RuleValueChips :value="action.value ?? ''" :uuid-to-name="uuidToName" :var-producers="varProducers" graph-aware />
                        <button
                          type="button"
                          class="fld__reset"
                          :data-test="`action-reset-${rule.id}-${key}`"
                          @click="onActionOverrideInput(rule.id, key, '')"
                        >↺ Use library</button>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
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
  /* Long rule lists scroll IN PLACE so identity / runtime / footer stay put.
   * Absolute max-height (NOT flex:1) — same load-bearing trick as the
   * wildcard's .pool__opts — because the modal's overlay parents carry only
   * max-height:100% (no definite height), so a flex-fill child collapses or
   * clips here. The cap = the modal budget (80vh, matching .dvm) MINUS the
   * fixed chrome (header + identity + rules head + runtime/footer dock,
   * measured ≈ 15rem, padded to 20rem so the dock never clips under .dvm's
   * overflow:hidden). list + chrome stays under 80vh, so the modal never
   * scrolls and THIS list owns the only scrollbar. */
  max-height: calc(80vh - 20rem);
  overflow-y: auto;
  /* Keep the scrollbar CLEARLY visible — long rule lists weren't obviously
   * scrollable before, so users thought rules were truncated. Stronger than
   * the app's subtle token default on purpose. */
  scrollbar-width: auto;
  scrollbar-color: rgba(255, 255, 255, 0.38) transparent;
}
.rules__list::-webkit-scrollbar { width: 12px; }
.rules__list::-webkit-scrollbar-track {
  background: var(--wp-bg-deep, var(--wp-bg));
  border-radius: 6px;
}
.rules__list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.38);
  border-radius: 6px;
  border: 2px solid var(--wp-bg-deep, var(--wp-bg));
}
.rules__list::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.55); }

/* Rule card */
.rule-card {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  overflow: hidden;
  /* THE load-bearing fix for "rules clipped, no scrollbar": the cards are
   * flex children of the flex-column .rules__list, so by default they SHRINK
   * to fit its max-height and `overflow:hidden` then clips their branches —
   * the list never overflows, so it never scrolls and no scrollbar appears.
   * Pinning flex-shrink:0 keeps each card at full height; the list then truly
   * overflows its max-height and scrolls (with its scrollbar). */
  flex-shrink: 0;
}
.rule-card--off { opacity: 0.55; }
.rule-card--broken {
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 55%, transparent);
  box-shadow: inset 3px 0 0 var(--wp-danger, #ef4444);
}
.rule-head__broken {
  font-size: 10px;
  color: var(--wp-danger, #ef4444);
}
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
/* A rule head is a PREVIEW, kept to ONE line. Wrapping let a paragraph-length
   action value run to hundreds of lines and push the rest of the modal off
   screen. Truncating keeps the row a clean single line, and `title` (see
   `ruleSummaryText`) gives the full text on hover.

   `display: block`, not flex: `text-overflow: ellipsis` is ignored on a flex
   container, which is why an earlier attempt reached for a gradient mask
   instead — but a mask fades EVERY pixel under it, including the ref chips,
   so the tail of the summary went unreadable rather than merely cut. As an
   inline formatting context the browser draws a real `…` at the clip point
   and leaves everything before it at full opacity. */
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

/* Body — one card per clause */
.rule-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.br {
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-left: 3px solid var(--wp-kind-derivation, #fbbf24);
  border-radius: 4px;
  background: var(--wp-bg);
  padding: 8px 10px;
}
.br[data-kind="elif"] { border-left-color: var(--wp-info, #60a5fa); }
.br[data-kind="else"] {
  border-left-color: var(--wp-warn, var(--wp-status-modified, #f59e0b));
  border-style: dashed;
  border-left-style: solid;
}
.br--off { opacity: 0.5; }
.br__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.br__tag {
  font: 700 9px var(--wp-font-mono);
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 3px;
}
.br__tag[data-kind="if"] {
  color: var(--wp-kind-derivation, #fbbf24);
  background: color-mix(in srgb, var(--wp-kind-derivation, #fbbf24) 18%, transparent);
}
.br__tag[data-kind="elif"] {
  color: var(--wp-info, #60a5fa);
  background: color-mix(in srgb, var(--wp-info, #60a5fa) 18%, transparent);
}
.br__tag[data-kind="else"] {
  color: var(--wp-warn, var(--wp-status-modified, #f59e0b));
  background: color-mix(in srgb, var(--wp-warn, var(--wp-status-modified, #f59e0b)) 18%, transparent);
}
.br__hint {
  font: 400 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
/* WHEN / THEN: a narrow label column, then the rows. */
.br__blk {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 8px;
  margin-top: 6px;
}
.br__lbl {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-text-dim, var(--wp-text3));
  text-align: right;
  padding-top: 8px;
}
.br__rows { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
/* One test or action: its `$var op` on the left, its value field taking the
   rest of the width, so a long value wraps across the whole card. */
.br__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  font: 11px var(--wp-font-mono);
}
.br__row--conn { align-items: center; min-height: 14px; }
.br__lhs {
  flex: 0 0 auto;
  width: 9.5rem;
  max-width: 40%;
  padding-top: 6px;
  overflow-wrap: anywhere;
}
/* One per nesting level: the rule down the left marks the group's rows. */
.br__guide {
  flex: 0 0 auto;
  align-self: stretch;
  width: 10px;
  margin-left: 2px;
  border-left: 2px solid color-mix(in srgb, var(--wp-info, #60a5fa) 45%, transparent);
}
.br__group {
  font: 600 9px var(--wp-font-sans);
  letter-spacing: 0.06em;
  color: var(--wp-info, #60a5fa);
}
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

/* A value field: the RichTextInput, with the library value laid over it as a
 * ghost while the field is empty (chips and all, where a plain placeholder
 * would show raw `@{uuid}`). Both sit in one grid cell, so the field grows to
 * fit whichever is taller and a long library value is never clipped. Once
 * overridden, the field turns accent and the library value moves underneath. */
.fld { flex: 1 1 auto; min-width: 0; }
.fld__stack { display: grid; }
.fld__stack > * { grid-area: 1 / 1; min-width: 0; }
.fld__input :deep(.wp-rt) { height: 100%; font: 11px var(--wp-font-mono); }
.fld__input :deep(.wp-rt__host) { min-height: 100%; padding: 5px 8px; }
.fld__stack :deep(.wp-rt__host--empty)::before { content: none; }
.fld__ghost {
  position: relative;
  z-index: 1;
  align-self: start;
  padding: 6px 9px;
  font: 11px var(--wp-font-mono);
  line-height: 1.6;
  opacity: 0.55;
  pointer-events: none;
  overflow-wrap: anywhere;
}
.fld--mod :deep(.wp-rt) {
  border-color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 7%, var(--wp-bg2));
}
.fld__lib {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
}
.fld__lib-label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.fld__reset {
  margin-left: auto;
  border: 0;
  background: none;
  padding: 0;
  font: 10px var(--wp-font-sans);
  color: var(--wp-accent);
  cursor: pointer;
}
.fld__reset:hover { text-decoration: underline; }

/* Token coloring (re-used from prior list rendering) */
.rule-tok-var { font-weight: 600; }
.rule-tok-op--neg { color: var(--wp-danger, #ef4444); }
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
/* AND / OR between the tests of a grouped branch. */
.rule-tok-join {
  font: 700 9px var(--wp-font-mono);
  letter-spacing: 0.06em;
  color: var(--wp-accent);
  padding: 0 3px;
}
.rule-tok-join--or { color: var(--wp-info, #60a5fa); }
</style>
