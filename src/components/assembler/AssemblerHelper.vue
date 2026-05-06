<script setup lang="ts">
import { computed, ref } from "vue";
import { varColorClass } from "../shared/var-color";

const props = defineProps<{
  /**
   * Unified `(name → value)` map of every variable an upstream
   * `WP_Context` would bind at graph-run time. The resolver
   * (`extension/graph.ts:collectUpstreamResolved`) populates it
   * deterministically — wildcards always pick option `[0]` so the
   * preview is stable as the user edits the template. Real graph
   * runs reseed randomly each time; the assembled prompt at edit
   * time is therefore a sample, not a guarantee.
   *
   * Mutually exclusive with `upstreamVars` + `resolved` — the component
   * accepts either the legacy record-based shape OR the array-based
   * shape used by headless tests and the new widget API.
   */
  upstreamResolved?: Record<string, string>;
  /** Alternative flat-array shape for upstream names (used by new tests). */
  upstreamVars?: string[];
  /** Pre-extracted template variable names (used by new tests). */
  templateVars?: string[];
  /** Pre-resolved string (used by new tests + future async path). */
  resolved?: string;
  template: string;
  onInsert?: (token: string) => void;
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

const emit = defineEmits<{
  (e: "insertVar", v: string): void;
}>();

// ---------------------------------------------------------------------------
// Normalised derived state — works from either prop shape
// ---------------------------------------------------------------------------

/** Upstream variable names, derived from whichever prop shape is supplied. */
const upstreamNames = computed(() => {
  if (props.upstreamVars) return props.upstreamVars;
  if (props.upstreamResolved) return Object.keys(props.upstreamResolved);
  return [];
});

// Sentinel survives both regex passes — the Unicode replacement character;
// doubled, it can't appear in real prompts.
const ESCAPE_PLACEHOLDER = "��";
const ESCAPE_RE = /��/g;
const VAR_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
const TEMPLATE_VAR_RE = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** Variable names referenced in the template. */
const templateVarsInternal = computed(() => {
  if (props.templateVars) return props.templateVars;
  const sanitized = props.template.replace(/\$\$/g, ESCAPE_PLACEHOLDER);
  const matches = sanitized.match(VAR_RE);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1)).filter((v) => !v.startsWith("__")))];
});

/**
 * Variables referenced in the template but NOT present in the upstream map.
 * When `templateVars` prop is provided (new shape), "missing" means not in
 * `upstreamVars`. When using the legacy shape, it means not in
 * `upstreamResolved`.
 */
const missing = computed(() => {
  if (props.templateVars && props.upstreamVars) {
    const upstream = props.upstreamVars;
    return props.templateVars.filter((v) => !upstream.includes(v));
  }
  return templateVarsInternal.value.filter(
    (v) => !Object.prototype.hasOwnProperty.call(props.upstreamResolved ?? {}, v),
  );
});

// Alias for legacy test compatibility
const missingVars = missing;

function isUsed(v: string): boolean {
  return templateVarsInternal.value.includes(v);
}

// ---------------------------------------------------------------------------
// Preview tokenisation
// ---------------------------------------------------------------------------

interface PreviewToken { kind: "literal" | "var"; text: string; varName?: string }

const previewTokens = computed<PreviewToken[]>(() => {
  if (!props.template) return [];

  // When a pre-resolved string is provided (new prop shape) use the
  // parallel-walk tokeniser so each substring carries its source variable.
  if (props.resolved !== undefined) {
    if (!props.resolved) {
      // No resolved string yet — render template with var highlights.
      const tokens: PreviewToken[] = [];
      let last = 0;
      for (const m of props.template.matchAll(TEMPLATE_VAR_RE)) {
        const idx = m.index ?? 0;
        if (idx > last) tokens.push({ kind: "literal", text: props.template.slice(last, idx) });
        tokens.push({ kind: "var", text: `$${m[1]}`, varName: m[1] });
        last = idx + m[0].length;
      }
      if (last < props.template.length) tokens.push({ kind: "literal", text: props.template.slice(last) });
      return tokens;
    }

    // Resolved string present — walk template + resolved in parallel.
    const tpl = props.template;
    const res = props.resolved;
    const segments: Array<{ kind: "literal" | "var"; text: string; varName?: string }> = [];
    let last = 0;
    for (const m of tpl.matchAll(TEMPLATE_VAR_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) segments.push({ kind: "literal", text: tpl.slice(last, idx) });
      segments.push({ kind: "var", text: m[0], varName: m[1] });
      last = idx + m[0].length;
    }
    if (last < tpl.length) segments.push({ kind: "literal", text: tpl.slice(last) });

    const tokens: PreviewToken[] = [];
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.kind === "literal") {
        const slice = res.slice(cursor, cursor + seg.text.length);
        tokens.push({ kind: "literal", text: slice });
        cursor += seg.text.length;
      } else {
        const next = segments[i + 1];
        let end = res.length;
        if (next && next.kind === "literal" && next.text.length > 0) {
          const nextIdx = res.indexOf(next.text, cursor);
          if (nextIdx >= 0) end = nextIdx;
        }
        tokens.push({ kind: "var", text: res.slice(cursor, end), varName: seg.varName });
        cursor = end;
      }
    }
    return tokens;
  }

  return []; // legacy path uses previewHtml below
});

// ---------------------------------------------------------------------------
// Legacy HTML preview (used when upstreamResolved record is provided)
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Stable per-name hue — kept for legacy v-html preview.
function hueFor(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h % 360;
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
    if (Object.prototype.hasOwnProperty.call(props.upstreamResolved ?? {}, name)) {
      return `<span class="wp-tok-resolved" ${colorStyle}>${escapeHtml((props.upstreamResolved ?? {})[name])}</span>`;
    }
    return `<span class="wp-tok-miss">$${name}</span>`;
  });
  return safe.replace(ESCAPE_RE, "$");
});

// ---------------------------------------------------------------------------
// Ripple effect
// ---------------------------------------------------------------------------

const ripples = ref<Map<string, { x: number; y: number; t: number }>>(new Map());

function onChipClick(ev: MouseEvent, v: string) {
  const el = ev.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  ripples.value.set(v, { x, y, t: Date.now() });
  setTimeout(() => {
    const cur = ripples.value.get(v);
    if (cur && Date.now() - cur.t >= 380) ripples.value.delete(v);
  }, 420);
  // Support both callback prop (legacy) and emit (new shape)
  if (props.onInsert) props.onInsert(`$${v}`);
  emit("insertVar", v);
}

function rippleStyle(v: string): Record<string, string> {
  const r = ripples.value.get(v);
  if (!r) return {};
  return {
    "--wp-ripple-x": `${r.x}px`,
    "--wp-ripple-y": `${r.y}px`,
  };
}

/** Whether to use the new chip-strip + token preview layout vs the legacy layout. */
const useNewLayout = computed(() => props.upstreamVars !== undefined || props.resolved !== undefined);
</script>

<template>
  <!-- ============================================================
       NEW LAYOUT — chip strip + tokenised preview
       Activated when `upstreamVars` or `resolved` props are present.
       ============================================================ -->
  <div v-if="useNewLayout" class="wp-asm-helper">
    <!-- variables section -->
    <div class="wp-asm-section">
      <span>variables</span>
      <span class="wp-asm-section-stat">
        {{ upstreamNames.length }} upstream
        <template v-if="missing.length">
          · <span class="wp-asm-section-stat--warn">{{ missing.length }} missing</span>
        </template>
      </span>
    </div>
    <div class="wp-asm-vars">
      <span
        v-for="v in upstreamNames"
        :key="v"
        :data-test="`asm-chip-${v}`"
        :class="['wp-asm-var', varColorClass(v), { 'wp-asm__chip--ripple': ripples.has(v) }]"
        :style="rippleStyle(v)"
        @click="(ev) => onChipClick(ev, v)"
      ><span class="var-tok">{{ v }}</span></span>
      <span
        v-for="v in missing"
        :key="`miss-${v}`"
        :data-test="`asm-chip-${v}`"
        class="wp-asm-var wp-asm-var--missing"
      ><i class="pi pi-exclamation-triangle" aria-hidden="true" />{{ v }}</span>
    </div>

    <!-- preview section -->
    <div class="wp-asm-section">
      <span>preview</span>
      <span :class="['wp-asm-section-stat', resolved ? 'is-ok' : '']">
        {{ resolved ? "resolved" : "(template empty or unresolved)" }}
      </span>
    </div>
    <div class="wp-asm-preview" data-test="asm-preview">
      <template v-for="(tok, i) in previewTokens" :key="i">
        <span v-if="tok.kind === 'literal'" class="literal">{{ tok.text }}</span>
        <span v-else :class="['res', varColorClass(tok.varName ?? '')]">{{ tok.text }}</span>
      </template>
    </div>

    <!-- hint -->
    <div class="wp-asm-hint">
      <span>click chip → insert <kbd>$var</kbd> at caret</span>
      <span style="margin-left: auto;">drop wildcard onto template → autoinsert</span>
    </div>
  </div>

  <!-- ============================================================
       LEGACY LAYOUT — upstreamResolved record shape
       Preserves existing behaviour for the widget host (assembler.ts)
       and the pre-existing tests.
       ============================================================ -->
  <div v-else class="wp-asm">
    <div v-if="upstreamNames.length" class="wp-asm__section">
      <label class="wp-asm__label">VARIABLES</label>
      <div class="wp-asm__chips">
        <button
          v-for="v in upstreamNames" :key="v"
          type="button"
          class="wp-asm__chip"
          :class="[isUsed(v) ? 'used' : 'available', { 'wp-asm__chip--ripple': ripples.has(v) }]"
          :style="{ ...rippleStyle(v), color: `hsl(${hueFor(v)}, 65%, 65%)`, background: `hsla(${hueFor(v)}, 65%, 55%, 0.15)` }"
          data-testid="chip"
          :title="(upstreamResolved ?? {})[v] ?? ''"
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
        UNRESOLVED <span class="wp-asm__label-sep">·</span>
        <span v-if="onRemoveVar">click to remove from template</span><span v-else>dropped from prompt</span>
      </label>
      <div class="wp-asm__chips">
        <button
          v-for="v in missingVars"
          v-if="onRemoveVar"
          :key="v"
          type="button"
          class="wp-asm__chip missing wp-asm__chip--clickable"
          data-testid="missing-chip"
          :title="`Remove $${v} from template`"
          @click="onRemoveVar!(v)"
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
/* ======================================================
   NEW LAYOUT — .wp-asm-helper
   ====================================================== */
.wp-asm-helper {
  font-family: var(--wp-font-sans);
  padding: 6px;
  color: var(--wp-text);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-asm-section {
  display: flex;
  align-items: center;
  margin: 6px 0 4px;
  font: 500 11px/1 var(--wp-font-sans);
  color: var(--wp-text-muted);
  text-transform: lowercase;
}
.wp-asm-section-stat {
  margin-left: auto;
  font: 11px/1 var(--wp-font-mono);
  color: var(--wp-text-dim);
}
.wp-asm-section-stat--warn { color: var(--wp-warn); }
.wp-asm-section-stat.is-ok { color: var(--wp-green); }

.wp-asm-vars {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}
.wp-asm-var {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-soft);
  border-radius: 3px;
  padding: 3px 7px;
  font: 11px/1 var(--wp-font-mono);
  cursor: pointer;
  transition: all 0.12s ease;
  position: relative;
  overflow: hidden;
}
.wp-asm-var .var-tok {
  font: 600 11px/1 var(--wp-font-mono);
}
.wp-asm-var .var-tok::before {
  content: "$";
  opacity: 0.7;
  margin-right: 1px;
}
.wp-asm-var:hover {
  border-color: currentColor;
  background: var(--wp-bg-2);
}
.wp-asm-var--missing {
  color: var(--wp-text-dim);
  border-style: dashed;
  cursor: default;
}
.wp-asm-var--missing i {
  font-size: 10px;
  color: var(--wp-warn);
}

.wp-asm-preview {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 8px 10px;
  font: 11px/1.55 var(--wp-font-mono);
  color: var(--wp-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 140px;
  overflow: auto;
}
.wp-asm-preview .literal { color: var(--wp-text); }
.wp-asm-preview .res { font-weight: 600; }

.wp-asm-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text-dim);
}
.wp-asm-hint kbd {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-soft);
  border-bottom-width: 2px;
  border-radius: 2px;
  font: 10px/1 var(--wp-font-mono);
  padding: 1px 4px;
  color: var(--wp-text-muted);
}

/* ======================================================
   LEGACY LAYOUT — .wp-asm (upstreamResolved shape)
   ====================================================== */
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

/* Ripple */
.wp-asm__chip--ripple::before {
  content: "";
  position: absolute;
  left: var(--wp-ripple-x, 50%);
  top: var(--wp-ripple-y, 50%);
  width: 0;
  height: 0;
  border-radius: 50%;
  background: var(--wp-border-strong);
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
/* Unscoped — rendered via v-html (legacy preview path). */
.wp-tok-resolved {
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 600;
}
.wp-tok-ok {
  padding: 1px 3px;
  border-radius: 3px;
}
.wp-tok-miss {
  color: var(--wp-amber);
  background: var(--wp-amber-bg, rgba(212, 168, 67, 0.1));
  padding: 1px 3px;
  border-radius: 3px;
  text-decoration: underline wavy;
}
.wp-asm-empty-inline {
  color: var(--wp-text-dim);
  font-style: italic;
}
</style>
