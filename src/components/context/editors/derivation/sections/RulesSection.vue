<script setup lang="ts">
/**
 * Derivation RulesSection — per-rule enable toggle + read-only summary.
 *
 * Library-defining edits (rule conditions, branches, actions) live in
 * the SPA. This modal exposes only the per-instance overrides users
 * might want at queue time: which rules to skip via
 * `instance.disabled_rule_ids`. Rule definitions render read-only —
 * the user sees what each rule does (condition, target, branches,
 * else) and can toggle the whole rule off, but can't restructure it
 * here. Same precedence pattern wildcard's PoolSection (toggle
 * options on/off) and fixed_values' ValuesSection use.
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { patchInstance } from "../../instance/patch";
import { varColorClass } from "../../../../shared/var-color";

interface DerivationCondition { var?: string; op?: string; value?: string }
interface DerivationAction { target_var?: string; mode?: string; value?: string }
interface DerivationBranch { condition?: DerivationCondition; action?: DerivationAction }
interface DerivationRule {
  id: string;
  branches?: DerivationBranch[];
  else?: { action?: DerivationAction };
}

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const rules = computed<DerivationRule[]>(() => {
  const p = (props.module.payload ?? {}) as { rules?: DerivationRule[] };
  return Array.isArray(p.rules) ? p.rules : [];
});

const disabledIds = computed<Set<string>>(() => {
  const ids = props.module.instance?.disabled_rule_ids;
  return new Set(Array.isArray(ids) ? ids : []);
});

function isEnabled(rule: DerivationRule): boolean {
  return !disabledIds.value.has(rule.id);
}

function toggleRule(rule: DerivationRule): void {
  const next = new Set(disabledIds.value);
  if (next.has(rule.id)) {
    next.delete(rule.id);
  } else {
    next.add(rule.id);
  }
  // Collapse to null when no rules disabled — same precedence pattern
  // wildcard's enabled_options uses (null = library default).
  const value = next.size === 0 ? null : Array.from(next);
  emit("update", patchInstance(props.module, "disabled_rule_ids", value));
}

/** Pretty-print operator for the summary line. Mirrors the SPA editor's
 *  OP_OPTIONS labels — "not_equals" becomes "!=" so the inline summary
 *  stays single-line on tight layouts. */
function opSymbol(op: string | undefined): string {
  switch (op) {
    case "equals": return "=";
    case "not_equals": return "≠";
    case "contains": return "contains";
    case "matches": return "matches";
    default: return op ?? "";
  }
}

function modeLabel(mode: string | undefined): string {
  if (mode === "append") return "+=";
  if (mode === "prepend") return "=+";
  return "=";
}
</script>

<template>
  <section class="rules">
    <div class="rules__head">
      <span class="rules__label">Rules</span>
      <span class="rules__hint" data-test="rules-spa-hint">
        Toggle rules on/off · edit rule logic in SPA
      </span>
    </div>

    <div v-if="rules.length === 0" class="rules__empty" data-test="rules-empty">
      No rules defined. Open the library entry in SPA to add rules.
    </div>

    <div v-else class="rules__list">
      <div
        v-for="rule in rules"
        :key="rule.id"
        class="rule-row"
        :class="{ 'rule-row--off': !isEnabled(rule) }"
        :data-test="`rule-row-${rule.id}`"
      >
        <button
          type="button"
          class="rule-row__toggle"
          :class="{ 'rule-row__toggle--on': isEnabled(rule) }"
          :data-test="`rule-toggle-${rule.id}`"
          role="switch"
          :aria-checked="isEnabled(rule)"
          :aria-label="isEnabled(rule) ? `Disable rule ${rule.id}` : `Enable rule ${rule.id}`"
          @click="toggleRule(rule)"
        >
          <i :class="['pi', isEnabled(rule) ? 'pi-check' : 'pi-times']" aria-hidden="true" />
        </button>

        <div class="rule-row__summary" :data-test="`rule-summary-${rule.id}`">
          <template v-if="rule.branches && rule.branches.length > 0">
            <span
              v-if="rule.branches[0].condition?.var"
              :class="['rule-tok-var', varColorClass(rule.branches[0].condition.var)]"
            >${{ rule.branches[0].condition.var }}</span>
            <span class="rule-tok-op">{{ opSymbol(rule.branches[0].condition?.op) }}</span>
            <span class="rule-tok-val">{{ rule.branches[0].condition?.value || "?" }}</span>
            <span class="rule-tok-arrow">→</span>
            <span
              v-if="rule.branches[0].action?.target_var"
              :class="['rule-tok-var', varColorClass(rule.branches[0].action.target_var)]"
            >${{ rule.branches[0].action.target_var }}</span>
            <span class="rule-tok-op">{{ modeLabel(rule.branches[0].action?.mode) }}</span>
            <span class="rule-tok-val">{{ rule.branches[0].action?.value || "?" }}</span>

            <span
              v-if="rule.branches.length > 1"
              class="rule-row__chip"
              :data-test="`rule-elif-count-${rule.id}`"
            >+{{ rule.branches.length - 1 }} elif</span>
          </template>
          <span
            v-if="rule.else"
            class="rule-row__chip rule-row__chip--else"
            :data-test="`rule-else-${rule.id}`"
          >else</span>
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
  gap: 4px;
}
.rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.rule-row--off {
  opacity: 0.55;
}
.rule-row--off .rule-row__summary { text-decoration: line-through; }
.rule-row__toggle {
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
.rule-row__toggle--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: white;
}
.rule-row__toggle .pi { font-size: 9px; }
.rule-row__summary {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}
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
.rule-row__chip {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--wp-text-muted, var(--wp-text2));
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  margin-left: 4px;
}
.rule-row__chip--else {
  color: var(--wp-accent);
  border-color: color-mix(in srgb, var(--wp-accent) 35%, transparent);
}
</style>
