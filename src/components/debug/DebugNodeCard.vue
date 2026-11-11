<script setup lang="ts">
/**
 * What one context node (not a Context's modules) gave the chain, drawn the
 * way that node works rather than as generic module rows:
 *   loop     — the frame: "frame 5 of 18" bar, frame seed, sweep combination,
 *              value line, then $iteration / $iteration_total / $iteration_value
 *   model    — the detected model as fields (Family / Variant / Name), each
 *              with where it came from (the model, a file-name rule, a pin …)
 *   toggle   — each switch as ON / OFF, the Pick one value as the picked row,
 *              "set upstream" when a variable upstream set it
 *   injector — each wired value with its type (STR / INT / … / TPL)
 * The Variables tab and the Trace tab both draw it, from the final values or
 * from the node's own trace rows.
 */
import { computed } from "vue";
import ProgressBar from "@/kit/ProgressBar.vue";
import CopyButton from "@/kit/CopyButton.vue";
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
}>(), { warnings: () => [], flashKey: null, activeKey: null, pinned: () => new Set() });


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
const loopNumbers = computed(() => props.entries.filter((e) => loopRole(e) !== "value"));
const loopValues = computed(() => props.entries.filter((e) => loopRole(e) === "value"));

// ── Model Info ─────────────────────────────────────────────────────────
const MODEL_FIELDS: Record<string, string> = {
  model_family: "Family",
  model_variant: "Variant",
  model_name: "Name",
};
function modelLabel(e: NodeEntry): string {
  return MODEL_FIELDS[e.name] ?? e.name;
}

// ── Toggles ────────────────────────────────────────────────────────────
function isPick(e: NodeEntry): boolean {
  return !!e.step?.source.startsWith("Pick one");
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
const switches = computed(() => props.entries.filter((e) => !isPick(e)));
const picks = computed(() => props.entries.filter((e) => isPick(e)));

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
    <!-- ── Context Loop ── -->
    <template v-if="kind === 'loop'">
      <div v-if="loopDetail" class="wp-dbg-nc__frame" data-test="dbg-loop-frame">
        <div class="wp-dbg-nc__frame-head">
          <span class="wp-dbg-nc__frame-title">Frame <b>{{ loopDetail.frame }}</b><template v-if="loopDetail.of"> of {{ loopDetail.of }}</template></span>
          <span v-if="loopDetail.bypass" class="wp-dbg-nc__tag">loop bypassed</span>
          <span v-if="typeof loopDetail.combo === 'number'" class="wp-dbg-nc__tag" title="Which sweep combination this frame ran">
            <i class="pi pi-th-large" aria-hidden="true" /> combination {{ loopDetail.combo }} / {{ loopDetail.combos }}
          </span>
          <span v-if="typeof loopDetail.value_line === 'number'" class="wp-dbg-nc__tag" title="Which line of the wired values this frame used">
            <i class="pi pi-list" aria-hidden="true" /> line {{ loopDetail.value_line }} / {{ loopDetail.values }}
          </span>
          <CopyButton
            v-if="typeof loopDetail.seed === 'number'"
            :text="String(loopDetail.seed)"
            label="Copy this frame's seed"
            size="sm"
            variant="ghost"
            class="wp-dbg-nc__seed"
          ><span class="wp-dbg-nc__seed-label">seed</span>{{ loopDetail.seed }}</CopyButton>
        </div>
        <ProgressBar
          v-if="loopDetail.of && loopDetail.of > 1"
          :value="loopDetail.frame"
          :max="loopDetail.of"
          size="sm"
          :label="`Frame ${loopDetail.frame} of ${loopDetail.of}`"
          class="wp-dbg-nc__bar"
        />
      </div>
      <div v-if="loopNumbers.length" class="wp-dbg-nc__stats">
        <div
          v-for="e in loopNumbers"
          :key="e.key"
          class="wp-dbg-nc__stat"
          :class="entryClass(e)"
          :data-step-key="e.step?.key"
          data-test="dbg-node-entry"
        >
          <span class="wp-dbg-nc__stat-value">{{ e.value || "—" }}</span>
          <code class="wp-dbg-nc__var">${{ e.name }}</code>
          <i v-if="e.internal" class="pi pi-eye-slash wp-dbg-nc__flag" title="Internal: kept out of the prompt" />
        </div>
      </div>
      <div
        v-for="e in loopValues"
        :key="e.key"
        class="wp-dbg-nc__line"
        :class="entryClass(e)"
        :data-step-key="e.step?.key"
        data-test="dbg-node-entry"
      >
        <code class="wp-dbg-nc__var">${{ e.name }}</code>
        <RichTextPreview v-if="e.value" :value="e.value" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
        <span v-else class="wp-dbg-nc__empty">empty</span>
      </div>
    </template>

    <!-- ── Model Info ── -->
    <div v-else-if="kind === 'model'" class="wp-dbg-nc__fields">
      <div
        v-for="e in entries"
        :key="e.key"
        class="wp-dbg-nc__field"
        :class="entryClass(e)"
        :data-step-key="e.step?.key"
        data-test="dbg-node-entry"
      >
        <span class="wp-dbg-nc__field-label">{{ modelLabel(e) }}</span>
        <span class="wp-dbg-nc__field-value" :class="{ 'is-empty': !e.value }" :title="e.value">{{ e.value || "not detected" }}</span>
        <span class="wp-dbg-nc__field-foot">
          <code class="wp-dbg-nc__var">${{ e.name }}</code>
          <span v-if="e.step?.source" class="wp-dbg-nc__src" data-test="dbg-node-source">{{ e.step.source }}</span>
          <i v-if="e.internal" class="pi pi-eye-slash wp-dbg-nc__flag" title="Internal: kept out of the prompt" />
        </span>
      </div>
    </div>

    <!-- ── Toggles ── -->
    <template v-else-if="kind === 'toggle'">
      <div v-if="switches.length" class="wp-dbg-nc__switches">
        <div
          v-for="e in switches"
          :key="e.key"
          class="wp-dbg-nc__switch"
          :class="[entryClass(e), boolOf(e.value) === true ? 'is-on' : boolOf(e.value) === false ? 'is-off' : 'is-other']"
          :data-step-key="e.step?.key"
          data-test="dbg-node-entry"
        >
          <span class="wp-dbg-nc__knob" aria-hidden="true" />
          <span class="wp-dbg-nc__switch-state">{{ boolOf(e.value) === true ? "ON" : boolOf(e.value) === false ? "OFF" : e.value || "—" }}</span>
          <code class="wp-dbg-nc__var">${{ e.name }}</code>
          <i v-if="isUpstream(e)" class="pi pi-arrow-down-left wp-dbg-nc__up" title="Set by an upstream variable" />
        </div>
      </div>
      <div
        v-for="e in picks"
        :key="e.key"
        class="wp-dbg-nc__line wp-dbg-nc__pick"
        :class="entryClass(e)"
        :data-step-key="e.step?.key"
        data-test="dbg-node-entry"
      >
        <i class="pi pi-circle-on wp-dbg-nc__radio" aria-hidden="true" />
        <span class="wp-dbg-nc__pick-label">Pick one</span>
        <code class="wp-dbg-nc__var">${{ e.name }}</code>
        <span class="wp-dbg-nc__eq">=</span>
        <RichTextPreview v-if="e.value" :value="e.value" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
        <span v-else class="wp-dbg-nc__empty">nothing picked</span>
        <span v-if="isUpstream(e)" class="wp-dbg-nc__src">set upstream</span>
      </div>
    </template>

    <!-- ── Context Injector (and anything else a node wrote) ── -->
    <template v-else>
      <div
        v-for="e in entries"
        :key="e.key"
        class="wp-dbg-nc__line"
        :class="entryClass(e)"
        :data-step-key="e.step?.key"
        data-test="dbg-node-entry"
      >
        <span v-if="e.step?.valueType" class="wp-dbg-nc__type" :title="e.step.isTemplate ? 'Template filled from the node\'s inputs' : 'Value type on the wire'">{{ e.step.isTemplate ? "TPL" : e.step.valueType }}</span>
        <code class="wp-dbg-nc__var">${{ e.name }}</code>
        <span class="wp-dbg-nc__eq">=</span>
        <RichTextPreview v-if="e.value" :value="e.value" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
        <span v-else class="wp-dbg-nc__empty">empty</span>
        <i v-if="e.internal" class="pi pi-eye-slash wp-dbg-nc__flag" title="Internal: kept out of the prompt" />
      </div>
    </template>

    <!-- Warnings this node raised -->
    <div v-for="w in warnings" :key="w.key" class="wp-dbg-nc__warn" :class="`is-${w.severity}`" data-test="dbg-node-warning">
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      <span class="wp-dbg-nc__warn-label">{{ w.label }}</span>
      <span v-if="w.detailText" class="wp-dbg-nc__warn-detail">{{ w.detailText }}</span>
      <span class="wp-dbg-nc__warn-msg">{{ w.message }}</span>
    </div>

  </div>
</template>

<style scoped>
.wp-dbg-nc {
  --wp-dbg-nc-c: var(--wp-dbg-kind, var(--wp-accent));
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 8px 7px 10px;
  border: 1px solid color-mix(in oklab, var(--wp-dbg-nc-c) 28%, var(--wp-border));
  border-left: 3px solid var(--wp-dbg-nc-c);
  border-radius: min(5px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-dbg-nc-c) 6%, transparent);
  font-size: 11.5px;
}
.wp-dbg-nc__var { font: 600 10.5px/1.4 var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-nc .is-internal .wp-dbg-nc__var { color: var(--wp-text-muted); }
.wp-dbg-nc__flag { font-size: 9px; color: var(--wp-text-dim); }
.wp-dbg-nc__empty { font-style: italic; color: var(--wp-text-dim); }
.wp-dbg-nc__eq { color: var(--wp-text-dim); }
.wp-dbg-nc .is-ctx { outline: 1px solid var(--wp-accent); outline-offset: 1px; }
.wp-dbg-nc__tag {
  display: inline-flex; align-items: center; gap: 4px;
  font: 500 10px/1.5 var(--wp-font-sans);
  padding: 0 6px;
  border-radius: var(--wp-radius-cap, 999px);
  color: var(--wp-dbg-nc-c);
  background: color-mix(in oklab, var(--wp-dbg-nc-c) 14%, transparent);
}
.wp-dbg-nc__tag .pi { font-size: 9px; }
.wp-dbg-nc__src {
  font: 500 9.5px/1.5 var(--wp-font-sans);
  color: var(--wp-dbg-nc-c);
}

/* Loop */
.wp-dbg-nc__frame { display: flex; flex-direction: column; gap: 4px; }
.wp-dbg-nc__frame-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.wp-dbg-nc__frame-title { font: 500 12px/1.4 var(--wp-font-sans); color: var(--wp-text); }
.wp-dbg-nc__frame-title b { color: var(--wp-dbg-nc-c); font-weight: 700; }
.wp-copy-btn.wp-dbg-nc__seed {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 3px);
  color: var(--wp-text);
  font: 500 10.5px/1.6 var(--wp-font-mono);
  padding: 0 7px;
  cursor: pointer;
}
.wp-copy-btn.wp-dbg-nc__seed:hover { border-color: var(--wp-border-strong, var(--wp-accent)); }
.wp-dbg-nc__seed-label { color: var(--wp-text-dim); margin-right: 4px; font-family: var(--wp-font-sans); }
.wp-dbg-nc__bar { --wp-accent: var(--wp-dbg-nc-c); }
.wp-dbg-nc__stats { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-dbg-nc__stat {
  display: inline-flex; align-items: baseline; gap: 6px;
  padding: 2px 8px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2, var(--wp-bg2));
}
.wp-dbg-nc__stat-value { font: 700 13px/1.3 var(--wp-font-mono); color: var(--wp-text); }

/* Lines (Loop value, Pick one, Injector) */
.wp-dbg-nc__line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; min-width: 0; word-break: break-word; }

/* Model Info */
.wp-dbg-nc__fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px; }
.wp-dbg-nc__field {
  display: flex; flex-direction: column; gap: 1px; min-width: 0;
  padding: 4px 8px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2, var(--wp-bg2));
}
.wp-dbg-nc__field-label { font: 600 9px/1.4 var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.05em; color: var(--wp-text-dim); }
.wp-dbg-nc__field-value {
  font: 700 12.5px/1.35 var(--wp-font-mono); color: var(--wp-dbg-nc-c);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-dbg-nc__field-value.is-empty { font: italic 400 11px/1.35 var(--wp-font-sans); color: var(--wp-text-dim); }
.wp-dbg-nc__field-foot { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; }
.wp-dbg-nc__field-foot .wp-dbg-nc__var { font-size: 9.5px; color: var(--wp-text-muted); }

/* Toggles */
.wp-dbg-nc__switches { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-dbg-nc__switch {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px 2px 3px;
  border-radius: min(10px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2, var(--wp-bg2));
}
.wp-dbg-nc__knob {
  position: relative; width: 22px; height: 12px; flex: none;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-4, var(--wp-border-strong));
}
.wp-dbg-nc__knob::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px;
  border-radius: min(50%, var(--wp-radius-cap, 999px));
  background: var(--wp-text-dim);
}
.wp-dbg-nc__switch.is-on .wp-dbg-nc__knob { background: color-mix(in oklab, var(--wp-dbg-nc-c) 70%, transparent); }
.wp-dbg-nc__switch.is-on .wp-dbg-nc__knob::after { left: 12px; background: var(--wp-text); }
.wp-dbg-nc__switch-state { font: 700 9.5px/1 var(--wp-font-sans); letter-spacing: 0.04em; color: var(--wp-text-dim); min-width: 22px; }
.wp-dbg-nc__switch.is-on .wp-dbg-nc__switch-state { color: var(--wp-dbg-nc-c); }
.wp-dbg-nc__up { font-size: 9px; color: var(--wp-dbg-nc-c); }
.wp-dbg-nc__radio { font-size: 10px; color: var(--wp-dbg-nc-c); align-self: center; }
.wp-dbg-nc__pick-label { font: 600 9.5px/1.4 var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.05em; color: var(--wp-text-dim); }

/* Injector */
.wp-dbg-nc__type {
  font: 600 9px/1 var(--wp-font-mono);
  padding: 3px 5px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  color: var(--wp-dbg-nc-c);
  background: color-mix(in oklab, var(--wp-dbg-nc-c) 14%, transparent);
  align-self: center;
}

/* Warnings */
.wp-dbg-nc__warn { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; font-size: 10.5px; color: var(--wp-warn); }
.wp-dbg-nc__warn.is-error { color: var(--wp-red); }
.wp-dbg-nc__warn.is-info { color: var(--wp-text-muted); }
.wp-dbg-nc__warn .pi { font-size: 9px; }
.wp-dbg-nc__warn-label { font-weight: 600; }
.wp-dbg-nc__warn-detail, .wp-dbg-nc__warn-msg { color: var(--wp-text-muted); }

</style>
