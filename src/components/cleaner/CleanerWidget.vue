<script setup lang="ts">
/**
 * Spectrum-dial cleaner widget. See
 * docs/superpowers/specs/2026-05-25-prompt-cleaner-node-design.md §4.
 *
 * Stateless rendering — caller owns the CleanerNodeConfig and emits
 * the updated value. Last-run stats + token counts are read-only
 * props provided by the parent (the canvas widget mount glue).
 *
 * Tokens: uses canonical `--wp-*` theme variables from
 * src/components/shared/theme.css (and SPA's src/manager/styles/tokens.css
 * which overrides the same names with the SPA palette). Two-level
 * fallback `var(--wp-text-muted, var(--wp-text2))` covers both palettes
 * without inventing new tokens.
 */
import { computed, ref } from "vue";
import { computeEffectiveRules, isPristine } from "./intensity";
import type {
  CleanerNodeConfig,
  Intensity,
  Mode,
  PresetOption,
  RuleId,
  RunReport,
} from "./types";

const props = withDefaults(defineProps<{
  modelValue: CleanerNodeConfig;
  lastRunReport: RunReport | null;
  wordCount: number;
  charCount: number;
  clipTokenCount: number | null;
  clipTokenLimit: number;
  presets?: PresetOption[];
}>(), {
  presets: () => [],
});

const emit = defineEmits<{
  "update:modelValue": [next: CleanerNodeConfig];
  "open-blocklist": [];
  "open-save": [];
  "load-preset": [presetId: string];
}>();

const ALL_RULES: { id: RuleId; label: string; statKey: string }[] = [
  { id: "whitespace",    label: "whitespace",   statKey: "fixed" },
  { id: "punctuation",   label: "punctuation",  statKey: "stripped" },
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
const presetMenuOpen = ref(false);

const clipFillPct = computed(() => {
  if (props.clipTokenCount === null) return 0;
  return Math.min(100, (props.clipTokenCount / props.clipTokenLimit) * 100);
});

const presetLabel = computed(() => {
  if (props.modelValue.preset_ref) return props.modelValue.preset_ref.name;
  return props.modelValue.intensity;
});

function patch(next: Partial<CleanerNodeConfig>): void {
  emit("update:modelValue", { ...props.modelValue, ...next });
}
function setIntensity(intensity: Intensity): void { patch({ intensity }); }
function setMode(mode: Mode): void { patch({ mode }); }

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
function onLoadPreset(presetId: string): void {
  presetMenuOpen.value = false;
  emit("load-preset", presetId);
}
</script>

<template>
  <div class="wp-cleaner">
    <header class="wp-cleaner__head">
      <div class="wp-cleaner__mode" role="tablist">
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
        <span class="wp-cleaner__section-label">CLIP TOKENS</span>
        <span class="wp-cleaner__clip-count">
          <b>{{ clipTokenCount }}</b> / {{ clipTokenLimit }}
        </span>
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
          class="wp-cleaner__badge"
          data-test="cleaner-custom-badge"
        >CUSTOM</span>
      </div>
      <div class="wp-cleaner__seg">
        <button
          v-for="lvl in INTENSITIES"
          :key="lvl"
          :data-test="`cleaner-intensity-${lvl}`"
          :class="['wp-cleaner__seg-btn', { 'is-active': modelValue.intensity === lvl }]"
          @click="setIntensity(lvl)"
        >
          {{ lvl }}
          <span v-if="modelValue.intensity === lvl && !pristine" class="wp-cleaner__pip" />
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
        Blocklist…
        <span class="wp-cleaner__blocklist-meta">
          {{ modelValue.blocklist.entries.length }} entries · {{ modelValue.blocklist.kind }}
        </span>
      </button>
    </div>

    <footer class="wp-cleaner__foot">
      <span class="wp-cleaner__section-label">PRESET</span>
      <div class="wp-cleaner__preset-pick">
        <button
          type="button"
          data-test="cleaner-preset-btn"
          class="wp-cleaner__preset-btn"
          :disabled="!presets.length"
          @click="presetMenuOpen = !presetMenuOpen"
        >
          <span class="wp-cleaner__preset-name">{{ presetLabel }}</span>
          <i class="pi pi-chevron-down wp-cleaner__preset-caret" />
        </button>
        <div
          v-if="presetMenuOpen && presets.length"
          class="wp-cleaner__preset-menu"
          data-test="cleaner-preset-menu"
        >
          <button
            v-for="p in presets"
            :key="p.id"
            :data-test="`cleaner-preset-option-${p.id}`"
            :class="['wp-cleaner__preset-option', {
              'is-current': modelValue.preset_ref?.id === p.id,
            }]"
            @click="onLoadPreset(p.id)"
          >
            <span>{{ p.name }}</span>
            <span v-if="p.is_builtin" class="wp-cleaner__badge wp-cleaner__badge--dim">built-in</span>
          </button>
        </div>
      </div>
      <button
        v-if="!pristine"
        data-test="cleaner-save"
        class="wp-cleaner__save"
        @click="emit('open-save')"
      >Save…</button>
    </footer>
  </div>
</template>

<style scoped>
/* All sizing inherits from the host. Tokens fall through:
 *   --wp-text-muted (SPA) → --wp-text2 (extension)
 *   --wp-text-dim (SPA)   → --wp-text3 (extension)
 *   --wp-border-strong    → --wp-border2
 *   --wp-bg-2 / --wp-bg3  → exists in both
 *   --wp-amber            → only extension; SPA defines --wp-warn instead
 */
.wp-cleaner {
  color: var(--wp-text);
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 6px);
  font-size: 12px;
}

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

.wp-cleaner__clip {
  padding: 8px 12px;
  background: var(--wp-bg2, var(--wp-bg-2));
  border-bottom: 1px solid var(--wp-border);
}
.wp-cleaner__clip-row {
  display: flex; justify-content: space-between; align-items: baseline;
}
.wp-cleaner__clip-count {
  font-size: 11px;
  color: var(--wp-text-muted, var(--wp-text2));
  font-variant-numeric: tabular-nums;
}
.wp-cleaner__clip-count b { color: var(--wp-text); font-weight: 600; }
.wp-cleaner__clip-track {
  height: 4px;
  background: var(--wp-bg);
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}
.wp-cleaner__clip-fill {
  height: 100%; background: var(--wp-accent); border-radius: 2px;
  transition: width 120ms ease;
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
.wp-cleaner__badge--dim {
  background: var(--wp-bg2, var(--wp-bg-2));
  color: var(--wp-text-dim, var(--wp-text3));
  border-color: var(--wp-border);
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
  position: relative;
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
.wp-cleaner__pip {
  position: absolute;
  top: 3px; right: 3px;
  width: 5px; height: 5px;
  background: var(--wp-amber, var(--wp-warn, #fbbf24));
  border-radius: 50%;
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
  position: relative;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--wp-border2, var(--wp-border-strong));
  flex: 0 0 auto;
}
.wp-cleaner__rule.is-on { color: var(--wp-text); }
.wp-cleaner__rule.is-on .wp-cleaner__rule-dot { background: var(--wp-accent); }
.wp-cleaner__rule.is-overridden .wp-cleaner__rule-dot::after {
  content: "";
  position: absolute;
  top: -2px; right: -2px;
  width: 4px; height: 4px;
  background: var(--wp-amber, var(--wp-warn, #fbbf24));
  border-radius: 50%;
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

.wp-cleaner__foot {
  padding: 8px 12px;
  border-top: 1px solid var(--wp-border);
  display: flex; align-items: center; gap: 8px;
}

.wp-cleaner__preset-pick { position: relative; flex: 1; }
.wp-cleaner__preset-btn {
  width: 100%;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  padding: 4px 8px;
  background: var(--wp-bg2, var(--wp-bg-2));
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  cursor: pointer;
}
.wp-cleaner__preset-btn:hover:not(:disabled) {
  border-color: var(--wp-border2, var(--wp-border-strong));
}
.wp-cleaner__preset-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.wp-cleaner__preset-name { flex: 1; text-align: left; }
.wp-cleaner__preset-caret { font-size: 9px; opacity: 0.7; }

.wp-cleaner__preset-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0; right: 0;
  z-index: 10;
  max-height: 220px;
  overflow-y: auto;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 4px;
}
.wp-cleaner__preset-option {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
  width: 100%;
  font-size: 11px;
  padding: 5px 8px;
  background: transparent;
  color: var(--wp-text);
  border: 0;
  border-radius: 3px;
  cursor: pointer;
  text-align: left;
}
.wp-cleaner__preset-option:hover { background: var(--wp-bg2, var(--wp-bg-2)); }
.wp-cleaner__preset-option.is-current {
  background: var(--wp-accent-glow, color-mix(in srgb, var(--wp-accent) 18%, transparent));
  color: var(--wp-accent-text, var(--wp-accent));
}

.wp-cleaner__save {
  font-size: 11px;
  padding: 4px 10px;
  background: var(--wp-accent);
  color: #fff;
  border: 0;
  border-radius: var(--wp-radius-sm, 4px);
  cursor: pointer;
}
.wp-cleaner__save:hover { background: var(--wp-accent2, var(--wp-accent-600, var(--wp-accent))); }
</style>
