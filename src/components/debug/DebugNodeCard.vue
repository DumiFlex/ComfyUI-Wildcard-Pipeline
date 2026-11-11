<script setup lang="ts">
/**
 * What one context node (not a Context's modules) gave the chain: the same
 * slim rows as the rest of WP Debug, with the value drawn the way that node
 * works:
 *   loop     — a frame line on top (frame 5 of 18 · seed · sweep combination
 *              · value line), then $iteration / $iteration_total / $iteration_value
 *   model    — Family / Variant / Name in the node's colour, with where each
 *              came from (the model, a file-name rule, a pin …)
 *   toggle   — each switch as ON / OFF, the Pick one value with a radio mark,
 *              an arrow when a variable upstream set it
 *   injector — each wired value with its type (STR / INT / … / TPL)
 * The Variables tab and the Trace tab both draw it.
 */
import { computed } from "vue";
import CopyButton from "@/kit/CopyButton.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import type { Kind, RawDetail, TraceStep, WarningRow } from "./debug-model";

export interface NodeEntry {
  /** Stable key for v-for and pins (`var:<name>` or a step key). */
  key: string;
  name: string;
  value: string;
  internal: boolean;
  /** The node's trace row that wrote it, when the trace has one. */
  step: TraceStep | null;
}

const props = withDefaults(defineProps<{
  kind: Kind;
  entries: NodeEntry[];
  warnings?: WarningRow[];
  uuidToName: Map<string, string>;
  uuidToKind: Map<string, string>;
  flashKey?: string | null;
  activeKey?: string | null;
  pinned?: Set<string>;
  /** Show a button per row that selects the node and blinks that field. */
  canFocus?: boolean;
}>(), { warnings: () => [], flashKey: null, activeKey: null, pinned: () => new Set(), canFocus: false });

const emit = defineEmits<{
  (e: "show-field", name: string): void;
}>();


// ── Loop ───────────────────────────────────────────────────────────────
const loopDetail = computed((): RawDetail | null => {
  for (const e of props.entries) if (e.step?.detail && typeof e.step.detail.frame === "number") return e.step.detail;
  return null;
});
/** The Loop's three variables by role, whatever the iteration name is. */
function loopRole(e: NodeEntry): "iteration" | "total" | "value" {
  if (e.name.endsWith("_value")) return "value";
  if (e.name.endsWith("_total")) return "total";
  return "iteration";
}
/** The frame line: frame, seed, sweep combination, value line. */
const frameParts = computed((): string[] => {
  const d = loopDetail.value;
  if (!d) return [];
  const out = [d.of ? `frame ${d.frame} of ${d.of}` : `frame ${d.frame}`];
  if (d.bypass) out.push("loop bypassed");
  if (typeof d.combo === "number") out.push(`combination ${d.combo} / ${d.combos ?? "?"}`);
  if (typeof d.value_line === "number") out.push(`line ${d.value_line} / ${d.values ?? "?"}`);
  return out;
});
function loopLabel(e: NodeEntry): string {
  const r = loopRole(e);
  return r === "value" ? "value line" : r === "total" ? "frames" : "frame";
}

// ── Toggles ────────────────────────────────────────────────────────────
function isPick(e: NodeEntry): boolean {
  return !!e.step?.source.startsWith("Pick one");
}
/** Pick one mode: the node has a Pick one row. Each pick still writes its
 *  own on/off variable; ON is the one that was picked. */
const pickMode = computed(() => props.kind === "toggle" && props.entries.some(isPick));
function toggleLabel(e: NodeEntry): string {
  if (isPick(e)) return "pick one";
  if (!pickMode.value) return "switch";
  return boolOf(e.value) ? "picked" : "not picked";
}
function isUpstream(e: NodeEntry): boolean {
  return !!e.step?.source.endsWith("set upstream");
}
function boolOf(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  return null;
}

function entryClass(e: NodeEntry): Record<string, boolean> {
  const key = e.step?.key ?? "";
  return {
    "wp-row-flash": !!key && props.flashKey === key,
    "is-ctx": props.activeKey === e.key,
    "is-internal": e.internal,
  };
}
</script>

<template>
  <div class="wp-dbg-nc" :class="`wp-dbg-nc--${kind}`" :data-kind="kind" data-test="dbg-node-card">
    <div v-if="kind === 'loop' && frameParts.length" class="wp-dbg-nc__frame" data-test="dbg-loop-frame">
      <span v-for="(p, i) in frameParts" :key="i" class="wp-dbg-nc__frame-part" :class="{ 'is-lead': i === 0 }">{{ p }}</span>
      <CopyButton
        v-if="typeof loopDetail?.seed === 'number'"
        :text="String(loopDetail.seed)"
        label="Copy this frame's seed"
        size="sm"
        variant="ghost"
        class="wp-dbg-nc__seed"
      ><span class="wp-dbg-nc__seed-label">seed</span>{{ loopDetail.seed }}</CopyButton>
    </div>

    <div
      v-for="e in entries"
      :key="e.key"
      class="wp-dbg-nc__row"
      :class="entryClass(e)"
      :data-step-key="e.step?.key"
      data-test="dbg-node-entry"
    >
      <div class="wp-dbg-nc__name">
        <code>${{ e.name }}</code>
        <i v-if="e.internal" class="pi pi-eye-slash wp-dbg-nc__flag" title="Internal: kept out of the prompt" />
      </div>

      <!-- Toggles: a switch reads ON / OFF; Pick one reads its value -->
      <div v-if="kind === 'toggle' && !isPick(e) && boolOf(e.value) !== null" class="wp-dbg-nc__value">
        <span class="wp-dbg-nc__switch" :class="boolOf(e.value) ? 'is-on' : 'is-off'" data-test="dbg-node-switch">
          <span class="wp-dbg-nc__knob" aria-hidden="true" />{{ boolOf(e.value) ? "ON" : "OFF" }}
        </span>
      </div>
      <div v-else class="wp-dbg-nc__value" :class="{ 'is-model': kind === 'model' }">
        <i v-if="kind === 'toggle' && isPick(e)" class="pi pi-circle-on wp-dbg-nc__radio" title="Pick one" aria-hidden="true" />
        <template v-if="kind === 'model'">
          <span v-if="e.value">{{ e.value }}</span>
          <span v-else class="wp-dbg-nc__empty">not detected</span>
        </template>
        <template v-else>
          <RichTextPreview v-if="e.value" :value="e.value" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
          <span v-else class="wp-dbg-nc__empty">{{ kind === 'toggle' && isPick(e) ? "nothing picked" : "empty" }}</span>
        </template>
      </div>

      <div class="wp-dbg-nc__meta">
        <i v-if="kind === 'toggle' && isUpstream(e)" class="pi pi-arrow-down-left wp-dbg-nc__up" title="Set by an upstream variable" />
        <span v-if="kind === 'injector' && e.step?.valueType" class="wp-dbg-nc__type" :title="e.step.isTemplate ? 'Template filled from the node\'s inputs' : 'Value type on the wire'">{{ e.step.isTemplate ? "TPL" : e.step.valueType }}</span>
        <span v-else-if="kind === 'model' && e.step?.source" class="wp-dbg-nc__src" data-test="dbg-node-source">{{ e.step.source }}</span>
        <span v-else-if="kind === 'toggle'" class="wp-dbg-nc__src">{{ toggleLabel(e) }}</span>
        <span v-else-if="kind === 'loop'" class="wp-dbg-nc__src">{{ loopLabel(e) }}</span>
        <WpIconButton
          v-if="canFocus"
          class="wp-dbg-nc__show"
          icon="pi-arrow-up-right"
          :label="`Show $${e.name} on the node`"
          data-test="dbg-node-show"
          @click="emit('show-field', e.name)"
        />
      </div>
    </div>

    <!-- Warnings this node raised -->
    <div v-for="w in warnings" :key="w.key" class="wp-dbg-nc__warn" :class="`is-${w.severity}`" data-test="dbg-node-warning">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      <span class="wp-dbg-nc__warn-label">{{ w.label }}</span>
      <span class="wp-dbg-nc__warn-msg">{{ w.message }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Same metrics as the Variables rows; the node's colour rides the left edge,
   the frame line and the value accents only. */
.wp-dbg-nc { display: flex; flex-direction: column; --wp-dbg-nc-c: var(--wp-dbg-kind, var(--wp-accent)); }
.wp-dbg-nc__row {
  display: grid;
  grid-template-columns: max(90px, var(--wp-dbg-name-w, 90px)) minmax(0, 1fr) auto;
  column-gap: 12px;
  align-items: start;
  padding: 5px 6px;
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
  font-size: 11.5px;
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--wp-dbg-nc-c) 70%, transparent);
}
.wp-dbg-nc__row:hover { background: var(--wp-row-hover, var(--wp-bg2)); }
.wp-dbg-nc__row.is-ctx { outline: 1px solid var(--wp-accent); outline-offset: -1px; }
.wp-dbg-nc__name { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.wp-dbg-nc__name code { font: 600 11.5px/1.5 var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); overflow-wrap: anywhere; }
.wp-dbg-nc__row.is-internal .wp-dbg-nc__name code { color: var(--wp-text-muted); }
.wp-dbg-nc__flag { font-size: 9px; color: var(--wp-text-dim); }
.wp-dbg-nc__value { display: flex; align-items: baseline; gap: 5px; min-width: 0; color: var(--wp-text); line-height: 1.5; word-break: break-word; }
.wp-dbg-nc__value.is-model { font: 600 11.5px/1.5 var(--wp-font-mono); color: var(--wp-dbg-nc-c); }
.wp-dbg-nc__empty { font: italic 400 11px/1.5 var(--wp-font-sans); color: var(--wp-text-dim); }
.wp-dbg-nc__meta { display: inline-flex; align-items: center; gap: 5px; padding-top: 1px; }
.wp-dbg-nc__src { font: 500 10.5px/1.5 var(--wp-font-sans); color: var(--wp-text-dim); white-space: nowrap; }
.wp-dbg-nc__show { opacity: 0; transition: opacity var(--wp-motion-fast, 120ms) ease; }
.wp-dbg-nc__row:hover .wp-dbg-nc__show,
.wp-dbg-nc__show:focus-visible { opacity: 1; }

/* Loop frame line */
.wp-dbg-nc__frame {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px;
  padding: 3px 6px;
  font: 500 10.5px/1.6 var(--wp-font-sans);
  color: var(--wp-text-dim);
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--wp-dbg-nc-c) 70%, transparent);
}
.wp-dbg-nc__frame-part.is-lead { color: var(--wp-dbg-nc-c); font-weight: 600; }
.wp-copy-btn.wp-dbg-nc__seed {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 4px;
  height: auto; min-height: 0;
  background: transparent; border: 0; padding: 0;
  color: var(--wp-text-muted);
  font: 500 10.5px/1.6 var(--wp-font-mono);
  cursor: pointer;
}
.wp-copy-btn.wp-dbg-nc__seed:hover { color: var(--wp-text); }
.wp-dbg-nc__seed-label { color: var(--wp-text-dim); font-family: var(--wp-font-sans); }

/* Toggles */
.wp-dbg-nc__switch { display: inline-flex; align-items: center; gap: 5px; font: 700 10px/1.5 var(--wp-font-sans); letter-spacing: 0.04em; color: var(--wp-text-dim); }
.wp-dbg-nc__switch.is-on { color: var(--wp-dbg-nc-c); }
.wp-dbg-nc__knob {
  position: relative; width: 18px; height: 10px; flex: none; align-self: center;
  border-radius: min(5px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-4, var(--wp-border-strong));
}
.wp-dbg-nc__knob::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 6px; height: 6px;
  border-radius: min(50%, var(--wp-radius-cap, 999px));
  background: var(--wp-text-dim);
}
.wp-dbg-nc__switch.is-on .wp-dbg-nc__knob { background: color-mix(in oklab, var(--wp-dbg-nc-c) 70%, transparent); }
.wp-dbg-nc__switch.is-on .wp-dbg-nc__knob::after { left: 10px; background: var(--wp-bg); }
.wp-dbg-nc__radio { font-size: 9px; color: var(--wp-dbg-nc-c); align-self: center; }
.wp-dbg-nc__up { font-size: 9px; color: var(--wp-dbg-nc-c); }

/* Injector */
.wp-dbg-nc__type {
  font: 600 9px/1 var(--wp-font-mono);
  padding: 3px 5px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  color: var(--wp-dbg-nc-c);
  background: color-mix(in oklab, var(--wp-dbg-nc-c) 14%, transparent);
}

/* Warnings */
.wp-dbg-nc__warn {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px;
  padding: 3px 6px 4px;
  font-size: 10.5px; color: var(--wp-warn);
  box-shadow: inset 2px 0 0 var(--wp-warn);
}
.wp-dbg-nc__warn.is-error { color: var(--wp-red); box-shadow: inset 2px 0 0 var(--wp-red); }
.wp-dbg-nc__warn.is-info { color: var(--wp-text-muted); box-shadow: inset 2px 0 0 var(--wp-border-strong, var(--wp-border)); }
.wp-dbg-nc__warn .pi { font-size: 9px; }
.wp-dbg-nc__warn-label { font-weight: 600; }
.wp-dbg-nc__warn-msg { color: var(--wp-text-muted); }
</style>
