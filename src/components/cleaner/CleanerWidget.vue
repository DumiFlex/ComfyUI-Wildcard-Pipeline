<script setup lang="ts">
/**
 * Cleaner widget — pick intensity, toggle individual rules, edit the
 * blocklist. No preset persistence: the 3 built-in intensities live
 * in code; per-node manual toggles + blocklist entries are persisted
 * via the widget JSON.
 *
 * Send-to-negative: the rule list has a second "neg" column (the node's
 * optional `negative` input is cleaned by it), plus a neg-only "drop
 * negative tags also in prompt" row.
 *
 * Tokens: uses canonical `--wp-*` theme variables from
 * src/components/shared/theme.css (and SPA's tokens.css which
 * overrides the same names with the SPA palette).
 */
import { computed } from "vue";
import {
  INTENSITY_TO_NEG_RULES,
  INTENSITY_TO_RULES,
  computeEffectiveNegativeRules,
  computeEffectiveRules,
  isPristine,
} from "./intensity";
import type {
  CleanerNodeConfig,
  Intensity,
  Mode,
  NegativeRunReport,
  RuleId,
  RunReport,
} from "./types";

const props = withDefaults(defineProps<{
  modelValue: CleanerNodeConfig;
  lastRunReport: RunReport | null;
  wordCount: number;
  charCount: number;
  /** Litegraph mode — 0=ALWAYS, 2=NEVER (mute), 4=BYPASS. Drives the
   *  dim overlay so muted/bypassed state matches litegraph's native
   *  title/border dim. */
  nodeMode?: number;
  /** Last run's negative report; null when the run had no negative. */
  negativeReport?: NegativeRunReport | null;
  /** Word count of the cleaned negative; null when there was none. */
  negativeWordCount?: number | null;
}>(), { nodeMode: 0, negativeReport: null, negativeWordCount: null });

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const emit = defineEmits<{
  "update:modelValue": [next: CleanerNodeConfig];
  "open-blocklist": [];
}>();

const ALL_RULES: {
  id: RuleId;
  label: string;
  statKey: string;
  tooltip: string;
  /** Rules that only operate on comma-split tags. When the widget is
   *  in text mode these are visually disabled — clicking is a no-op
   *  and the row dims. */
  tagsOnly?: boolean;
}[] = [
  {
    id: "whitespace",
    label: "whitespace",
    statKey: "fixed",
    tooltip: "Collapse runs of spaces, trim outer whitespace, collapse double commas, drop leading/trailing commas, normalize comma-space.",
  },
  {
    id: "punctuation",
    label: "punctuation",
    statKey: "stripped",
    tooltip: "Drop tags that are only punctuation (e.g. lone '.'). Strip leading/trailing punctuation from each tag (tags mode) or from the whole string (text mode).",
  },
  {
    id: "dedupe_exact",
    label: "tag dedupe",
    statKey: "dropped",
    tooltip: "Drop later occurrences of an identical tag (case-insensitive, leftmost wins). Tags mode only.",
    tagsOnly: true,
  },
  {
    id: "fuzzy_dedupe",
    label: "fuzzy dedupe",
    statKey: "dropped",
    tooltip: "Drop near-duplicate tags via Levenshtein similarity ≥0.9 (e.g. 'pixie cut' / 'pixie cuts'). Tags mode only.",
    tagsOnly: true,
  },
  {
    id: "blocklist",
    label: "blocklist",
    statKey: "dropped",
    tooltip: "Drop tags containing any blocklist entry (word-boundary, case-insensitive). Click the Blocklist… button below to edit entries + switch list/regex mode.",
  },
];

const MODE_TOOLTIPS = {
  tags: "Tags mode: split input on commas. Most rules operate on each tag.",
  text: "Text mode: treat the whole prompt as prose. Tag-only rules (dedupe, fuzzy) no-op.",
};

const INTENSITY_TOOLTIPS = {
  gentle: "Gentle: whitespace cleanup only.",
  balanced: "Balanced: whitespace + punctuation + exact tag dedupe.",
  aggressive: "Aggressive: all rules including fuzzy dedupe.",
};

const INTENSITIES: Intensity[] = ["gentle", "balanced", "aggressive"];

const effective = computed(() => new Set(computeEffectiveRules(props.modelValue)));
const effectiveNeg = computed(() => new Set(computeEffectiveNegativeRules(props.modelValue)));
const pristine = computed(() => isPristine(props.modelValue));

/** Drop any override entry whose value matches the new intensity's
 *  default. Without this pruning, switching balanced → aggressive
 *  leaves stale overrides that contradict the user's intent
 *  (fuzzy_dedupe: true is meaningful under balanced, redundant under
 *  aggressive — and pristine + isOverridden read it as "modified"). */
function pruneStaleOverrides(
  overrides: Partial<Record<RuleId, boolean>>,
  intensity: Intensity,
): Partial<Record<RuleId, boolean>> {
  const defaults = new Set(INTENSITY_TO_RULES[intensity]);
  const hasEntries = props.modelValue.blocklist.entries.length > 0;
  const next: Partial<Record<RuleId, boolean>> = {};
  for (const [rid, on] of Object.entries(overrides) as [RuleId, boolean][]) {
    const baseline = defaults.has(rid) || (rid === "blocklist" && hasEntries);
    if (on !== baseline) next[rid] = on;
  }
  return next;
}

function patch(next: Partial<CleanerNodeConfig>): void {
  emit("update:modelValue", { ...props.modelValue, ...next });
}

/** The config with `negative_rules_override` set to `overrides`, or the key
 *  dropped when nothing diverges (so an untouched column stays absent). */
function withNegOverrides(
  base: CleanerNodeConfig,
  overrides: Partial<Record<RuleId, boolean>>,
): CleanerNodeConfig {
  const next = { ...base };
  if (Object.keys(overrides).length > 0) next.negative_rules_override = overrides;
  else delete next.negative_rules_override;
  return next;
}

/** Neg-column twin of {@link pruneStaleOverrides} (no blocklist baseline). */
function pruneStaleNegOverrides(
  overrides: Partial<Record<RuleId, boolean>>,
  intensity: Intensity,
): Partial<Record<RuleId, boolean>> {
  const defaults = new Set(INTENSITY_TO_NEG_RULES[intensity]);
  const next: Partial<Record<RuleId, boolean>> = {};
  for (const [rid, on] of Object.entries(overrides) as [RuleId, boolean][]) {
    if (on !== defaults.has(rid)) next[rid] = on;
  }
  return next;
}

function setIntensity(intensity: Intensity): void {
  // A preset sets both columns: overrides that now match its default drop.
  const base: CleanerNodeConfig = {
    ...props.modelValue,
    intensity,
    rules_override: pruneStaleOverrides(props.modelValue.rules_override, intensity),
  };
  emit("update:modelValue", withNegOverrides(
    base,
    pruneStaleNegOverrides(props.modelValue.negative_rules_override ?? {}, intensity),
  ));
}
function setMode(mode: Mode): void { patch({ mode }); }

/** Baseline = what the effective state would be if the override entry
 *  for this rule didn't exist. Includes blocklist auto-enable (entries
 *  non-empty). Used by toggleRule + isOverridden so the pip + click
 *  semantics stay honest for rules with multiple "default" sources. */
function ruleBaseline(rid: RuleId): boolean {
  if (INTENSITY_TO_RULES[props.modelValue.intensity].includes(rid)) return true;
  if (rid === "blocklist" && props.modelValue.blocklist.entries.length > 0) {
    return true;
  }
  return false;
}

function isRuleDisabled(rid: RuleId): boolean {
  const meta = ALL_RULES.find((r) => r.id === rid);
  return !!meta?.tagsOnly && props.modelValue.mode === "text";
}

function toggleRule(rid: RuleId): void {
  if (isRuleDisabled(rid)) return;
  const currentlyOn = effective.value.has(rid);
  const overrides = { ...props.modelValue.rules_override };
  const baseline = ruleBaseline(rid);
  const nextOn = !currentlyOn;
  // If the desired state matches baseline, drop the override (no-op
  // entry would pollute pristine). Otherwise persist explicit override.
  if (nextOn === baseline) {
    delete overrides[rid];
  } else {
    overrides[rid] = nextOn;
  }
  patch({ rules_override: overrides });
}

function negBaseline(rid: RuleId): boolean {
  return INTENSITY_TO_NEG_RULES[props.modelValue.intensity].includes(rid);
}

function toggleNegRule(rid: RuleId): void {
  if (isRuleDisabled(rid)) return;
  const nextOn = !effectiveNeg.value.has(rid);
  const overrides = { ...(props.modelValue.negative_rules_override ?? {}) };
  if (nextOn === negBaseline(rid)) delete overrides[rid];
  else overrides[rid] = nextOn;
  emit("update:modelValue", withNegOverrides(props.modelValue, overrides));
}

function isNegOverridden(rid: RuleId): boolean {
  const v = props.modelValue.negative_rules_override?.[rid];
  return v !== undefined && v !== negBaseline(rid);
}

function toggleDropOverlap(): void {
  const next = { ...props.modelValue };
  if (props.modelValue.drop_prompt_overlap) delete next.drop_prompt_overlap;
  else next.drop_prompt_overlap = true;
  emit("update:modelValue", next);
}

function droppedCount(report: RunReport | null | undefined, rids: RuleId[]): number {
  let n = 0;
  for (const rid of rids) {
    const v = (report?.[rid] as Record<string, unknown> | undefined)?.dropped;
    if (Array.isArray(v)) n += v.length;
    else if (typeof v === "number") n += v;
  }
  return n;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "last run" lines, shown once a run cleaned a negative. */
const promptRunLine = computed(() => {
  const parts = [plural(droppedCount(props.lastRunReport, ["dedupe_exact", "fuzzy_dedupe"]), "duplicate")];
  const blocked = droppedCount(props.lastRunReport, ["blocklist"]);
  if (blocked > 0) parts.push(`${blocked} blocklisted`);
  return `prompt: ${parts.join(", ")}`;
});
const negativeRunLine = computed(() => {
  const r = props.negativeReport;
  if (!r) return "";
  const parts = [plural(droppedCount(r, ["dedupe_exact", "fuzzy_dedupe"]), "duplicate")];
  const blocked = droppedCount(r, ["blocklist"]);
  if (blocked > 0) parts[0] += `, ${blocked} blocklisted`;
  const overlap = r.prompt_overlap;
  if (overlap && overlap.tags.length > 0) {
    const quoted = overlap.tags.map((t) => `"${t}"`).join(", ");
    parts.push(
      `${plural(overlap.tags.length, "tag")} also in prompt${overlap.dropped ? " (dropped)" : ""}: ${quoted}`,
    );
  }
  return `negative: ${parts.join(" · ")}`;
});

function ruleStat(rid: RuleId): string {
  const stats = props.lastRunReport?.[rid];
  if (!stats) return "—";
  const meta = ALL_RULES.find((r) => r.id === rid);
  const key = meta?.statKey ?? "";
  const value = (stats as Record<string, unknown>)[key];
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return String(value.length);
  return "—";
}

function isOverridden(rid: RuleId): boolean {
  const overrides = props.modelValue.rules_override;
  if (!(rid in overrides)) return false;
  const overrideValue = overrides[rid];
  if (overrideValue === undefined) return false;
  return overrideValue !== ruleBaseline(rid);
}
</script>

<template>
  <div :class="['wp-cleaner', { 'wp-cleaner--skipped': isSkipped }]">
    <header class="wp-cleaner__head">
      <div class="wp-cleaner__mode" role="tablist">
        <button
          data-test="cleaner-mode-tags"
          :class="['wp-cleaner__mode-btn', { 'is-active': modelValue.mode === 'tags' }]"
          :title="MODE_TOOLTIPS.tags"
          @click="setMode('tags')"
        >tags</button>
        <button
          data-test="cleaner-mode-text"
          :class="['wp-cleaner__mode-btn', { 'is-active': modelValue.mode === 'text' }]"
          :title="MODE_TOOLTIPS.text"
          @click="setMode('text')"
        >text</button>
      </div>
      <span
        class="wp-cleaner__counter"
        :title="`${wordCount} words · ${charCount} characters in the cleaned output`"
      >{{ wordCount }}w · {{ charCount }}c<template v-if="negativeWordCount != null"> · <span
        class="wp-cleaner__counter-neg"
        data-test="cleaner-neg-count"
        :title="`${negativeWordCount} words in the cleaned negative`"
      >negative {{ negativeWordCount }}</span></template></span>
    </header>

    <section class="wp-cleaner__section">
      <div class="wp-cleaner__section-head">
        <span class="wp-cleaner__section-label">INTENSITY</span>
        <span
          :class="['wp-cleaner__badge', { 'is-hidden': pristine }]"
          data-test="cleaner-custom-badge"
          title="One or more rules diverge from the selected intensity's defaults. Click an intensity again to reset."
        >CUSTOM</span>
      </div>
      <div class="wp-cleaner__seg">
        <button
          v-for="lvl in INTENSITIES"
          :key="lvl"
          :data-test="`cleaner-intensity-${lvl}`"
          :class="['wp-cleaner__seg-btn', { 'is-active': modelValue.intensity === lvl }]"
          :title="INTENSITY_TOOLTIPS[lvl]"
          @click="setIntensity(lvl)"
        >{{ lvl }}</button>
      </div>
    </section>

    <section class="wp-cleaner__section">
      <div class="wp-cleaner__rules-head">
        <span class="wp-cleaner__section-label">RULES</span>
        <span class="wp-cleaner__col-label">prompt</span>
        <span class="wp-cleaner__col-label wp-cleaner__col-label--neg">neg</span>
      </div>
      <div class="wp-cleaner__rules">
        <div v-for="rule in ALL_RULES" :key="rule.id" class="wp-cleaner__rule-row">
        <button
          :data-test="`cleaner-rule-${rule.id}`"
          :class="['wp-cleaner__rule', {
            'is-on': effective.has(rule.id) && !isRuleDisabled(rule.id),
            'is-overridden': isOverridden(rule.id) && !isRuleDisabled(rule.id),
            'is-disabled': isRuleDisabled(rule.id),
          }]"
          :title="isRuleDisabled(rule.id) ? `${rule.tooltip} (disabled in text mode)` : rule.tooltip"
          :disabled="isRuleDisabled(rule.id)"
          @click="toggleRule(rule.id)"
        >
          <span class="wp-cleaner__rule-dot" />
          <span class="wp-cleaner__rule-label">
            {{ rule.label }}
            <span
              v-if="isOverridden(rule.id)"
              class="wp-cleaner__rule-pip"
              aria-label="modified"
            />
          </span>
          <span
            v-if="effective.has(rule.id)"
            :data-test="`cleaner-rule-${rule.id}-stat`"
            class="wp-cleaner__rule-stat"
          >{{ ruleStat(rule.id) }}</span>
        </button>
        <button
          :data-test="`cleaner-neg-rule-${rule.id}`"
          :class="['wp-cleaner__neg-toggle', {
            'is-on': effectiveNeg.has(rule.id) && !isRuleDisabled(rule.id),
            'is-overridden': isNegOverridden(rule.id) && !isRuleDisabled(rule.id),
            'is-disabled': isRuleDisabled(rule.id),
          }]"
          :title="`${rule.label} on the negative${isRuleDisabled(rule.id) ? ' (disabled in text mode)' : ''}`"
          :aria-label="`${rule.label} on the negative`"
          :aria-pressed="effectiveNeg.has(rule.id)"
          :disabled="isRuleDisabled(rule.id)"
          @click="toggleNegRule(rule.id)"
        ><span class="wp-cleaner__rule-dot" /></button>
        </div>
        <div class="wp-cleaner__rule-row wp-cleaner__rule-row--overlap">
          <span
            class="wp-cleaner__rule wp-cleaner__rule--static"
            title="Drop negative tags the cleaned prompt also contains (it would be told to draw them and not draw them). Negative only."
          >
            <span class="wp-cleaner__rule-dash" aria-hidden="true">–</span>
            <span class="wp-cleaner__rule-label">drop negative tags also in prompt</span>
          </span>
          <button
            data-test="cleaner-drop-overlap"
            :class="['wp-cleaner__neg-toggle', { 'is-on': !!modelValue.drop_prompt_overlap }]"
            title="Drop negative tags also in the prompt"
            aria-label="drop negative tags also in the prompt"
            :aria-pressed="!!modelValue.drop_prompt_overlap"
            @click="toggleDropOverlap"
          ><span class="wp-cleaner__rule-dot" /></button>
        </div>
      </div>
    </section>

    <div v-if="negativeReport" class="wp-cleaner__lastrun" data-test="cleaner-last-run">
      <span class="wp-cleaner__section-label">LAST RUN</span>
      <span class="wp-cleaner__lastrun-line">{{ promptRunLine }}</span>
      <span class="wp-cleaner__lastrun-line wp-cleaner__lastrun-line--neg" data-test="cleaner-last-run-neg">{{ negativeRunLine }}</span>
    </div>

    <div class="wp-cleaner__blocklist">
      <button
        data-test="cleaner-blocklist-btn"
        :class="['wp-cleaner__blocklist-btn', {
          'has-entries': modelValue.blocklist.entries.length > 0,
        }]"
        title="Edit the blocklist (drops tags containing these entries). Supports plain list mode (comma- or newline-separated) or regex mode (one regex per line)."
        @click="emit('open-blocklist')"
      >
        Blocklist…
        <span class="wp-cleaner__blocklist-meta">
          {{ modelValue.blocklist.entries.length }} entries · {{ modelValue.blocklist.kind }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Tokens (`--wp-*`) resolve from the globally-loaded theme.css `:root`
   (plus the SPA's tokens.css) — deliberately NOT @imported here so the
   cleaner CSS chunk stays out of the bundle-size gate. Every var below
   carries a fallback chain for the cleaner-loaded-first edge case. */

/* Flat layout — sits directly against the litegraph node body like
   WP_ContextLoop, no outer card. Vertical rhythm comes from a flex
   column + gap (matching .wp-loop) instead of per-section padding +
   a bordered header bar. */
.wp-cleaner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  padding: 4px 0;
}
/* Match litegraph's native dim on muted (mode=2) + bypassed (mode=4) —
   parity with WP_Context / WP_Debug / WP_Injector widgets. */
.wp-cleaner--skipped { opacity: 0.45; }

.wp-cleaner__head {
  display: flex; justify-content: space-between; align-items: center;
}
.wp-cleaner__mode { display: flex; gap: 4px; }
.wp-cleaner__mode-btn {
  padding: 4px 10px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text-muted, var(--wp-text2));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  font: 600 10px var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-cleaner__mode-btn:hover { color: var(--wp-text); border-color: var(--wp-border-strong, var(--wp-border2)); }
.wp-cleaner__mode-btn.is-active {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-accent));
}
.wp-cleaner__counter {
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-dim, var(--wp-text3));
  font-variant-numeric: tabular-nums;
}

.wp-cleaner__section { display: flex; flex-direction: column; gap: 4px; }
.wp-cleaner__section-head {
  display: flex; justify-content: space-between; align-items: center;
}
.wp-cleaner__section-label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim, var(--wp-text-muted, var(--wp-text2)));
}

.wp-cleaner__badge {
  font: 600 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  padding: 1px 6px;
  background: var(--wp-amber-bg, var(--wp-warn-bg, rgba(251, 191, 36, 0.16)));
  color: var(--wp-amber, var(--wp-warn));
  border: 1px solid color-mix(in srgb, var(--wp-amber, var(--wp-warn)) 40%, transparent);
  border-radius: var(--wp-radius-sm, 4px);
}
/* Reserve vertical space whether the badge is visible or not so the
 * widget host doesn't trigger an autosize bounce on intensity edits. */
.wp-cleaner__badge.is-hidden {
  visibility: hidden;
}

/* Segmented control rendered as a flat chip row (matching
   .wp-loop__chips) — no wrapping bordered box. Each chip carries its
   own border so the group reads as three buttons against the node
   body rather than a nested panel. */
.wp-cleaner__seg { display: flex; gap: 4px; }
.wp-cleaner__seg-btn {
  flex: 1;
  padding: 4px 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text-muted, var(--wp-text2));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  font: 600 10px var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-cleaner__seg-btn:hover { color: var(--wp-text); border-color: var(--wp-border-strong, var(--wp-border2)); }
.wp-cleaner__seg-btn.is-active {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-accent));
}

.wp-cleaner__rules { display: grid; gap: 2px; }
/* Two columns: the prompt rule button, then the neg-column toggle. */
.wp-cleaner__rules-head,
.wp-cleaner__rule-row {
  display: grid;
  grid-template-columns: 1fr 30px;
  align-items: center;
  gap: 4px;
}
.wp-cleaner__rules-head { grid-template-columns: 1fr auto 30px; }
.wp-cleaner__col-label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim, var(--wp-text3));
  text-align: center;
}
.wp-cleaner__col-label--neg { color: var(--wp-danger, #ef4444); }
.wp-cleaner__neg-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 20px;
  background: transparent;
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}
.wp-cleaner__neg-toggle:hover:not(.is-disabled) { background: var(--wp-row-hover, var(--wp-bg2)); }
.wp-cleaner__neg-toggle.is-on .wp-cleaner__rule-dot { background: var(--wp-danger, #ef4444); }
.wp-cleaner__neg-toggle.is-overridden .wp-cleaner__rule-dot {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-amber, var(--wp-warn, #fbbf24)) 70%, transparent);
}
.wp-cleaner__neg-toggle.is-disabled { opacity: 0.4; cursor: not-allowed; }
.wp-cleaner__rule-row--overlap {
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
  padding-top: 2px;
  margin-top: 2px;
}
.wp-cleaner__rule--static { cursor: default; }
.wp-cleaner__rule-dash {
  width: 8px;
  text-align: center;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-cleaner__counter-neg { color: var(--wp-danger, #ef4444); }
.wp-cleaner__lastrun {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  font: 10px/1.5 var(--wp-font-mono, monospace);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cleaner__lastrun-line { word-break: break-word; }
.wp-cleaner__lastrun-line--neg { color: var(--wp-danger, #ef4444); }
.wp-cleaner__rule {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 0;
  padding: 3px 4px;
  cursor: pointer;
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, var(--wp-text2));
  text-align: left;
  border-radius: 3px;
}
.wp-cleaner__rule:hover:not(.is-disabled) { background: var(--wp-row-hover, var(--wp-bg2)); color: var(--wp-text); }
.wp-cleaner__rule.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wp-cleaner__rule.is-disabled .wp-cleaner__rule-dot { background: var(--wp-border, #444); }
.wp-cleaner__rule-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--wp-border2, var(--wp-border-strong));
  flex: 0 0 auto;
}
.wp-cleaner__rule.is-on { color: var(--wp-text); }
.wp-cleaner__rule.is-on .wp-cleaner__rule-dot { background: var(--wp-accent); }
.wp-cleaner__rule-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wp-cleaner__rule-pip {
  display: inline-block;
  width: 5px;
  height: 5px;
  background: var(--wp-amber, var(--wp-warn, #fbbf24));
  border-radius: 50%;
  flex: 0 0 auto;
}
.wp-cleaner__rule-stat {
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3));
  font-variant-numeric: tabular-nums;
}

/* Full-width dashed affordance — mirrors the Injector "add row"
   button's family (dashed border, accent-tinted hover). No section
   padding wrapper now that the root is a flat flex column. */
.wp-cleaner__blocklist { display: flex; }
.wp-cleaner__blocklist-btn {
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  border: 1px dashed var(--wp-border2, var(--wp-border));
  border-radius: var(--wp-radius-sm, 4px);
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
  font: 600 10px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.02em;
  cursor: pointer;
}
.wp-cleaner__blocklist-btn:hover {
  background: color-mix(in srgb, var(--wp-accent) 8%, transparent);
  color: var(--wp-text);
  border-color: color-mix(in srgb, var(--wp-accent) 45%, var(--wp-border2, var(--wp-border)));
}
.wp-cleaner__blocklist-btn.has-entries {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent-text, var(--wp-accent));
  border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent);
}
.wp-cleaner__blocklist-meta {
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
