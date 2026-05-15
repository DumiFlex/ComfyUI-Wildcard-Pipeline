<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { varColorClass } from "../shared/var-color";
import ContextMenu, { type ContextMenuItem } from "../shared/ContextMenu.vue";
import { kindIcon, type WpKind } from "../shared/kind-icons";

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
   *  don't want the click affordance. Right-click ctxmenu on ANY
   *  chip (upstream or missing) also surfaces this as the "Remove
   *  from template" action so users have one consistent way to
   *  drop a var regardless of its state. */
  onRemoveVar?: (varname: string) => void;
  /** Clear the entire template string. Wired to the toolbar trash
   *  button; optional so headless mounts/tests can skip it. */
  onClearTemplate?: () => void;
  /** Per-var module-kind lookup. When known, each chip renders a
   *  small pi-icon matching the source module's kind (wildcard,
   *  fixed_values, combine, derivation, constraint, pipeline,
   *  injector). Missing entries fall back to no icon. Mount glue
   *  builds this via `collectUpstreamKinds`. */
  kindByVar?: Record<string, string>;
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
  // Ctrl/Cmd + click → remove from template instead of insert. Gives
  // power users a one-handed way to drop a `$var` without opening
  // the ctxmenu. Falls through to insert when modifier not held.
  if ((ev.ctrlKey || ev.metaKey) && props.onRemoveVar && isInTemplate(v)) {
    props.onRemoveVar(v);
    return;
  }
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

/** Pi-icon class for the chip's source kind, or empty string when
 *  the kind isn't known. Injector gets `pi-bolt` since the shared
 *  KIND_ICON_MAP doesn't list it (it's a graph-side var source, not
 *  a library module kind). */
function chipKindIcon(v: string): string {
  const k = props.kindByVar?.[v];
  if (!k) return "";
  if (k === "injector") return "pi pi-bolt";
  return kindIcon(k as WpKind);
}

function rippleStyle(v: string): Record<string, string> {
  const r = ripples.value.get(v);
  if (!r) return {};
  return {
    "--wp-ripple-x": `${r.x}px`,
    "--wp-ripple-y": `${r.y}px`,
  };
}

// ── Right-click ctxmenu on chips ────────────────────────────────────
// Reuses the shared ContextMenu so the affordance matches modules /
// injector / debug rows. Items adapt per chip state (missing chips
// are already in the template; upstream chips may or may not be).
async function clipboardWrite(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* permission denied */ }
}

interface AsmCtxMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  header?: { icon: string; label: string; iconColor?: string };
}
const ctxMenu = ref<AsmCtxMenuState>({ visible: false, x: 0, y: 0, items: [] });
/** Var name whose ctxmenu is currently open — drives the visual
 *  active-chip outline so the user reads which chip the menu is for. */
const ctxActiveVar = ref<string | null>(null);
function closeCtxMenu(): void {
  ctxMenu.value.visible = false;
  ctxActiveVar.value = null;
}

/** True when the var is referenced in the template (so the Remove
 *  item is meaningful). Missing chips are by definition referenced;
 *  upstream chips might not be (user hasn't inserted them yet). */
function isInTemplate(v: string): boolean {
  return templateVarsInternal.value.includes(v);
}

function openChipMenu(ev: MouseEvent, v: string, isMissing: boolean): void {
  ev.preventDefault();
  ev.stopPropagation();
  const estW = 250;
  const estH = 180;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  const inTpl = isInTemplate(v);
  const items: ContextMenuItem[] = [
    {
      label: `Copy $${v}`,
      icon: "pi-copy",
      onSelect: () => { void clipboardWrite(`$${v}`); },
    },
    {
      label: "Insert at caret",
      icon: "pi-plus",
      disabled: isMissing,  // missing chip can't usefully insert — it's already in tpl
      onSelect: () => {
        if (props.onInsert) props.onInsert(`$${v}`);
        emit("insertVar", v);
      },
    },
    {
      label: "Remove from template",
      icon: "pi-trash",
      danger: true,
      disabled: !inTpl || !props.onRemoveVar,
      divider: true,
      onSelect: () => { props.onRemoveVar?.(v); },
    },
  ];
  // Header icon reads from the chip's source kind (wildcard /
  // combine / injector / etc) so the menu surfaces the same visual
  // identity the chip carries. Missing chips have no kind (the var
  // isn't bound by anything upstream) — fall back to warning.
  // `chipKindIcon` returns "pi pi-X" (two-class) per the shared
  // KIND_ICON_MAP convention; ContextMenu's template prepends "pi"
  // again so we strip the leading word.
  const kindCls = chipKindIcon(v);
  const headerIcon = kindCls
    ? (kindCls.split(" ").pop() ?? "pi-tag")
    : (isMissing ? "pi-exclamation-triangle" : "pi-tag");
  ctxActiveVar.value = v;
  ctxMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    items,
    header: {
      icon: headerIcon,
      label: `${isMissing ? "Missing" : "Upstream"} · $${v}`,
    },
  };
}

</script>

<template>
  <div class="wp-asm-helper" :class="{ 'wp-asm-helper--skipped': isSkipped }">
    <Transition name="wp-asm-fade" mode="out-in">
      <!-- Empty-state ghost — surfaces when there's nothing upstream
           AND no template typed. Mirrors the injector ghost shape so
           empty-states across the extension read uniformly. -->
      <div
        v-if="upstreamNames.length === 0 && !props.template"
        key="empty"
        class="wp-asm-empty"
        data-test="asm-empty"
      >
        <i class="pi pi-puzzle-piece wp-asm-empty__icon" aria-hidden="true" />
        <span class="wp-asm-empty__line">No upstream variables yet.</span>
        <span class="wp-asm-empty__hint">Wire a Context / Injector node and type a template above.</span>
      </div>

      <!-- Main content — wrapped in a keyed div so the Transition
           above can mode="out-in" cross-fade between ghost and
           populated states. -->
      <div v-else key="content" class="wp-asm-content">
      <div class="wp-asm-section wp-asm-section--vars">
        <span>variables</span>
        <button
          v-if="onClearTemplate"
          type="button"
          class="wp-asm-clear"
          :disabled="!props.template"
          data-test="asm-clear-template-icon"
          :title="props.template ? 'Clear the entire template' : 'Template already empty'"
          aria-label="Clear template"
          @click="onClearTemplate"
        >
          <i class="pi pi-trash" aria-hidden="true" />
          <span>Clear template</span>
        </button>
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
          :class="['wp-asm-var', varColorClass(v), {
            'wp-asm__chip--ripple': ripples.has(v),
            'wp-asm-var--ctx-active': ctxActiveVar === v,
          }]"
          :style="rippleStyle(v)"
          :title="`Click to insert $${v} at caret · Ctrl+Click to remove · Right-click for more`"
          @click="(ev) => onChipClick(ev, v)"
          @contextmenu="(ev) => openChipMenu(ev, v, false)"
        >
          <i
            v-if="chipKindIcon(v)"
            :class="['wp-asm-var__kind-icon', chipKindIcon(v)]"
            aria-hidden="true"
          />
          <span class="var-tok">{{ v }}</span>
        </span>
        <span
          v-for="v in missing"
          :key="`miss-${v}`"
          :data-test="`asm-chip-${v}`"
          :class="['wp-asm-var', 'wp-asm-var--missing', {
            'wp-asm-var--clickable': !!onRemoveVar,
            'wp-asm-var--ctx-active': ctxActiveVar === v,
          }]"
          :title="onRemoveVar ? `Click to remove $${v} from template · Right-click for more` : undefined"
          @click="onRemoveVar?.(v)"
          @contextmenu="(ev) => openChipMenu(ev, v, true)"
        ><i class="pi pi-exclamation-triangle" aria-hidden="true" />{{ v }}</span>
      </div>

      <!-- preview section -->
      <div class="wp-asm-section">
        <span>preview</span>
        <span :class="['wp-asm-section-stat', isResolved ? 'is-ok' : '']">
          {{ isResolved ? "resolved" : "(template empty or unresolved)" }}
        </span>
      </div>
      <div
        class="wp-asm-preview"
        :class="{ 'wp-asm-preview--empty': !props.template }"
        data-test="asm-preview"
      >
        <Transition name="wp-asm-fade" mode="out-in">
          <div
            v-if="!props.template"
            key="empty"
            class="wp-asm-preview__ghost"
            data-test="asm-preview-empty"
          >
            <i class="pi pi-pencil wp-asm-preview__ghost-icon" aria-hidden="true" />
            <span class="wp-asm-preview__ghost-text">Template empty — click a chip above or type directly into the template field.</span>
          </div>
          <div v-else key="tokens" class="wp-asm-preview__tokens">
            <template v-for="(tok, i) in previewTokens" :key="i">
              <span v-if="tok.kind === 'literal'" class="literal">{{ tok.text }}</span>
              <span v-else :class="['res', varColorClass(tok.varName ?? '')]">{{ tok.text }}</span>
            </template>
          </div>
        </Transition>
      </div>

      <!-- hint -->
      <div class="wp-asm-hint">
        <span>click → insert <kbd>$var</kbd> · <kbd>Ctrl</kbd>+click → remove · right-click → more</span>
        <span style="margin-left: auto;">click missing → remove</span>
      </div>
      </div>
    </Transition>

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      :header="ctxMenu.header"
      @close="closeCtxMenu"
    />
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

/* Clear-template button — sits in the variables section header,
 * centered between the label and the upstream-count stat. Text +
 * icon so the action reads at a glance ("Clear template"). Turns
 * red on hover (destructive). Stays visible-but-disabled when the
 * template is empty so the affordance is always discoverable. */
.wp-asm-section--vars {
  /* 3-column grid lets the clear button center between label
   * (left) and stat (right). Flex + auto-margin couldn't pull
   * off true horizontal centering with two siblings. */
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
}
.wp-asm-section--vars > :first-child { justify-self: start; }
.wp-asm-section--vars > .wp-asm-section-stat {
  margin-left: 0;
  justify-self: end;
}
.wp-asm-clear {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 500 10px var(--wp-font-sans);
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
  white-space: nowrap;
}
.wp-asm-clear:hover:not(:disabled) {
  color: var(--wp-danger);
  border-color: color-mix(in srgb, var(--wp-danger) 45%, transparent);
  background: color-mix(in srgb, var(--wp-danger) 10%, transparent);
}
.wp-asm-clear:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wp-asm-clear .pi { font-size: 10px; }

/* Empty-state ghost — mirrors injector + debug ghosts. Stacked
 * icon + line + hint, dim color, centered. */
.wp-asm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 16px;
  text-align: center;
}
.wp-asm-empty__icon {
  font-size: 28px;
  color: color-mix(in srgb, var(--wp-accent) 65%, var(--wp-text3));
  opacity: 0.65;
}
.wp-asm-empty__line {
  font: 600 12px var(--wp-font-sans);
  color: var(--wp-text2);
}
.wp-asm-empty__hint {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text3);
}

/* Source-kind icon inside upstream chips. Tiny pi-icon (9px) before
 * the var name — tells the user at a glance whether the value comes
 * from a wildcard ⚡, fixed value 🏷️, combine ⛓️, derivation 🔀,
 * constraint 🔻, or an injector wire. Color inherits from the chip
 * so it stays in the var-color palette. */
.wp-asm-var__kind-icon {
  font-size: 9px;
  margin-right: 4px;
  opacity: 0.75;
}

/* Right-click target highlight — same accent ring used by Debug
 * + Module ctxmenu rows. */
.wp-asm-var--ctx-active {
  outline: 1px solid var(--wp-accent);
  outline-offset: 1px;
}

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
/* Tokens wrapper is a block `<div>` (not inline, not display:contents)
 * so the Vue Transition can apply transform/opacity to it. Inline
 * elements ignore transform per CSS spec; `display: contents` makes
 * the element transparent to layout so transforms have nothing to
 * attach to. Block keeps pre-wrap flow working since child spans
 * are still inline inside it. */
.wp-asm-preview__tokens {
  display: block;
  width: 100%;
}

/* Cross-fade between ghost ↔ populated state. Used twice: outer
 * (ghost ↔ helper content) + inner preview (ghost ↔ tokens). Same
 * timing on both for visual coherence. */
.wp-asm-fade-enter-active,
.wp-asm-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.wp-asm-fade-enter-from,
.wp-asm-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
/* Empty-template ghost — same dim italic affordance as the
 * wider empty-state ghost, but lives INSIDE the preview frame so
 * the user reads "preview area exists, just nothing to preview yet"
 * vs the wholly-empty-helper ghost which replaces everything. */
.wp-asm-preview--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-style: italic;
  min-height: 36px;
}
/* Ghost is a flex container with icon as a fixed-width column +
 * text as a flex-grow column. `align-items: flex-start` keeps the
 * icon pinned to the first line of wrapped text instead of vertically
 * centering across the whole block (which made the icon float in
 * the middle of multi-line text). */
.wp-asm-preview__ghost {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
  color: var(--wp-text3);
}
.wp-asm-preview__ghost-icon {
  flex-shrink: 0;
  margin-top: 2px;  /* nudges icon down so it visually centers with the first text line */
  color: color-mix(in srgb, var(--wp-accent) 60%, var(--wp-text3));
}
.wp-asm-preview__ghost-text {
  flex: 1;
  min-width: 0;
}

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
