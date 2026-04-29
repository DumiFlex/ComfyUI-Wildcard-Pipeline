<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  /**
   * Unified `(name → value)` map of every variable an upstream
   * `WP_Context` would bind at graph-run time. The resolver
   * (`extension/graph.ts:collectUpstreamResolved`) populates it
   * deterministically — wildcards always pick option `[0]` so the
   * preview is stable as the user edits the template. Real graph
   * runs reseed randomly each time; the assembled prompt at edit
   * time is therefore a sample, not a guarantee.
   */
  upstreamResolved: Record<string, string>;
  template: string;
  onInsert: (token: string) => void;
  /** Strip every occurrence of `$varname` from the template. Wired
   *  to the UNRESOLVED chips so users can one-click drop a name
   *  they accidentally typed (or that an upstream module no longer
   *  binds). Optional — host widgets can skip wiring it if they
   *  don't want the click affordance. */
  onRemoveVar?: (varname: string) => void;
  /** Seed used by the server-side preview resolver. Surfaced in the
   *  PREVIEW header so users see "PREVIEW · 42" — the same seed a
   *  WP_Context node would use at run time when set to that value.
   *  Optional; defaults to 42 for stable preview rolls. */
  previewSeed?: number;
}>();

/** Variable names known upstream — thin keys-of helper for the
 *  chip strip + the missing-vs-known check below. */
const upstreamNames = computed(() => Object.keys(props.upstreamResolved));

// Sentinel survives both regex passes — � is the Unicode replacement
// character; doubled, it can't appear in real prompts.
const ESCAPE_PLACEHOLDER = "��";
const ESCAPE_RE = /��/g;
const VAR_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Stable per-name hue. djb2-ish hash → 0..359°. Deterministic across runs
// so the same variable always gets the same color in chip + preview.
function hueFor(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function chipColor(name: string): string {
  return `hsl(${hueFor(name)}, 65%, 65%)`;
}
function chipBg(name: string): string {
  return `hsla(${hueFor(name)}, 65%, 55%, 0.15)`;
}

const templateVars = computed(() => {
  const sanitized = props.template.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const matches = sanitized.match(VAR_RE);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1)).filter((v) => !v.startsWith("__")))];
});

// "Missing" now means: template references `$foo` and NO upstream
// module binds `foo`. There is no longer a "name known but value
// unknown" middle state — the resolver always produces a value (a
// runtime-random wildcard's preview pick is just option [0]).
const missingVars = computed(() =>
  templateVars.value.filter((v) => !Object.prototype.hasOwnProperty.call(props.upstreamResolved, v)),
);

function isUsed(v: string): boolean {
  return templateVars.value.includes(v);
}

const previewHtml = computed(() => {
  if (!props.template) {
    return '<span class="wp-asm-empty-inline">Template is empty.</span>';
  }
  const escaped = props.template.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const safe = escapeHtml(escaped).replace(VAR_RE, (full, name: string) => {
    if (name.startsWith("__")) return full;
    const hue = hueFor(name);
    const colorStyle = `style="color: hsl(${hue}, 65%, 70%); background: hsla(${hue}, 65%, 55%, 0.15);"`;
    if (Object.prototype.hasOwnProperty.call(props.upstreamResolved, name)) {
      return `<span class="wp-tok-resolved" ${colorStyle}>${escapeHtml(props.upstreamResolved[name])}</span>`;
    }
    return `<span class="wp-tok-miss">$${name}</span>`;
  });
  return safe.replace(ESCAPE_RE, "$");
});

// Ripple effect — track most-recent click coords per chip element to drive
// the radial-gradient animation. Cleared after the animation duration.
const ripples = ref<Map<string, { x: number; y: number; t: number }>>(new Map());

function onChipClick(ev: MouseEvent, v: string) {
  const el = ev.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  ripples.value.set(v, { x, y, t: Date.now() });
  // Clear after animation finishes so the chip re-renders without it.
  setTimeout(() => {
    const cur = ripples.value.get(v);
    if (cur && Date.now() - cur.t >= 380) ripples.value.delete(v);
  }, 420);
  props.onInsert(`$${v}`);
}

function rippleStyle(v: string): Record<string, string> {
  const r = ripples.value.get(v);
  if (!r) return {};
  return {
    "--wp-ripple-x": `${r.x}px`,
    "--wp-ripple-y": `${r.y}px`,
  };
}
</script>

<template>
  <div class="wp-asm">
    <div v-if="upstreamNames.length" class="wp-asm__section">
      <label class="wp-asm__label">VARIABLES</label>
      <div class="wp-asm__chips">
        <button
          v-for="v in upstreamNames" :key="v"
          type="button"
          class="wp-asm__chip"
          :class="[isUsed(v) ? 'used' : 'available', { 'wp-asm__chip--ripple': ripples.has(v) }]"
          :style="{ ...rippleStyle(v), color: chipColor(v), background: chipBg(v) }"
          data-testid="chip"
          :title="upstreamResolved[v] ?? ''"
          @click="(ev) => onChipClick(ev, v)"
        >${{ v }}</button>
      </div>
    </div>

    <div v-else class="wp-asm__section wp-asm__section--empty">
      <span class="wp-asm__empty">Connect a Pipeline Context to see available variables</span>
    </div>

    <div class="wp-asm__section">
      <label class="wp-asm__label">PREVIEW <span class="wp-asm__label-sep">·</span> <span class="wp-asm__label-seed">{{ previewSeed ?? 42 }}</span></label>
      <div v-if="!template" class="wp-asm__skeleton">
        <span class="wp-asm__skel-line"></span>
        <span class="wp-asm__skel-line wp-asm__skel-line--short"></span>
      </div>
      <div v-else class="wp-asm__rendered" v-html="previewHtml"></div>
    </div>

    <div v-if="missingVars.length" class="wp-asm__section">
      <label class="wp-asm__label wp-asm__label--warn">
        UNRESOLVED <span class="wp-asm__label-sep">·</span> <span v-if="onRemoveVar">click to remove from template</span><span v-else>dropped from prompt</span>
      </label>
      <div class="wp-asm__chips">
        <!-- When `onRemoveVar` is wired, render as a button that
             strips `$varname` from the host widget's template on
             click. Without the callback we keep the static-span
             rendering so headless mounts (without widget glue) still
             show the chips. -->
        <button
          v-for="v in missingVars"
          v-if="onRemoveVar"
          :key="v"
          type="button"
          class="wp-asm__chip missing wp-asm__chip--clickable"
          data-testid="missing-chip"
          :title="`Remove $${v} from template`"
          @click="onRemoveVar(v)"
        >${{ v }}<i class="pi pi-times wp-asm__chip-x" aria-hidden="true"></i></button>
        <span
          v-for="v in missingVars"
          v-else
          :key="`s-${v}`"
          class="wp-asm__chip missing"
          data-testid="missing-chip"
        >${{ v }}</span>
      </div>
    </div>
  </div>
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-asm, .wp-asm * { box-sizing: border-box; }
.wp-asm {
  display: flex;
  flex-direction: column;
  width: 100%;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
  cursor: default;
  user-select: none;
}

.wp-asm__section {
  padding: 8px 10px;
}
.wp-asm__section + .wp-asm__section {
  border-top: 1px solid var(--wp-border);
}

.wp-asm__label {
  font-size: 9px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3);
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  display: block;
}
.wp-asm__label--warn { color: var(--wp-amber); }

.wp-asm__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.wp-asm__chip {
  font-size: 10px;
  font-family: var(--wp-font-mono, monospace);
  padding: 2px 7px;
  border-radius: 3px;
  user-select: none;
  border: none;
  transition: background 0.12s, color 0.12s, transform 0.12s;
  position: relative;
  overflow: hidden;
}
.wp-asm__chip.available { cursor: pointer; }
.wp-asm__chip.used { cursor: pointer; }
.wp-asm__chip.used::after {
  /* Tiny indicator pinned to the top-right corner. No padding override —
   * chip stays the same width as available chips. The dot sits in the
   * tight corner gap above the variable glyphs' ascender. */
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}
.wp-asm__chip.available:hover,
.wp-asm__chip.used:hover {
  /* filter brightens whatever inline hsla() the chip got from its name hash —
   * works without overriding the inline style. */
  filter: brightness(1.3) saturate(1.15);
}
.wp-asm__chip.missing {
  background: var(--wp-amber-bg) !important;
  color: var(--wp-amber) !important;
  cursor: default;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-asm__chip--clickable { cursor: pointer; }
.wp-asm__chip--clickable:hover {
  /* On hover, suggest "delete" — the small × glyph next to the name
   * already telegraphs intent; tint the bg to reinforce. */
  background: color-mix(in srgb, var(--wp-amber) 30%, transparent) !important;
}
.wp-asm__chip-x { font-size: 8px; opacity: 0.7; }
.wp-asm__chip--clickable:hover .wp-asm__chip-x { opacity: 1; }
.wp-asm__label-sep { color: var(--wp-text3); margin: 0 2px; }
.wp-asm__label-seed {
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-weight: 700;
}

/* Ripple — radial expanding overlay anchored to click coords */
.wp-asm__chip--ripple::before {
  content: "";
  position: absolute;
  left: var(--wp-ripple-x, 50%);
  top: var(--wp-ripple-y, 50%);
  width: 0;
  height: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  transform: translate(-50%, -50%);
  animation: wp-asm-ripple 0.4s ease-out;
  pointer-events: none;
}
@keyframes wp-asm-ripple {
  0%   { width: 0; height: 0; opacity: 0.6; }
  100% { width: 120px; height: 120px; opacity: 0; }
}

.wp-asm__rendered {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 6px 8px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  line-height: 1.6;
  color: var(--wp-text2);
  word-break: break-word;
  white-space: pre-wrap;
  min-height: 32px;
}

/* Skeleton when template is empty (also briefly visible during async chunk
 * resolution before Vue patches the props in). */
.wp-asm__skeleton {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 8px;
  min-height: 32px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-asm__skel-line {
  display: block;
  height: 8px;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    var(--wp-bg2) 0%,
    var(--wp-bg4) 50%,
    var(--wp-bg2) 100%
  );
  background-size: 200% 100%;
  animation: wp-asm-shimmer 1.4s ease-in-out infinite;
}
.wp-asm__skel-line--short { width: 60%; }
@keyframes wp-asm-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.wp-asm__section--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
}
.wp-asm__empty {
  color: var(--wp-text3);
  font-size: 11px;
  font-style: italic;
}
</style>

<style>
/* Unscoped — rendered via v-html. */
.wp-tok-resolved {
  padding: 1px 4px;
  border-radius: 3px;
  /* 600 not 500 — we only bundle Inter 400 + 600 to keep the chunk small.
   * 500 would substitute via system fallback and look out of family. */
  font-weight: 600;
}
.wp-tok-ok {
  padding: 1px 3px;
  border-radius: 3px;
}
.wp-tok-miss {
  color: var(--wp-amber, #d4a843);
  background: var(--wp-amber-bg, rgba(212, 168, 67, 0.1));
  padding: 1px 3px;
  border-radius: 3px;
  text-decoration: underline wavy;
}
.wp-asm-empty-inline {
  color: var(--wp-text3, #5a5a72);
  font-style: italic;
}
</style>
