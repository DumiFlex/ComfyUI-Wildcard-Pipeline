<script setup lang="ts">
import { computed, ref } from "vue";
import Card from "./ui/Card.vue";
import Button from "./ui/Button.vue";
import Input from "./ui/Input.vue";
import Select from "./ui/Select.vue";
import Chip from "./ui/Chip.vue";
import RichTextInput from "./RichTextInput.vue";
import type {
  DerivationAction,
  DerivationBranch,
  DerivationElse,
  DerivationMode,
  DerivationOp,
  DerivationRule,
} from "../api/types";

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

const OP_OPTIONS: Array<{ label: string; value: DerivationOp }> = [
  { label: "equals", value: "equals" },
  { label: "not equals", value: "not_equals" },
  { label: "contains", value: "contains" },
  { label: "matches (regex)", value: "matches" },
];

const MODE_OPTIONS: Array<{ label: string; value: DerivationMode }> = [
  { label: "Replace", value: "replace" },
  { label: "Append", value: "append" },
  { label: "Prepend", value: "prepend" },
];

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

        <!-- Condition row -->
        <div class="row">
          <span class="row-label">When</span>
          <div class="row-fields">
            <Input
              :model-value="branch.condition.var"
              placeholder="$variable"
              class="field-var"
              :aria-label="`Condition variable for rule ${ruleNumber} branch ${bi + 1}`"
              @update:model-value="(v) => onConditionVar(bi, String(v ?? ''))"
            />
            <Select
              :model-value="branch.condition.op"
              :options="OP_OPTIONS"
              class="field-op"
              :aria-label="`Condition operator for rule ${ruleNumber} branch ${bi + 1}`"
              @update:model-value="(v) => onConditionOp(bi, v as DerivationOp)"
            />
            <!-- RichTextInput so users get $-autocomplete on condition
                 values (e.g. compare against `$mood` resolved upstream).
                 surface=derivation gates @{} refs to muted styling — they
                 don't resolve in derivation conditions per spec §2.7. -->
            <RichTextInput
              :model-value="branch.condition.value"
              surface="derivation"
              :var-suggestions="varSuggestions"
              :uuid-to-name="uuidToName"
              placeholder="value"
              class="field-value"
              :aria-label="`Condition value for rule ${ruleNumber} branch ${bi + 1}`"
              @update:model-value="(v) => onConditionValue(bi, v)"
            />
          </div>
        </div>

        <!-- Action row -->
        <div class="row">
          <span class="row-label">Then</span>
          <div class="row-fields">
            <Input
              :model-value="branch.action.target_var"
              placeholder="target_var"
              class="field-var"
              :aria-label="`Action target variable for rule ${ruleNumber} branch ${bi + 1}`"
              @update:model-value="(v) => onActionTarget(bi, String(v ?? ''))"
            />
            <Select
              :model-value="branch.action.mode"
              :options="MODE_OPTIONS"
              class="field-op"
              :aria-label="`Action mode for rule ${ruleNumber} branch ${bi + 1}`"
              @update:model-value="(v) => onActionMode(bi, v as DerivationMode)"
            />
          </div>
        </div>
        <div class="row">
          <span class="row-label">Value</span>
          <RichTextInput
            :model-value="branch.action.value"
            surface="derivation"
            :var-suggestions="varSuggestions"
            class="field-value-full"
            placeholder="The new / appended / prepended value"
            :aria-label="`Action value for rule ${ruleNumber} branch ${bi + 1}`"
            @update:model-value="(v) => onActionValue(bi, v)"
          />
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
        <div class="row">
          <span class="row-label">Then</span>
          <div class="row-fields">
            <Input
              :model-value="rule.else.action.target_var"
              placeholder="target_var"
              class="field-var"
              :aria-label="`ELSE action target variable for rule ${ruleNumber}`"
              @update:model-value="(v) => onElseTarget(String(v ?? ''))"
            />
            <Select
              :model-value="rule.else.action.mode"
              :options="MODE_OPTIONS"
              class="field-op"
              :aria-label="`ELSE action mode for rule ${ruleNumber}`"
              @update:model-value="(v) => onElseMode(v as DerivationMode)"
            />
          </div>
        </div>
        <div class="row">
          <span class="row-label">Value</span>
          <RichTextInput
            :model-value="rule.else.action.value"
            surface="derivation"
            :var-suggestions="varSuggestions"
            class="field-value-full"
            placeholder="The new / appended / prepended value"
            :aria-label="`ELSE action value for rule ${ruleNumber}`"
            @update:model-value="(v) => onElseValue(v)"
          />
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
  gap: 8px;
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
.rule-head[aria-expanded="true"] { margin-bottom: 10px; }
.rule-head__chev {
  font-size: 11px;
  color: var(--wp-text-muted);
  width: 12px;
  text-align: center;
  transition: transform 0.15s ease;
}
.rule-meta {
  font-size: 11.5px;
  color: var(--wp-text-muted, #9ca3af);
}
.spacer { flex: 1; }

.branches {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-left: 10px;
  border-left: 2px solid color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 30%, transparent);
}

.branch {
  background: var(--wp-bg-2, #18181b);
  border: 1px solid var(--wp-border, #2c2c34);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.branch--else {
  border-style: dashed;
}

.branch-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.branch-tag {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border-radius: 4px;
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

.row {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 8px;
  align-items: start;
}
.row-label {
  font-size: 11px;
  color: var(--wp-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 500;
  padding-top: 6px;
}
.row-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.field-var { min-width: 160px; flex: 1 1 160px; }
.field-op { min-width: 150px; }
.field-value { flex: 1 1 200px; min-width: 200px; }
.field-value-full { width: 100%; }

.addbar {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-left: 12px;
}
</style>
