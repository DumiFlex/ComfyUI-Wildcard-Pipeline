<script setup lang="ts">
/**
 * A branch's condition as an editable AND / OR tree.
 *
 * A branch condition is one test or a group (`{match, conditions}`); this
 * component always shows it as a group so adding a second test is one click.
 * The group's connector (AND = `all`, OR = `any`) sits between its members and
 * toggles for the whole group, so a group never mixes the two: mixing needs a
 * nested group, which renders boxed and recursively (up to
 * MAX_EDITOR_GROUP_DEPTH levels).
 *
 * At the root, a group of one member is emitted as that member, so a branch
 * that only ever had one test keeps the plain shape (and the v2 schema stamp).
 * A nested group that loses its last member asks its parent to drop it.
 */
import { computed } from "vue";
import Button from "./ui/Button.vue";
import DerivationConditionTest from "./DerivationConditionTest.vue";
import type { VarProducerLike } from "./RefChip.vue";
import type {
  DerivationCondition,
  DerivationConditionGroup,
  DerivationConditionNode,
} from "../api/types";
import {
  MAX_EDITOR_GROUP_DEPTH,
  isConditionGroup,
  matchWord,
} from "../../extension/derivation-conditions";

defineOptions({ name: "DerivationConditionEditor" });

const props = withDefaults(defineProps<{
  modelValue: DerivationConditionNode;
  /** 0 for the branch's own condition; +1 per nested group. */
  depth?: number;
  /** `data-test` suffix of the branch (`${ruleIndex}-${branchIndex}`). */
  testBase: string;
  /** Position of this group inside the branch tree ("" at the root). */
  path?: string;
  /** Human name for aria labels, e.g. "rule 1 branch 2". */
  a11yName: string;
  varSuggestions?: string[];
  varProducers?: Map<string, VarProducerLike>;
  uuidToName?: Map<string, string>;
}>(), {
  depth: 0,
  path: "",
  varSuggestions: () => [],
  varProducers: () => new Map(),
  uuidToName: () => new Map(),
});

const emit = defineEmits<{
  "update:modelValue": [value: DerivationConditionNode];
  /** A nested group emptied itself; the parent removes it. */
  remove: [];
}>();

const group = computed<DerivationConditionGroup>(() =>
  isConditionGroup(props.modelValue)
    ? (props.modelValue as DerivationConditionGroup)
    : { match: "all", conditions: [props.modelValue] },
);

const canNest = computed(() => props.depth + 1 < MAX_EDITOR_GROUP_DEPTH);

function blankTest(): DerivationCondition {
  return { var: "", op: "equals", value: "" };
}

function emitGroup(next: DerivationConditionGroup): void {
  if (props.depth === 0) {
    emit("update:modelValue", next.conditions.length === 1 ? next.conditions[0] : next);
    return;
  }
  if (next.conditions.length === 0) {
    emit("remove");
    return;
  }
  emit("update:modelValue", next);
}

function setChild(i: number, node: DerivationConditionNode): void {
  emitGroup({ ...group.value, conditions: group.value.conditions.map((c, j) => (j === i ? node : c)) });
}
function removeChild(i: number): void {
  emitGroup({ ...group.value, conditions: group.value.conditions.filter((_, j) => j !== i) });
}
function addTest(): void {
  emitGroup({ ...group.value, conditions: [...group.value.conditions, blankTest()] });
}
/** A new group starts with two tests and the OPPOSITE connector — the only
 *  reason to nest is to mix AND with OR. */
function addGroup(): void {
  const inner: DerivationConditionGroup = {
    match: group.value.match === "any" ? "all" : "any",
    conditions: [blankTest(), blankTest()],
  };
  emitGroup({ ...group.value, conditions: [...group.value.conditions, inner] });
}
function toggleMatch(): void {
  emitGroup({ ...group.value, match: group.value.match === "any" ? "all" : "any" });
}

function childPath(i: number): string {
  return props.path ? `${props.path}.${i}` : String(i);
}
/** The root's first test keeps the branch's own ids (`cond-var-0-1`), so a
 *  single-test branch reads exactly as before; every other test appends its
 *  position in the tree. */
function childTestId(i: number): string {
  return props.path === "" && i === 0 ? props.testBase : `${props.testBase}-${childPath(i)}`;
}
function childAria(i: number): string {
  return props.path === "" && i === 0 ? props.a11yName : `${props.a11yName} test ${childPath(i)}`;
}

const matchTitle = computed(() =>
  group.value.match === "any"
    ? "OR: the branch fires when ANY of these tests match. Click for AND."
    : "AND: the branch fires only when ALL of these tests match. Click for OR.",
);

/** A member can go unless it is the root's only one. */
const canRemove = computed(() => props.depth > 0 || group.value.conditions.length > 1);
</script>

<template>
  <div
    class="dvc-group"
    :class="{ 'dvc-group--nested': depth > 0 }"
    :data-match="group.match"
    :data-test="`cond-group-${testBase}${path ? '-' + path : ''}`"
  >
    <div v-if="depth > 0" class="dvc-group__head">
      <span class="dvc-group__caption">{{ group.match === "any" ? "any of" : "all of" }}</span>
      <span class="dvc-spacer" />
      <Button
        icon="pi-times"
        variant="ghost"
        size="sm"
        :aria-label="`Remove condition group ${path} from ${a11yName}`"
        :data-test="`cond-remove-group-${testBase}-${path}`"
        @click="emit('remove')"
      />
    </div>

    <template v-for="(child, i) in group.conditions" :key="i">
      <div
        v-if="i > 0 && isConditionGroup(child)"
        class="dvc-join"
      >
        <button
          type="button"
          class="dvc-match"
          :data-match="group.match"
          :title="matchTitle"
          :data-test="`cond-match-${childTestId(i)}`"
          @click="toggleMatch"
        >{{ matchWord(group.match) }}</button>
      </div>

      <DerivationConditionEditor
        v-if="isConditionGroup(child)"
        :model-value="child as DerivationConditionGroup"
        :depth="depth + 1"
        :test-base="testBase"
        :path="childPath(i)"
        :a11y-name="a11yName"
        :var-suggestions="varSuggestions"
        :var-producers="varProducers"
        :uuid-to-name="uuidToName"
        @update:model-value="(v) => setChild(i, v)"
        @remove="removeChild(i)"
      />
      <DerivationConditionTest
        v-else
        :model-value="child as DerivationCondition"
        :lead="i === 0 && depth === 0 ? 'When' : ''"
        :test-id="childTestId(i)"
        :a11y-name="childAria(i)"
        :var-suggestions="varSuggestions"
        :var-producers="varProducers"
        :uuid-to-name="uuidToName"
        @update:model-value="(v) => setChild(i, v)"
      >
        <template v-if="i > 0" #lead>
          <button
            type="button"
            class="dvc-match"
            :data-match="group.match"
            :title="matchTitle"
            :data-test="`cond-match-${childTestId(i)}`"
            @click="toggleMatch"
          >{{ matchWord(group.match) }}</button>
        </template>
        <template v-if="canRemove" #actions>
          <Button
            icon="pi-times"
            variant="ghost"
            size="sm"
            :aria-label="`Remove condition from ${childAria(i)}`"
            :data-test="`cond-remove-${childTestId(i)}`"
            @click="removeChild(i)"
          />
        </template>
      </DerivationConditionTest>
    </template>

    <div class="dvc-add">
      <Button
        icon="pi-plus"
        variant="ghost"
        size="sm"
        :aria-label="`Add a condition to ${a11yName}${path ? ' group ' + path : ''}`"
        :data-test="`cond-add-${testBase}${path ? '-' + path : ''}`"
        @click="addTest"
      >Condition</Button>
      <Button
        v-if="canNest"
        icon="pi-plus"
        variant="ghost"
        size="sm"
        :aria-label="`Add a condition group to ${a11yName}${path ? ' group ' + path : ''}`"
        :data-test="`cond-add-group-${testBase}${path ? '-' + path : ''}`"
        @click="addGroup"
      >Group</Button>
    </div>
  </div>
</template>

<style scoped>
.dvc-group {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}
.dvc-group--nested {
  margin-left: 68px; /* audit-exempt: 60px label col + 8px gap, aligns with the inputs */
  padding: var(--wp-space-3) var(--wp-space-4);
  border: 1px dashed color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 35%, transparent);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 4%, transparent);
}
.dvc-group__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.dvc-group__caption {
  font-size: 10px; /* audit-exempt: micro caption, matches .dvr-label */
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wp-text-muted);
}
.dvc-spacer { flex: 1; }
.dvc-join {
  display: grid;
  grid-template-columns: 60px 1fr;
  justify-items: end;
}
/* AND / OR connector. Clicking flips the whole group, so every connector in a
   group always reads the same. */
.dvc-match {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10px; /* audit-exempt: micro connector pill, matches branch tags */
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 7px; /* audit-exempt: compact pill */
  border-radius: var(--wp-radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  background: color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 20%, transparent);
  color: var(--wp-kind-derivation, #fbbf24);
}
.dvc-match[data-match="any"] {
  background: color-mix(in oklab, var(--wp-info, #60a5fa) 20%, transparent);
  color: var(--wp-info, #60a5fa);
}
.dvc-match:hover { border-color: currentColor; }
.dvc-match:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.dvc-add {
  display: flex;
  gap: var(--wp-space-2);
  margin-left: 68px; /* audit-exempt: aligns under the input column */
}
</style>
