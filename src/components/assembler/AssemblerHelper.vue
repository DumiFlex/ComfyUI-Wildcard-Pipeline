<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { varColorClass } from "../shared/var-color";

const props = defineProps<{
  /** Flat array of upstream variable names. Primary prop shape. */
  upstreamVars?: string[];
  /** Pre-extracted template variable names. */
  templateVars?: string[];
  /**
   * Per-variable resolved values. Primary source for preview tokenisation —
   * lets us color each var's resolved substring independently without
   * fragile parallel-walk over the resolved string. When present, takes
   * precedence over `resolved`.
   */
  resolvedMap?: Record<string, string>;
  /**
   * Pre-resolved string — template with $var replaced by resolved values.
   * Legacy fallback when `resolvedMap` not provided. Suffers from
   * boundary-disambiguation bugs when one var's resolved value contains
   * the literal that bounds the next var; prefer `resolvedMap`.
   */
  resolved?: string;
  template: string;
  onInsert?: (token: string) => void;
  /** Strip every occurrence of `$varname` from the template. Wired
   *  to the UNRESOLVED chips so users can one-click drop a name
   *  they accidentally typed (or that an upstream module no longer
   *  binds). Optional — host widgets can skip wiring it if they
   *  don't want the click affordance. */
  onRemoveVar?: (varname: string) => void;
  /** Seed used by the server-side preview resolver. Optional; defaults
   *  to 42 for stable preview rolls. */
  previewSeed?: number;
  /** Litegraph mode — 0=ALWAYS, 2=NEVER (mute), 4=BYPASS. Drives
   *  the dim overlay so muted/bypassed state matches litegraph's
   *  native node-frame dim. */
  nodeMode?: number;
}>();

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const emit = defineEmits<{
  (e: "insertVar", v: string): void;
  /** State-driven minWidth signal. Fires when the formula-computed
   *  required width changes (currently keyed on `missing.length`).
   *  Mount glue updates its tracked dynamicMinWidth + calls
   *  host.requestRelayout. Loop-free: deps are pure Vue reactive
   *  state, no DOM measurements. */
  (e: "requestMinWidth", w: number): void;
}>();

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/** Upstream variable names. */
const upstreamNames = computed(() => props.upstreamVars ?? []);

// Sentinel survives both regex passes — the Unicode replacement character;
// doubled, it can't appear in real prompts.
const ESCAPE_PLACEHOLDER = "��";
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
 * Variables referenced in the template but NOT present in the upstream list.
 */
const missing = computed(() => {
  const upstream = props.upstreamVars ?? [];
  return templateVarsInternal.value.filter((v) => !upstream.includes(v));
});

// ── Formula-driven minWidth ────────────────────────────────────────
// Most assembler content (chip strip, preview, hint) wraps freely so
// width is mostly content-driven. The one state that meaningfully
// shifts the floor is the "X missing" header stat — that lights up
// only when something needs the user's attention, and it pushes the
// section-stat line wider. Adds a small bump so the warning doesn't
// fight with the section title for room.
//
// Pull-based: mount glue reads this through a getter via
// computeLayoutSize. No DOM measurement, no observer feedback.
const requiredMinWidth = computed(() => {
  let w = 320; // base: section labels + chip strip + preview row
  if (missing.value.length > 0) w += 60;
  return w;
});

watch(
  requiredMinWidth,
  (next) => {
    emit("requestMinWidth", next);
  },
  { immediate: true },
);

// ---------------------------------------------------------------------------
// Preview tokenisation
// ---------------------------------------------------------------------------

interface PreviewToken { kind: "literal" | "var"; text: string; varName?: string }

const previewTokens = computed<PreviewToken[]>(() => {
  if (!props.template) return [];

  // Primary path: per-var resolved map. Walk template + look up each $var
  // directly. No boundary-disambiguation needed.
  if (props.resolvedMap !== undefined) {
    const tokens: PreviewToken[] = [];
    let last = 0;
    for (const m of props.template.matchAll(TEMPLATE_VAR_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) tokens.push({ kind: "literal", text: props.template.slice(last, idx) });
      const name = m[1];
      const has = Object.prototype.hasOwnProperty.call(props.resolvedMap, name);
      // Unresolved var → keep `$name` so user sees what's missing.
      tokens.push({
        kind: "var",
        text: has ? props.resolvedMap[name] : `$${name}`,
        varName: name,
      });
      last = idx + m[0].length;
    }
    if (last < props.template.length) {
      tokens.push({ kind: "literal", text: props.template.slice(last) });
    }
    return tokens;
  }

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

    // Legacy fallback — walk template + resolved in parallel. Suffers from
    // boundary-disambiguation bugs (see #12) when one resolved value
    // contains the literal that bounds the next var. Prefer `resolvedMap`.
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

  return [];
});

const isResolved = computed(() => {
  if (props.resolvedMap !== undefined) return Object.keys(props.resolvedMap).length > 0;
  return Boolean(props.resolved);
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

</script>

<template>
  <div class="wp-asm-helper" :class="{ 'wp-asm-helper--skipped': isSkipped }">
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
        :class="['wp-asm-var', 'wp-asm-var--missing', { 'wp-asm-var--clickable': !!onRemoveVar }]"
        :title="onRemoveVar ? `Click to remove $${v} from template` : undefined"
        @click="onRemoveVar?.(v)"
      ><i class="pi pi-exclamation-triangle" aria-hidden="true" />{{ v }}</span>
    </div>

    <!-- preview section -->
    <div class="wp-asm-section">
      <span>preview</span>
      <span :class="['wp-asm-section-stat', isResolved ? 'is-ok' : '']">
        {{ isResolved ? "resolved" : "(template empty or unresolved)" }}
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
      <span style="margin-left: auto;">click missing → remove from template</span>
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
  transition: opacity 120ms ease;
}
/* Mute (mode 2) / bypass (mode 4) — match litegraph's native dim. */
.wp-asm-helper--skipped { opacity: 0.45; }
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
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
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
.wp-asm-var--missing.wp-asm-var--clickable {
  cursor: pointer;
}
.wp-asm-var--missing.wp-asm-var--clickable:hover {
  border-color: var(--wp-warn);
  color: var(--wp-warn);
  background: var(--wp-bg-2);
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

</style>
