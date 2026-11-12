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
import { ruleActions, type RawOptionRow, type RawRuleDetail, type TraceStep, type WarningRow } from "./debug-model";
import { isNegativeMode } from "../../extension/derivation-conditions";
import Button from "@/kit/Button.vue";
import Disclosure from "@/kit/Disclosure.vue";
import CopyButton from "@/kit/CopyButton.vue";
import Chip from "@/kit/Chip.vue";

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
  (e: "focus-node", nodeId: string): void;
}>();

const d = computed(() => props.step.detail);

/** What a node row (not a module) did, as short facts. */
const nodeFacts = computed((): string[] => {
  const s = props.step;
  const det = s.detail;
  if (s.kind === "loop") {
    const out = [s.source || "Context Loop"];
    if (det?.bypass) out.push("loop bypassed: one run");
    if (typeof det?.seed === "number") out.push(`frame seed ${det.seed}`);
    if (typeof det?.combo === "number") out.push(`sweep combination ${det.combo} of ${det.combos ?? "?"}`);
    if (typeof det?.value_line === "number") out.push(`value line ${det.value_line} of ${det.values ?? "?"}`);
    if (det?.strategy) out.push(`seeds: ${det.strategy}`);
    if (typeof det?.skipped === "number") out.push(`${det.skipped} frame${det.skipped === 1 ? "" : "s"} skipped`);
    const pins = Object.keys(det?.pins ?? {}).length;
    if (pins) out.push(`sweep pins ${pins} module${pins === 1 ? "" : "s"}${det?.hold_others ? ", holds the rest" : ""}`);
    return out;
  }
  if (s.kind === "model") {
    const why: Record<string, string> = {
      "from the model": "read from the wired model",
      "file-name rule": "matched a variant rule on the file name",
      pinned: "pinned on the node",
      "wired in": "from the node's text input",
      "loader file": "the checkpoint loader's file name",
    };
    const out = [why[s.source] ?? (s.source || "WP Model Info")];
    if (det?.config_class) out.push(`model class ${det.config_class}`);
    if (det?.rule) out.push(`rule "${det.rule}" → ${det.rule_variant ?? ""}`);
    else if (typeof det?.rules_count === "number") {
      out.push(det.rules_count ? `none of ${det.rules_count} rule${det.rules_count === 1 ? "" : "s"} matched` : "no variant rules");
    }
    if (det?.stem && s.bindings[0] === "model_variant") out.push(`file name ${det.stem}`);
    if (det?.file) out.push(`file ${det.file}`);
    return out;
  }
  if (s.kind === "toggle") {
    const pick = s.source.startsWith("Pick one");
    const out = [pick ? "Pick one: the picked row's value" : "switch: true or false"];
    if (s.source.endsWith("set upstream")) out.push("set by an upstream variable");
    if (!pick && typeof det?.switch === "boolean") out.push(`switch on the node: ${det.switch ? "on" : "off"}`);
    if (det && "upstream_read" in det) {
      out.push(det.upstream_read == null ? "upstream didn't set it" : `upstream read "${det.upstream_read}"`);
    }
    if (det?.needs) out.push(det.held_off ? `off: needs ${det.needs}, which is off` : `needs ${det.needs}`);
    if (pick) {
      out.push(det?.picked ? `picked ${det.picked}` : "nothing picked");
      if (det?.forced_by) out.push(`upstream named "${det.forced_by}"`);
      if (det?.upstream_on?.length) out.push(`upstream turned on ${det.upstream_on.join(", ")}`);
    }
    return out;
  }
  if (s.kind === "injector") {
    const out = [s.isTemplate ? "template filled from the node's inputs" : `wired ${s.valueType || "value"}`];
    if (det?.input) out.push(`from input ${det.input}`);
    return out;
  }
  return [];
});

const chanceText = computed(() => {
  const c = d.value?.chance;
  if (typeof c !== "number") return "";
  if (c >= 0.995) return "certain";
  const pct = c * 100;
  return `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}% odds`;
});

/** The pool after each step, leaving out steps that removed nothing. */
const poolChain = computed((): string[] => {
  const st = d.value?.steps;
  if (!st) return [];
  const out = [`${st.library} option${st.library === 1 ? "" : "s"}`];
  if (st.filter !== st.library) out.push(`${st.filter} after the filter`);
  if (st.toggles !== st.filter) out.push(`${st.toggles} after toggles`);
  out.push(`${st.live} drawable`);
  return out;
});

const CUT_LABEL: Record<string, string> = {
  filter: "filtered out",
  toggle: "toggled off",
  constraint: "excluded by a constraint",
  weight: "weight 0",
};
const pickedIds = computed(() => new Set<string>([d.value?.option_id, ...(d.value?.option_ids ?? [])].filter((x): x is string => typeof x === "string")));
function isPicked(o: RawOptionRow): boolean {
  return typeof o.id === "string" && pickedIds.value.has(o.id);
}
/** Picked first, then drawable, then the ones that are out. */
const optionRows = computed((): RawOptionRow[] => {
  const rows = d.value?.options ?? [];
  const rank = (o: RawOptionRow): number => (isPicked(o) ? 0 : o.cut ? 2 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b));
});
const optionsOpen = ref<boolean | null>(null);
/** Open by default when nothing could be drawn: that's what went wrong. */
const optionsShown = computed(() => optionsOpen.value ?? (d.value?.steps?.live === 0));
function fmtWeight(w: number | null | undefined): string {
  if (w == null) return "—";
  return Number.isInteger(w) ? String(w) : w.toFixed(2).replace(/0+$/, "");
}
function chanceOf(o: RawOptionRow): string {
  const total = (d.value?.options ?? []).reduce((n, r) => n + (r.cut ? 0 : r.weight ?? 0), 0);
  if (o.cut || !o.weight || !total) return "";
  const pct = (o.weight / total) * 100;
  return `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`;
}
const readRows = computed(() => Object.entries(d.value?.reads ?? {}));

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
  if (mode === "negative_replace") return "negative =";
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
        <span v-if="d.fallback" class="wp-dbg-fact wp-dbg-fact--accent" data-test="dbg-fallback">fallback used</span>
        <span v-if="d.mode === 'pinned' && d.swept" class="wp-dbg-fact wp-dbg-fact--accent" data-test="dbg-swept"><i class="pi pi-replay" /> swept: this frame's option</span>
        <span v-else-if="d.mode === 'pinned'" class="wp-dbg-fact wp-dbg-fact--accent"><i class="pi pi-thumbtack" /> pinned option</span>
        <span v-if="d.mode === 'match_variable'" class="wp-dbg-fact wp-dbg-fact--accent" data-test="dbg-match-var">matched <code>${{ d.match_variable }}</code><template v-if="d.match_value != null"> = <code>{{ d.match_value || '""' }}</code></template></span>
        <span v-if="d.mode === 'match_fallback'" class="wp-dbg-fact wp-dbg-fact--accent" data-test="dbg-match-var">no option matched <code>${{ d.match_variable }}</code>, fallback used</span>
        <span v-if="chanceText" class="wp-dbg-fact wp-dbg-fact--accent" data-test="dbg-chance">{{ chanceText }}</span>
        <span v-if="typeof d.pool === 'number'" class="wp-dbg-fact">
          {{ d.pool }} option{{ d.pool === 1 ? "" : "s" }}<template v-if="typeof d.live === 'number' && d.live !== d.pool">, {{ d.live }} drawable</template>
        </span>
        <span v-if="d.option_ids" class="wp-dbg-fact">
          {{ d.option_ids.length }} pick{{ d.option_ids.length === 1 ? "" : "s" }}<template v-if="d.range"> (asked {{ d.range[0] === d.range[1] ? d.range[0] : `${d.range[0]}–${d.range[1]}` }})</template>{{ d.independent ? ", repeats allowed" : ", no repeats" }}
        </span>
        <span v-if="d.option_ids && d.separator != null && d.separator !== ', '" class="wp-dbg-fact" data-test="dbg-separator">joined by <code>"{{ d.separator }}"</code></span>
        <span v-if="d.locked_seed" class="wp-dbg-fact"><i class="pi pi-lock" /> locked seed</span>
        <span v-if="d.filter" class="wp-dbg-fact">filter <code>{{ d.filter }}</code></span>
        <span v-for="(val, name) in d.filter_vars ?? {}" :key="`fv-${name}`" class="wp-dbg-fact" data-test="dbg-filter-var">
          <code>${{ name }}</code> read <code>{{ val || '""' }}</code>
        </span>
        <span v-if="d.exclude_null" class="wp-dbg-fact">no empty option</span>
      </div>
      <div v-if="poolChain.length" class="wp-dbg-detail__chain" data-test="dbg-pool-chain" :class="{ 'is-dead': d.steps?.live === 0 }">
        <template v-for="(p, i) in poolChain" :key="i"><span v-if="i" class="wp-dbg-dim" aria-hidden="true">→</span><span>{{ p }}</span></template>
      </div>
      <Disclosure
        v-if="d.options?.length"
        size="sm"
        lazy
        :open="optionsShown"
        :trigger-attrs="{ 'data-test': 'dbg-options-head' }"
        @update:open="(v: boolean) => (optionsOpen = v)"
      >
        <template #summary>
          <span class="wp-dbg-detail__label">Options ({{ (d.options?.length ?? 0) + (d.options_more ?? 0) }})</span>
        </template>
        <ul class="wp-dbg-opts" data-test="dbg-options">
          <li
            v-for="o in optionRows"
            :key="String(o.id)"
            class="wp-dbg-opt"
            :class="{ 'is-picked': isPicked(o), 'is-out': !!o.cut }"
            data-test="dbg-option"
          >
            <i :class="['pi', isPicked(o) ? 'pi-check-circle' : o.cut ? 'pi-ban' : 'pi-circle']" class="wp-dbg-opt__mark" aria-hidden="true" />
            <span class="wp-dbg-opt__value" :title="o.value">
              <template v-if="o.null"><em class="wp-dbg-dim">empty option</em></template>
              <template v-else>{{ o.value }}</template>
            </span>
            <Chip v-if="o.fallback" size="xs" tone="info">fallback</Chip>
            <Chip v-if="o.cut" size="xs" :tone="o.cut === 'constraint' ? 'warn' : 'default'" data-test="dbg-option-cut">{{ CUT_LABEL[o.cut] }}</Chip>
            <span class="wp-dbg-opt__weight" :title="o.override != null ? `library weight ${fmtWeight(o.base)}, this node sets ${fmtWeight(o.override)}` : 'weight'">
              <template v-if="o.override != null"><s>{{ fmtWeight(o.base) }}</s> {{ fmtWeight(o.override) }}</template>
              <template v-else>{{ fmtWeight(o.base) }}</template>
              <template v-if="!o.cut && o.weight != null && o.weight !== (o.override ?? o.base)"> → {{ fmtWeight(o.weight) }}</template>
            </span>
            <span class="wp-dbg-opt__chance">{{ chanceOf(o) }}</span>
          </li>
          <li v-if="d.options_more" class="wp-dbg-dim">and {{ d.options_more }} more</li>
        </ul>
      </Disclosure>
      <div v-if="step.appliedBy.length" class="wp-dbg-detail__block">
        <div class="wp-dbg-detail__label">Re-weighted by</div>
        <div v-for="(c, i) in step.appliedBy" :key="i" class="wp-dbg-detail__line" data-test="dbg-applied-constraint">
          <Button
            v-if="c.stepKey"
            variant="link"
            size="sm"
            class="wp-dbg-link"
            hint="Show this constraint in the trace"
            @click="emit('goto-step', c.stepKey)"
          ><span class="wp-dbg-kind-dot" />{{ c.name }}</Button>
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
        <Button
          size="sm"
          variant="link"
          data-test="dbg-rules-all"
          @click="setAllRules(!allRulesOpen)"
        >{{ allRulesOpen ? "Fold all" : "Open all" }}</Button>
      </div>
      <div
        v-for="(rule, ri) in d.rules"
        :key="rule.id || ri"
        class="wp-dbg-rule"
        :class="[`is-${ruleOutcome(rule).tone}`, { 'is-folded': !ruleOpen(rule, ri) }]"
        data-test="dbg-rule"
      >
        <Disclosure
          size="sm"
          lazy
          :open="ruleOpen(rule, ri)"
          :trigger-attrs="{ 'data-test': 'dbg-rule-head' }"
          @update:open="toggleRule(rule, ri)"
        >
          <template #summary>
            <span class="wp-dbg-rule__name">Rule {{ ri + 1 }}</span>
            <span class="wp-dbg-rule__outcome" data-test="dbg-rule-outcome">{{ ruleOutcome(rule).text }}</span>
            <span v-if="!ruleOpen(rule, ri) && rule.action" class="wp-dbg-rule__peek">
              <code>${{ rule.action.target }}</code>
              <span :class="{ 'wp-dbg-neg-mode': isNegativeMode(rule.action.mode) }">{{ modeGlyph(rule.action.mode) }}</span>
              {{ actionShown(rule.action) }}
              <span v-if="ruleActions(rule).length > 1" class="wp-dbg-dim">+{{ ruleActions(rule).length - 1 }}</span>
            </span>
          </template>
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
              :class="isNegativeMode(act.mode) ? 'wp-dbg-neg-mode' : 'wp-dbg-dim'"
              data-test="dbg-rule-mode"
            >{{ modeGlyph(act.mode) }}</span>
            <RichTextPreview
              :class="{ 'wp-dbg-neg-text': isNegativeMode(act.mode) }"
              :value="actionShown(act)"
              :uuid-to-name="uuidToName"
              :uuid-to-kind="uuidToKind"
              surface="wildcard"
            />
          </div>
          <div
            v-if="act.mode !== 'replace' && !isNegativeMode(act.mode) && act.result != null"
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
        </Disclosure>
      </div>
    </template>
    <p v-else-if="step.kind === 'derivation' && step.status === 'ok'" class="wp-dbg-dim wp-dbg-detail__note">
      Run the graph again to see which branch fired.
    </p>

    <!-- Fixed values -->
    <template v-if="step.kind === 'fixed' && d">
      <div class="wp-dbg-detail__facts" data-test="dbg-fixed-facts">
        <span class="wp-dbg-fact wp-dbg-fact--accent">{{ d.source === "override" ? "this node's own rows" : "the library's rows" }}</span>
        <span v-if="d.held" class="wp-dbg-fact">held from frame 0</span>
        <span v-if="d.locked_seed" class="wp-dbg-fact"><i class="pi pi-lock" /> locked seed</span>
        <span v-if="d.toggled_off?.length" class="wp-dbg-fact">toggled off: {{ d.toggled_off.map((n) => `$${n}`).join(", ") }}</span>
      </div>
      <div v-if="d.rows?.some((r) => r.raw)" class="wp-dbg-detail__block">
        <div class="wp-dbg-detail__label">Written as</div>
        <div v-for="r in d.rows.filter((x) => x.raw)" :key="r.name" class="wp-dbg-detail__line">
          <code>${{ r.name }}</code><span class="wp-dbg-dim">from</span>
          <RichTextPreview :value="r.raw ?? ''" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="fixed_values" />
        </div>
      </div>
    </template>

    <!-- Templates: combine, Injector rows, Toggles Pick one -->
    <div v-if="d?.template || d?.raw" class="wp-dbg-detail__block" data-test="dbg-template">
      <div class="wp-dbg-detail__label">
        {{ d.template ? (d.template_source === "override" ? "Template (this node's)" : "Template") : "Value as written" }}
      </div>
      <RichTextPreview :value="d.template || d.raw || ''" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
    </div>
    <div v-if="readRows.length" class="wp-dbg-detail__block" data-test="dbg-reads">
      <div class="wp-dbg-detail__label">Read</div>
      <div v-for="[name, val] in readRows" :key="name" class="wp-dbg-detail__line">
        <code>${{ name }}</code>
        <template v-if="val === null"><Chip size="xs" tone="warn">not set</Chip></template>
        <template v-else><span class="wp-dbg-dim">=</span><span class="wp-dbg-read">{{ val || '""' }}</span></template>
      </div>
    </div>

    <!-- Node rows: Context Loop, Model Info, Toggles, Injector -->
    <div v-if="nodeFacts.length" class="wp-dbg-detail__facts" data-test="dbg-node-facts">
      <span v-for="(f, i) in nodeFacts" :key="i" class="wp-dbg-fact" :class="{ 'wp-dbg-fact--accent': i === 0 }">{{ f }}</span>
    </div>

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
      <div v-if="step.appliedTo.length" class="wp-dbg-detail__block" data-test="dbg-constraint-targets">
        <div class="wp-dbg-detail__label">Re-weighted</div>
        <div class="wp-dbg-detail__line">
          <Button
            v-for="t in step.appliedTo"
            :key="t.key"
            variant="link"
            size="sm"
            class="wp-dbg-link"
            hint="Show this step in the trace"
            @click="emit('goto-step', t.key)"
          >{{ t.order }} · {{ t.name }}</Button>
        </div>
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
      <CopyButton
        v-if="step.seed"
        :text="step.seed"
        :label="step.seedLocked ? 'Copy the locked seed' : 'Copy the seed this module rolled with'"
        class="wp-dbg-meta-btn"
      ><i :class="['pi', step.seedLocked ? 'pi-lock' : 'pi-hashtag']" aria-hidden="true" /> {{ step.seed }}</CopyButton>
      <CopyButton
        v-if="step.id"
        :text="step.id"
        label="Copy module id"
        class="wp-dbg-meta-btn"
      ><i class="pi pi-id-card" aria-hidden="true" /> {{ step.id }}</CopyButton>
      <Button
        v-if="canFocus && step.nodeId"
        size="sm"
        variant="outline"
        icon="pi-arrow-up-right"
        data-test="dbg-focus-node"
        hint="Select the node this ran in"
        @click="emit('focus-node', step.nodeId)"
      >Show node</Button>
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
  border-radius: var(--wp-radius-cap, 999px);
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
/* The plain span and the kit link Button share this look. */
.wp-dbg-link, .wp-dbg-link.wp-btn {
  display: inline-flex; align-items: center; gap: 5px; height: auto; min-height: 0; padding: 0;
  font: 600 11px/1.4 var(--wp-font-sans); color: var(--wp-kind-constraint);
}
.wp-dbg-link--static { cursor: default; }
.wp-dbg-link--static:hover { text-decoration: none; }
.wp-dbg-kind-dot { width: 7px; height: 7px; border-radius: min(2px, var(--wp-radius-cap, 999px)); flex: none; background: var(--wp-kind-constraint); }
.wp-dbg-dim code { font-family: var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-detail__note { margin: 0; font-style: italic; }
.wp-dbg-detail__chain { display: flex; flex-wrap: wrap; gap: 5px; font-size: 10.5px; color: var(--wp-text-muted); }
.wp-dbg-detail__chain.is-dead > span:last-child { color: var(--wp-warn); font-weight: 600; }
.wp-dbg-read { font-family: var(--wp-font-mono); color: var(--wp-text); overflow-wrap: anywhere; }
.wp-dbg-opts { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; }
.wp-dbg-opt {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  padding: 2px 4px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-size: 11px;
}
.wp-dbg-opt.is-picked { background: color-mix(in oklab, var(--wp-accent) 12%, transparent); }
.wp-dbg-opt.is-out .wp-dbg-opt__value { color: var(--wp-text-dim); text-decoration: line-through; text-decoration-color: color-mix(in oklab, var(--wp-text-dim) 60%, transparent); }
/* Kit chips at the row's text size. */
.wp-dbg-opt .wp-chip, .wp-dbg-detail__line .wp-chip { height: 16px; min-height: 0; box-sizing: border-box; padding: 0 6px; font: 600 9.5px/1 var(--wp-font-sans); flex: none; }
.wp-dbg-opt__mark { flex: none; font-size: 10px; color: var(--wp-text-dim); }
.wp-dbg-opt.is-picked .wp-dbg-opt__mark { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-opt__value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--wp-font-mono); color: var(--wp-text); }
.wp-dbg-opt__weight { flex: none; font: 500 10px/1 var(--wp-font-mono); color: var(--wp-text-muted); }
.wp-dbg-opt__weight s { color: var(--wp-text-dim); }
.wp-dbg-opt__chance { flex: none; width: 3.5em; text-align: right; font: 600 10px/1 var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
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
.wp-dbg-rule :deep(.wp-disclosure__trigger) { gap: 8px; padding: 0 2px; }
.wp-dbg-rule :deep(.wp-disclosure__content) { display: flex; flex-direction: column; gap: 3px; padding-left: 14px; }
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
.wp-dbg-neg-mode { font: 600 10px/1.5 var(--wp-font-mono); color: var(--wp-red); }
.wp-dbg-neg-text { color: var(--wp-red); }
.wp-dbg-ref {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding-left: calc(var(--wp-dbg-depth, 0) * 14px);
  min-width: 0;
}
.wp-dbg-ref__arrow { color: var(--wp-text-dim); }
.wp-dbg-ref__name { font-family: var(--wp-font-mono); color: var(--wp-kind-wildcard); white-space: nowrap; }
.wp-dbg-detail__error { margin: 0; color: var(--wp-red); font-family: var(--wp-font-mono); word-break: break-word; }
.wp-dbg-detail__warn { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.wp-dbg-detail__warn-label { font-weight: 600; color: var(--wp-warn); }
.wp-dbg-detail__warn.is-error .wp-dbg-detail__warn-label { color: var(--wp-red); }
.wp-dbg-detail__warn.is-info .wp-dbg-detail__warn-label { color: var(--wp-info, var(--wp-accent)); }
.wp-dbg-detail__meta { display: flex; flex-wrap: wrap; gap: 4px; }
.wp-copy-btn.wp-dbg-meta-btn {
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
.wp-dbg-link.wp-btn :deep(.wp-btn__label) { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.wp-dbg-link.wp-btn :deep(.wp-btn__label) { line-height: inherit; }
</style>
