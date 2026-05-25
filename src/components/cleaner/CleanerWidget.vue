<script setup lang="ts">
/**
 * Cleaner widget — pick intensity, toggle individual rules, edit the
 * blocklist. No preset persistence: the 3 built-in intensities live
 * in code; per-node manual toggles + blocklist entries are persisted
 * via the widget JSON.
 *
 * Tokens: uses canonical `--wp-*` theme variables from
 * src/components/shared/theme.css (and SPA's tokens.css which
 * overrides the same names with the SPA palette).
 */
import { computed } from "vue";
import { INTENSITY_TO_RULES, computeEffectiveRules, isPristine } from "./intensity";
import type {
  CleanerNodeConfig,
  Intensity,
  Mode,
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
}>(), { nodeMode: 0 });

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const emit = defineEmits<{
  "update:modelValue": [next: CleanerNodeConfig];
  "open-blocklist": [];
}>();

const ALL_RULES: { id: RuleId; label: string; statKey: string; tooltip: string }[] = [
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
  },
  {
    id: "fuzzy_dedupe",
    label: "fuzzy dedupe",
    statKey: "dropped",
    tooltip: "Drop near-duplicate tags via Levenshtein similarity ≥0.9 (e.g. 'pixie cut' / 'pixie cuts'). Tags mode only.",
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

function setIntensity(intensity: Intensity): void {
  patch({
    intensity,
    rules_override: pruneStaleOverrides(props.modelValue.rules_override, intensity),
  });
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

function toggleRule(rid: RuleId): void {
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
      >{{ wordCount }}w · {{ charCount }}c</span>
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
      <span class="wp-cleaner__section-label">RULES</span>
      <div class="wp-cleaner__rules">
        <button
          v-for="rule in ALL_RULES"
          :key="rule.id"
          :data-test="`cleaner-rule-${rule.id}`"
          :class="['wp-cleaner__rule', {
            'is-on': effective.has(rule.id),
            'is-overridden': isOverridden(rule.id),
          }]"
          :title="rule.tooltip"
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
      </div>
    </section>

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
.wp-cleaner {
  color: var(--wp-text);
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 6px);
  font-size: 12px;
}
/* Match litegraph's native dim on muted (mode=2) + bypassed (mode=4) —
   parity with WP_Context / WP_Debug / WP_Injector widgets. */
.wp-cleaner--skipped { opacity: 0.45; }

.wp-cleaner__head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--wp-border);
  display: flex; justify-content: space-between; align-items: center;
}
.wp-cleaner__mode { display: flex; gap: 4px; }
.wp-cleaner__mode-btn {
  font-size: 11px;
  padding: 3px 10px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm, 4px);
  cursor: pointer;
}
.wp-cleaner__mode-btn:hover { color: var(--wp-text); background: var(--wp-bg2, var(--wp-bg-2)); }
.wp-cleaner__mode-btn.is-active {
  background: var(--wp-accent);
  color: #fff;
  border-color: var(--wp-accent);
}
.wp-cleaner__counter {
  font-size: 11px;
  color: var(--wp-text-dim, var(--wp-text3));
  font-variant-numeric: tabular-nums;
}

.wp-cleaner__section { padding: 8px 12px; }
.wp-cleaner__section-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.wp-cleaner__section-label {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--wp-text-muted, var(--wp-text2));
}

.wp-cleaner__badge {
  font-size: 9px;
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

.wp-cleaner__seg {
  display: grid; grid-template-columns: repeat(3, 1fr);
  background: var(--wp-bg2, var(--wp-bg-2));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  padding: 2px;
  gap: 2px;
}
.wp-cleaner__seg-btn {
  font-size: 11px;
  padding: 5px 6px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  border: 0;
  border-radius: 3px;
  cursor: pointer;
}
.wp-cleaner__seg-btn:hover { color: var(--wp-text); }
.wp-cleaner__seg-btn.is-active {
  background: var(--wp-accent);
  color: #fff;
}

.wp-cleaner__rules { display: grid; gap: 2px; }
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
  font-size: 11px;
  color: var(--wp-text-dim, var(--wp-text3));
  text-align: left;
  border-radius: 3px;
}
.wp-cleaner__rule:hover { background: var(--wp-bg2, var(--wp-bg-2)); color: var(--wp-text); }
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

.wp-cleaner__blocklist { padding: 4px 12px 8px; }
.wp-cleaner__blocklist-btn {
  font-size: 11px;
  padding: 4px 8px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  border: 1px dashed var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}
.wp-cleaner__blocklist-btn:hover {
  background: var(--wp-bg2, var(--wp-bg-2));
  color: var(--wp-text);
  border-style: solid;
}
.wp-cleaner__blocklist-btn.has-entries {
  background: var(--wp-accent-glow, color-mix(in srgb, var(--wp-accent) 18%, transparent));
  color: var(--wp-accent);
  border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent);
}
.wp-cleaner__blocklist-meta {
  font-size: 10px;
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
