<script setup lang="ts">
/**
 * Spectrum-dial cleaner widget. See
 * docs/superpowers/specs/2026-05-25-prompt-cleaner-node-design.md §4.
 *
 * Stateless rendering — caller owns the CleanerNodeConfig and emits
 * the updated value. Last-run stats + token counts are read-only
 * props provided by the parent (the canvas widget mount glue).
 */
import { computed } from "vue";
import { computeEffectiveRules, isPristine } from "./intensity";
import type { CleanerNodeConfig, Intensity, Mode, RuleId, RunReport } from "./types";

const props = defineProps<{
  modelValue: CleanerNodeConfig;
  lastRunReport: RunReport | null;
  wordCount: number;
  charCount: number;
  clipTokenCount: number | null;
  clipTokenLimit: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: CleanerNodeConfig];
  "open-blocklist": [];
  "open-save": [];
}>();

const ALL_RULES: { id: RuleId; label: string; statKey: string }[] = [
  { id: "whitespace",    label: "whitespace",   statKey: "fixed" },
  { id: "dedupe_exact",  label: "tag dedupe",   statKey: "dropped" },
  { id: "wp_dedupe",     label: "WP-dedupe",    statKey: "dropped" },
  { id: "null_slot",     label: "null-slot",    statKey: "stripped" },
  { id: "fuzzy_dedupe",  label: "fuzzy dedupe", statKey: "dropped" },
  { id: "dangling_var",  label: "dangling-var", statKey: "stripped" },
  { id: "blocklist",     label: "blocklist",    statKey: "dropped" },
  { id: "reorder",       label: "reorder",      statKey: "reordered" },
];

const INTENSITIES: Intensity[] = ["gentle", "balanced", "aggressive"];

const effective = computed(() => new Set(computeEffectiveRules(props.modelValue)));
const pristine = computed(() => isPristine(props.modelValue));

const clipFillPct = computed(() => {
  if (props.clipTokenCount === null) return 0;
  return Math.min(100, (props.clipTokenCount / props.clipTokenLimit) * 100);
});

function patch(next: Partial<CleanerNodeConfig>): void {
  emit("update:modelValue", { ...props.modelValue, ...next });
}

function setIntensity(intensity: Intensity): void {
  patch({ intensity });
}

function setMode(mode: Mode): void {
  patch({ mode });
}

function toggleRule(rid: RuleId): void {
  const currentlyOn = effective.value.has(rid);
  const overrides = { ...props.modelValue.rules_override };
  const intensityDefault = computeEffectiveRules({
    ...props.modelValue,
    rules_override: {},
    blocklist: { kind: "list", entries: [] },
  }).includes(rid);
  if (currentlyOn === intensityDefault) {
    overrides[rid] = !currentlyOn;
  } else {
    delete overrides[rid];
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
  return rid in props.modelValue.rules_override;
}
</script>

<template>
  <div class="wp-cleaner">
    <header class="wp-cleaner__head">
      <div class="wp-cleaner__mode">
        <button
          data-test="cleaner-mode-tags"
          :class="['wp-cleaner__mode-btn', { 'is-active': modelValue.mode === 'tags' }]"
          @click="setMode('tags')"
        >tags</button>
        <button
          data-test="cleaner-mode-text"
          :class="['wp-cleaner__mode-btn', { 'is-active': modelValue.mode === 'text' }]"
          @click="setMode('text')"
        >text</button>
      </div>
      <span class="wp-cleaner__counter">{{ wordCount }}w · {{ charCount }}c</span>
    </header>

    <div v-if="clipTokenCount !== null" class="wp-cleaner__clip" data-test="cleaner-clip-bar">
      <div class="wp-cleaner__clip-row">
        <span class="wp-cleaner__clip-label">CLIP TOKENS</span>
        <span class="wp-cleaner__clip-count"><b>{{ clipTokenCount }}</b> / {{ clipTokenLimit }}</span>
      </div>
      <div class="wp-cleaner__clip-track">
        <div class="wp-cleaner__clip-fill" :style="{ width: clipFillPct + '%' }" />
      </div>
    </div>

    <section class="wp-cleaner__section">
      <div class="wp-cleaner__section-head">
        <span class="wp-cleaner__section-label">INTENSITY</span>
        <span
          v-if="!pristine"
          class="wp-cleaner__custom-badge"
          data-test="cleaner-custom-badge"
        >CUSTOM</span>
      </div>
      <div class="wp-cleaner__intensity">
        <button
          v-for="lvl in INTENSITIES"
          :key="lvl"
          :data-test="`cleaner-intensity-${lvl}`"
          :class="['wp-cleaner__intensity-btn', { 'is-active': modelValue.intensity === lvl }]"
          @click="setIntensity(lvl)"
        >
          {{ lvl }}
          <span v-if="modelValue.intensity === lvl && !pristine" class="wp-cleaner__dot" />
        </button>
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
          @click="toggleRule(rule.id)"
        >
          <span class="wp-cleaner__rule-dot" />
          <span class="wp-cleaner__rule-label">{{ rule.label }}</span>
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
        @click="emit('open-blocklist')"
      >
        Blocklist… ({{ modelValue.blocklist.entries.length }} entries · {{ modelValue.blocklist.kind }})
      </button>
    </div>

    <footer class="wp-cleaner__foot">
      <span class="wp-cleaner__foot-label">PRESET</span>
      <span class="wp-cleaner__foot-name">{{ modelValue.preset_ref?.name ?? modelValue.intensity }}</span>
      <button
        v-if="!pristine"
        data-test="cleaner-save"
        class="wp-cleaner__save"
        @click="emit('open-save')"
      >save…</button>
    </footer>
  </div>
</template>

<style scoped>
.wp-cleaner {
  font: 13px var(--wp-font-sans, ui-sans-serif);
  color: var(--wp-text, #e5e5e5);
  background: var(--wp-bg, #1a1a1a);
  border: 1px solid var(--wp-border, #2d2d2d);
  border-radius: 6px;
}
.wp-cleaner__head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--wp-border-soft, #2d2d2d);
  display: flex; justify-content: space-between; align-items: center;
}
.wp-cleaner__mode { display: flex; gap: 4px; }
.wp-cleaner__mode-btn {
  font: 10px var(--wp-font-mono, ui-monospace);
  padding: 2px 10px;
  background: transparent;
  color: var(--wp-text-dim, #666);
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.wp-cleaner__mode-btn.is-active { background: var(--wp-accent, #a855f7); color: #fff; }
.wp-cleaner__counter { font: 10px var(--wp-font-mono); color: var(--wp-text-dim, #888); }
.wp-cleaner__clip {
  padding: 10px 14px;
  background: var(--wp-bg-deep, #161616);
  border-bottom: 1px solid var(--wp-border-soft, #2d2d2d);
}
.wp-cleaner__clip-row {
  display: flex; justify-content: space-between; align-items: baseline;
}
.wp-cleaner__clip-label {
  font: 9px var(--wp-font-mono);
  letter-spacing: 0.12em;
  color: var(--wp-text-dim, #888);
}
.wp-cleaner__clip-count { font: 9px var(--wp-font-mono); color: var(--wp-text-dim, #666); }
.wp-cleaner__clip-count b { color: var(--wp-text, #e5e5e5); font-size: 13px; }
.wp-cleaner__clip-track {
  height: 4px;
  background: var(--wp-bg-deepest, #0a0a0a);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}
.wp-cleaner__clip-fill {
  height: 100%; background: var(--wp-accent, #a855f7); border-radius: 2px;
}
.wp-cleaner__section { padding: 10px 14px; }
.wp-cleaner__section-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.wp-cleaner__section-label {
  font: 9px var(--wp-font-mono);
  letter-spacing: 0.12em;
  color: var(--wp-text-muted, #a3a3a3);
}
.wp-cleaner__custom-badge {
  font: 8px var(--wp-font-mono);
  padding: 1px 6px;
  background: color-mix(in srgb, var(--wp-status-modified, #fb923c) 22%, transparent);
  color: var(--wp-status-modified, #fb923c);
  border: 1px solid color-mix(in srgb, var(--wp-status-modified, #fb923c) 50%, transparent);
  border-radius: 2px;
}
.wp-cleaner__intensity {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  background: var(--wp-bg-deepest, #0a0a0a);
  border-radius: 3px;
  padding: 2px;
}
.wp-cleaner__intensity-btn {
  position: relative;
  font: 10px var(--wp-font-mono);
  padding: 6px;
  background: transparent;
  color: var(--wp-text-dim, #666);
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.wp-cleaner__intensity-btn.is-active {
  background: var(--wp-accent, #a855f7);
  color: #fff;
}
.wp-cleaner__dot {
  position: absolute; top: 2px; right: 2px;
  width: 5px; height: 5px;
  background: var(--wp-status-modified, #fb923c);
  border-radius: 50%;
}
.wp-cleaner__rules { display: grid; gap: 4px; }
.wp-cleaner__rule {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 0;
  padding: 3px 0;
  cursor: pointer;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-dim, #666);
  text-align: left;
}
.wp-cleaner__rule-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #3a3a3a;
}
.wp-cleaner__rule.is-on { color: var(--wp-text, #e5e5e5); }
.wp-cleaner__rule.is-on .wp-cleaner__rule-dot { background: var(--wp-accent, #a855f7); }
.wp-cleaner__rule.is-overridden::after {
  content: "•"; color: var(--wp-status-modified, #fb923c); font-size: 9px;
}
.wp-cleaner__rule-stat { font-size: 9px; color: var(--wp-text-dim, #666); }
.wp-cleaner__blocklist { padding: 4px 14px 10px; }
.wp-cleaner__blocklist-btn {
  font: 10px var(--wp-font-mono);
  padding: 4px 8px;
  background: transparent;
  color: var(--wp-text-dim, #888);
  border: 1px dashed var(--wp-border, #444);
  border-radius: 2px;
  width: 100%;
  text-align: left;
  cursor: pointer;
}
.wp-cleaner__blocklist-btn.has-entries {
  background: color-mix(in srgb, var(--wp-accent, #a855f7) 20%, transparent);
  color: var(--wp-accent, #a855f7);
  border: 1px solid color-mix(in srgb, var(--wp-accent, #a855f7) 50%, transparent);
}
.wp-cleaner__foot {
  padding: 8px 12px;
  border-top: 1px solid var(--wp-border-soft, #2d2d2d);
  display: flex; align-items: center; gap: 8px;
}
.wp-cleaner__foot-label { font: 9px var(--wp-font-mono); color: var(--wp-text-dim, #666); }
.wp-cleaner__foot-name {
  flex: 1;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, #a3a3a3);
}
.wp-cleaner__save {
  font: 9px var(--wp-font-mono);
  padding: 2px 8px;
  background: transparent;
  color: var(--wp-accent, #a855f7);
  border: 1px solid var(--wp-accent, #a855f7);
  border-radius: 2px;
  cursor: pointer;
}
</style>
