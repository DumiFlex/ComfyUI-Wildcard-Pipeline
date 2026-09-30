<script setup lang="ts">
/**
 * Expanded view of one trace step: what the module decided and why.
 *   wildcard   — option picked, its odds, pool, filter, constraints that
 *                re-weighted it, nested @{} picks
 *   derivation — per rule, which branch fired and each test's result
 *   constraint — source → target, reach, rules, how often it applied
 * plus the step's own warnings and its seed / module id.
 */
import { computed, ref } from "vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import DebugCondition from "./DebugCondition.vue";
import { ruleActions, type RawRuleDetail, type TraceStep, type WarningRow } from "./debug-model";

const props = defineProps<{
  step: TraceStep;
  warnings: WarningRow[];
  uuidToName: Map<string, string>;
  uuidToKind: Map<string, string>;
  /** Whether a Context node id can be focused on the canvas. */
  canFocus: boolean;
}>();
const emit = defineEmits<{
  (e: "goto-step", key: string): void;
  (e: "copy", text: string): void;
  (e: "focus-node", nodeId: string): void;
}>();

const d = computed(() => props.step.detail);

const chanceText = computed(() => {
  const c = d.value?.chance;
  if (typeof c !== "number") return "";
  if (c >= 0.995) return "certain";
  const pct = c * 100;
  return `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}% odds`;
});

function refName(uuid: string | undefined): string {
  if (!uuid) return "";
  return props.uuidToName.get(uuid) ?? uuid.slice(0, 8);
}

function branchLabel(index: number | "else" | null | undefined): string {
  if (index === "else") return "ELSE";
  if (typeof index !== "number") return "";
  return index === 0 ? "IF" : `ELIF ${index}`;
}

/** Rules the user folded or opened; everything else follows the default
 *  (a rule that fired starts open, one that didn't starts folded, and a
 *  lone rule is always open). */
const ruleToggles = ref<Map<number, boolean>>(new Map());
function ruleOpen(rule: RawRuleDetail, ri: number): boolean {
  const set = ruleToggles.value.get(ri);
  if (set !== undefined) return set;
  return (d.value?.rules?.length ?? 0) <= 1 || ruleOutcome(rule).tone === "ok";
}
function toggleRule(rule: RawRuleDetail, ri: number): void {
  const next = new Map(ruleToggles.value);
  next.set(ri, !ruleOpen(rule, ri));
  ruleToggles.value = next;
}
const allRulesOpen = computed(() => (d.value?.rules ?? []).every((r, i) => ruleOpen(r, i)));
function setAllRules(open: boolean): void {
  ruleToggles.value = new Map((d.value?.rules ?? []).map((_, i) => [i, open]));
}

function ruleOutcome(rule: RawRuleDetail): { text: string; tone: "ok" | "off" | "none" } {
  if (rule.disabled) return { text: "off on this node", tone: "off" };
  if (rule.fired === "else") return { text: "ELSE fired", tone: "ok" };
  if (typeof rule.fired === "number") return { text: `${branchLabel(rule.fired)} fired`, tone: "ok" };
  if (rule.else_disabled) return { text: "nothing matched (ELSE off)", tone: "none" };
  return { text: rule.has_else ? "nothing matched" : "nothing matched, no ELSE", tone: "none" };
}

/** Replace shows the value written; append/prepend show the piece added
 *  (a "now" line follows with the joined result). */
function actionShown(a: { mode?: string; value?: string; result?: string | null }): string {
  if (a.mode === "append" || a.mode === "prepend") return a.value ?? "";
  return a.result ?? a.value ?? "";
}

function modeGlyph(mode: string | undefined): string {
  // "Add to negative" writes no value: it files the text as the target's
  // negative, so it reads `$x negative: text`, not an assignment.
  if (mode === "negative") return "negative:";
  if (mode === "append") return "+=";
  if (mode === "prepend") return "=+";
  return "=";
}
</script>

<template>
  <div class="wp-dbg-detail" data-test="dbg-step-detail">
    <!-- Wildcard -->
    <template v-if="step.kind === 'wildcard' && d">
      <div class="wp-dbg-detail__facts">
        <span v-if="d.held" class="wp-dbg-fact">held from frame 0</span>
        <span v-if="d.mode === 'pinned'" class="wp-dbg-fact wp-dbg-fact--accent"><i class="pi pi-thumbtack" /> pinned option</span>
        <span v-if="chanceText" class="wp-dbg-fact wp-dbg-fact--accent" data-test="dbg-chance">{{ chanceText }}</span>
        <span v-if="typeof d.pool === 'number'" class="wp-dbg-fact">
          {{ d.pool }} option{{ d.pool === 1 ? "" : "s" }}<template v-if="typeof d.live === 'number' && d.live !== d.pool">, {{ d.live }} drawable</template>
        </span>
        <span v-if="d.option_ids" class="wp-dbg-fact">
          {{ d.option_ids.length }} pick{{ d.option_ids.length === 1 ? "" : "s" }}<template v-if="d.range"> (asked {{ d.range[0] === d.range[1] ? d.range[0] : `${d.range[0]}–${d.range[1]}` }})</template><template v-if="d.independent">, repeats allowed</template>
        </span>
        <span v-if="d.filter" class="wp-dbg-fact">filter <code>{{ d.filter }}</code></span>
        <span v-if="d.exclude_null" class="wp-dbg-fact">no empty option</span>
      </div>
      <div v-if="step.appliedBy.length" class="wp-dbg-detail__block">
        <div class="wp-dbg-detail__label">Re-weighted by</div>
        <div v-for="(c, i) in step.appliedBy" :key="i" class="wp-dbg-detail__line" data-test="dbg-applied-constraint">
          <button
            v-if="c.stepKey"
            type="button"
            class="wp-dbg-link"
            title="Show this constraint in the trace"
            @click="emit('goto-step', c.stepKey)"
          ><span class="wp-dbg-kind-dot" />{{ c.name }}</button>
          <span v-else class="wp-dbg-link wp-dbg-link--static"><span class="wp-dbg-kind-dot" />{{ c.name }}</span>
          <span class="wp-dbg-dim">because <code>${{ refName(c.source) }}</code> is</span>
          <code>{{ c.sourceValue || '""' }}</code>
        </div>
      </div>
    </template>

    <!-- Derivation -->
    <template v-if="step.kind === 'derivation' && d?.rules">
      <div v-if="d.rules.length > 1" class="wp-dbg-rules__bar">
        <span class="wp-dbg-dim">{{ d.rules.length }} rules, {{ d.rules.filter((r) => ruleOutcome(r).tone === "ok").length }} fired</span>
        <button type="button" class="wp-dbg-linkbtn" data-test="dbg-rules-all" @click="setAllRules(!allRulesOpen)">
          {{ allRulesOpen ? "Fold all" : "Open all" }}
        </button>
      </div>
      <div
        v-for="(rule, ri) in d.rules"
        :key="rule.id || ri"
        class="wp-dbg-rule"
        :class="[`is-${ruleOutcome(rule).tone}`, { 'is-folded': !ruleOpen(rule, ri) }]"
        data-test="dbg-rule"
      >
        <button
          type="button"
          class="wp-dbg-rule__head"
          :aria-expanded="ruleOpen(rule, ri)"
          data-test="dbg-rule-head"
          @click="toggleRule(rule, ri)"
        >
          <i class="pi pi-chevron-right wp-dbg-rule__chev" aria-hidden="true" />
          <span class="wp-dbg-rule__name">Rule {{ ri + 1 }}</span>
          <span class="wp-dbg-rule__outcome" data-test="dbg-rule-outcome">{{ ruleOutcome(rule).text }}</span>
          <span v-if="!ruleOpen(rule, ri) && rule.action" class="wp-dbg-rule__peek">
            <code>${{ rule.action.target }}</code>
            <span :class="{ 'wp-dbg-neg-mode': rule.action.mode === 'negative' }">{{ modeGlyph(rule.action.mode) }}</span>
            {{ actionShown(rule.action) }}
            <span v-if="ruleActions(rule).length > 1" class="wp-dbg-dim">+{{ ruleActions(rule).length - 1 }}</span>
          </span>
        </button>
        <template v-if="ruleOpen(rule, ri)">
          <div
            v-for="b in rule.branches ?? []"
            :key="b.index"
            class="wp-dbg-branch"
            :class="{ 'is-fired': rule.fired === b.index, 'is-off': b.disabled }"
          >
            <span class="wp-dbg-branch__tag">{{ branchLabel(b.index ?? 0) }}</span>
            <div class="wp-dbg-branch__body">
              <span v-if="b.disabled" class="wp-dbg-dim">off on this node</span>
              <DebugCondition v-else-if="b.condition" :cond="b.condition" />
            </div>
          </div>
          <div v-if="rule.fired === 'else'" class="wp-dbg-branch is-fired">
            <span class="wp-dbg-branch__tag">ELSE</span>
            <div class="wp-dbg-branch__body"><span class="wp-dbg-dim">no branch matched</span></div>
          </div>
          <template v-for="(act, ai) in ruleActions(rule)" :key="ai">
          <div class="wp-dbg-rule__action" data-test="dbg-rule-action">
            <span v-if="ai > 0" class="wp-dbg-and" data-test="dbg-rule-and">and</span>
            <code class="wp-dbg-var">${{ act.target }}</code>
            <span
              :class="act.mode === 'negative' ? 'wp-dbg-neg-mode' : 'wp-dbg-dim'"
              data-test="dbg-rule-mode"
            >{{ modeGlyph(act.mode) }}</span>
            <RichTextPreview
              :class="{ 'wp-dbg-neg-text': act.mode === 'negative' }"
              :value="actionShown(act)"
              :uuid-to-name="uuidToName"
              :uuid-to-kind="uuidToKind"
              surface="wildcard"
            />
          </div>
          <div
            v-if="act.mode !== 'replace' && act.mode !== 'negative' && act.result != null"
            class="wp-dbg-rule__result"
            data-test="dbg-rule-result"
          >
            <span class="wp-dbg-dim">now</span>
            <code class="wp-dbg-var">${{ act.target }}</code>
            <span class="wp-dbg-dim">=</span>
            <RichTextPreview
              :value="act.result"
              :uuid-to-name="uuidToName"
              :uuid-to-kind="uuidToKind"
              surface="wildcard"
            />
          </div>
          </template>
        </template>
      </div>
    </template>
    <p v-else-if="step.kind === 'derivation' && step.status === 'ok'" class="wp-dbg-dim wp-dbg-detail__note">
      Run the graph again to see which branch fired.
    </p>

    <!-- Constraint -->
    <template v-if="step.constraint">
      <div class="wp-dbg-detail__facts">
        <span class="wp-dbg-fact">reaches {{ step.constraint.reach }}</span>
        <span v-if="step.constraint.hits !== null" class="wp-dbg-fact" :class="{ 'wp-dbg-fact--warn': step.constraint.hits === 0 }" data-test="dbg-constraint-hits">
          <template v-if="step.constraint.hits === 0">applied to nothing</template>
          <template v-else>applied {{ step.constraint.hits }}×</template>
        </span>
        <span v-if="step.constraint.cells !== null" class="wp-dbg-fact">
          {{ step.constraint.cells }} matrix rule{{ step.constraint.cells === 1 ? "" : "s" }},
          {{ step.constraint.exceptions }} exception{{ step.constraint.exceptions === 1 ? "" : "s" }}
        </span>
        <span v-if="step.constraint.only" class="wp-dbg-fact wp-dbg-fact--accent" title="An Only rule turns its row into an allow-list">uses Only</span>
      </div>
    </template>

    <!-- Nested refs -->
    <div v-if="step.refs.length" class="wp-dbg-detail__block">
      <div class="wp-dbg-detail__label">Nested picks</div>
      <div
        v-for="(r, i) in step.refs"
        :key="i"
        class="wp-dbg-ref"
        :style="{ '--wp-dbg-depth': r.depth }"
        data-test="dbg-ref"
      >
        <span class="wp-dbg-ref__arrow" aria-hidden="true">↳</span>
        <code class="wp-dbg-ref__name">@{{ uuidToName.get(r.uuid) ?? r.name }}</code>
        <RichTextPreview
          v-if="r.value"
          :value="r.value"
          :uuid-to-name="uuidToName"
          :uuid-to-kind="uuidToKind"
          surface="wildcard"
        />
        <span v-else class="wp-dbg-dim">empty</span>
      </div>
    </div>

    <p v-if="step.error" class="wp-dbg-detail__error">{{ step.error }}</p>

    <div v-if="warnings.length" class="wp-dbg-detail__block">
      <div class="wp-dbg-detail__label">Warnings</div>
      <div v-for="w in warnings" :key="w.key" class="wp-dbg-detail__warn" :class="`is-${w.severity}`">
        <span class="wp-dbg-detail__warn-label">{{ w.label }}</span>
        <RichTextPreview
          v-if="w.message"
          :value="w.message"
          :uuid-to-name="uuidToName"
          :uuid-to-kind="uuidToKind"
          surface="wildcard"
        />
      </div>
    </div>

    <div class="wp-dbg-detail__meta">
      <button
        v-if="step.seed"
        type="button"
        class="wp-dbg-meta-btn"
        :title="step.seedLocked ? 'Locked seed. Click to copy.' : 'Seed this module rolled with. Click to copy.'"
        @click="emit('copy', step.seed)"
      ><i :class="['pi', step.seedLocked ? 'pi-lock' : 'pi-hashtag']" /> {{ step.seed }}</button>
      <button
        v-if="step.id"
        type="button"
        class="wp-dbg-meta-btn"
        title="Copy module id"
        @click="emit('copy', step.id)"
      ><i class="pi pi-id-card" /> {{ step.id }}</button>
      <button
        v-if="canFocus && step.nodeId"
        type="button"
        class="wp-dbg-meta-btn"
        data-test="dbg-focus-node"
        title="Select the node this ran in"
        @click="emit('focus-node', step.nodeId)"
      ><i class="pi pi-arrow-up-right" /> show node</button>
    </div>
  </div>
</template>

<style scoped>
.wp-dbg-detail {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 6px 8px 8px 30px;
  font-size: 11px;
  color: var(--wp-text-muted);
}
.wp-dbg-detail__facts { display: flex; flex-wrap: wrap; gap: 4px; }
.wp-dbg-fact {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--wp-bg-2, var(--wp-bg2));
  color: var(--wp-text-muted);
  font-size: 10px;
}
.wp-dbg-fact code { font-family: var(--wp-font-mono); color: var(--wp-text); }
.wp-dbg-fact .pi { font-size: 9px; }
.wp-dbg-fact--accent { color: var(--wp-accent-text, var(--wp-accent)); background: color-mix(in oklab, var(--wp-accent) 14%, transparent); }
.wp-dbg-fact--warn { color: var(--wp-warn); background: color-mix(in oklab, var(--wp-warn) 14%, transparent); }
.wp-dbg-detail__block { display: flex; flex-direction: column; gap: 3px; }
.wp-dbg-detail__label {
  font: 600 9px/1.4 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim);
}
.wp-dbg-detail__line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; }
.wp-dbg-detail__line code, .wp-dbg-var { font-family: var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-dim { color: var(--wp-text-dim); }
.wp-dbg-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 0;
  padding: 0;
  font: 600 11px/1.4 var(--wp-font-sans);
  color: var(--wp-kind-constraint);
  cursor: pointer;
}
.wp-dbg-link:hover { text-decoration: underline; }
.wp-dbg-link--static { cursor: default; }
.wp-dbg-link--static:hover { text-decoration: none; }
.wp-dbg-kind-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; background: var(--wp-kind-constraint); }
.wp-dbg-dim code { font-family: var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-detail__note { margin: 0; font-style: italic; }
.wp-dbg-rule {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 4px);
  padding: 5px 7px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.wp-dbg-rules__bar { display: flex; align-items: center; justify-content: space-between; font-size: 10px; }
.wp-dbg-linkbtn {
  all: unset;
  cursor: pointer;
  font-size: 10px;
  color: var(--wp-accent-text, var(--wp-accent));
}
.wp-dbg-linkbtn:hover { text-decoration: underline; }
.wp-dbg-linkbtn:focus-visible { outline: 1px solid var(--wp-accent); outline-offset: 1px; }
.wp-dbg-rule__head {
  all: unset;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
}
.wp-dbg-rule__head:focus-visible { outline: 1px solid var(--wp-accent); outline-offset: 2px; }
.wp-dbg-rule__chev { font-size: 7px; color: var(--wp-text-dim); transition: transform var(--wp-motion-quick, 0.12s) ease; }
.wp-dbg-rule:not(.is-folded) .wp-dbg-rule__chev { transform: rotate(90deg); }
.wp-dbg-rule__result { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; color: var(--wp-text-muted); }
.wp-dbg-rule__peek {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font: 400 10.5px/1.4 var(--wp-font-mono);
  color: var(--wp-text-muted);
}
.wp-dbg-rule__peek code { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-rule__name { font: 600 10px/1.4 var(--wp-font-sans); color: var(--wp-text); }
.wp-dbg-rule__outcome { font-size: 10px; color: var(--wp-text-dim); flex: none; }
.wp-dbg-rule.is-ok .wp-dbg-rule__outcome { color: var(--wp-green); }
.wp-dbg-rule.is-off { opacity: 0.55; }
.wp-dbg-branch { display: flex; gap: 8px; align-items: flex-start; padding: 1px 0; opacity: 0.8; }
.wp-dbg-branch.is-fired { opacity: 1; }
.wp-dbg-branch.is-off { opacity: 0.5; }
.wp-dbg-branch__tag {
  flex: none;
  min-width: 42px;
  font: 600 9px/1.9 var(--wp-font-mono);
  color: var(--wp-text-dim);
}
.wp-dbg-branch.is-fired .wp-dbg-branch__tag { color: var(--wp-kind-derivation); }
.wp-dbg-branch__body { min-width: 0; flex: 1; }
.wp-dbg-rule__action {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed var(--wp-border);
  color: var(--wp-text);
}
/* A later action of the same clause (THEN ... AND ...). */
.wp-dbg-and { font: 600 9px/1.5 var(--wp-font-sans); text-transform: uppercase; color: var(--wp-kind-derivation); }
.wp-dbg-neg-mode { font: 600 10px/1.5 var(--wp-font-mono); color: var(--wp-red, #e5484d); }
.wp-dbg-neg-text { color: var(--wp-red, #e5484d); }
.wp-dbg-ref {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding-left: calc(var(--wp-dbg-depth, 0) * 14px);
  min-width: 0;
}
.wp-dbg-ref__arrow { color: var(--wp-text-dim); }
.wp-dbg-ref__name { font-family: var(--wp-font-mono); color: var(--wp-kind-wildcard); white-space: nowrap; }
.wp-dbg-detail__error { margin: 0; color: var(--wp-red, #e5484d); font-family: var(--wp-font-mono); word-break: break-word; }
.wp-dbg-detail__warn { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.wp-dbg-detail__warn-label { font-weight: 600; color: var(--wp-warn); }
.wp-dbg-detail__warn.is-error .wp-dbg-detail__warn-label { color: var(--wp-red, #e5484d); }
.wp-dbg-detail__warn.is-info .wp-dbg-detail__warn-label { color: var(--wp-info, var(--wp-accent)); }
.wp-dbg-detail__meta { display: flex; flex-wrap: wrap; gap: 4px; }
.wp-dbg-meta-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 3px);
  color: var(--wp-text-dim);
  font: 500 10px/1.6 var(--wp-font-mono);
  padding: 0 6px;
  cursor: pointer;
}
.wp-dbg-meta-btn:hover { color: var(--wp-text); border-color: var(--wp-border-strong, var(--wp-border)); }
.wp-dbg-meta-btn .pi { font-size: 9px; }
</style>
