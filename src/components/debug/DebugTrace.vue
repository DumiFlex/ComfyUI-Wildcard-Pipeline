<script setup lang="ts">
/**
 * Trace tab: every module and injector row in run order, grouped by the
 * Context node that ran it. A row says what the step wrote; clicking it
 * opens DebugStepDetail with the reasons.
 */
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import DebugStepDetail from "./DebugStepDetail.vue";
import type { NodeInfo, TraceGroup, TraceStep, WarningRow } from "./debug-model";

const props = defineProps<{
  groups: TraceGroup[];
  showGroupHeads: boolean;
  expanded: Set<string>;
  pinned: Set<string>;
  flashKey: string | null;
  warningsByStep: Map<string, WarningRow[]>;
  uuidToName: Map<string, string>;
  uuidToKind: Map<string, string>;
  nodeInfo: (nodeId: string) => NodeInfo;
  canFocus: boolean;
  ctxActiveKey: string | null;
}>();
const emit = defineEmits<{
  (e: "toggle", key: string): void;
  (e: "goto-step", key: string): void;
  (e: "row-menu", ev: MouseEvent, step: TraceStep): void;
  (e: "copy", text: string): void;
  (e: "focus-node", nodeId: string): void;
}>();

function title(s: TraceStep): string {
  if (s.name) return s.name;
  if (s.kind === "constraint") return "constraint";
  if (s.bindings.length) return `$${s.bindings[0]}`;
  return s.id ? s.id.slice(0, 8) : "—";
}

function refName(uuid: string): string {
  return props.uuidToName.get(uuid) ?? uuid.slice(0, 8);
}

function groupLabel(g: TraceGroup): string {
  if (!g.nodeId) return "Chain";
  return props.nodeInfo(g.nodeId).title || `Node ${g.nodeId}`;
}
</script>

<template>
  <div class="wp-dbg-trace" data-test="dbg-trace">
    <section v-for="(g, gi) in groups" :key="`${g.nodeId}:${gi}`" class="wp-dbg-group">
      <header v-if="showGroupHeads" class="wp-dbg-group__head" data-test="dbg-group-head">
        <span class="wp-dbg-group__title">{{ groupLabel(g) }}</span>
        <span v-if="g.nodeId && nodeInfo(g.nodeId).codename" class="wp-dbg-group__codename" title="This node's codename">{{ nodeInfo(g.nodeId).codename }}</span>
        <span v-if="g.nodeId" class="wp-dbg-group__id">#{{ g.nodeId }}</span>
        <span v-if="g.seed" class="wp-dbg-group__seed" title="Chain seed this node ran with">seed {{ g.seed }}</span>
        <button
          v-if="canFocus && g.nodeId"
          type="button"
          class="wp-dbg-group__focus"
          title="Select this node on the canvas"
          @click="emit('focus-node', g.nodeId)"
        ><i class="pi pi-arrow-up-right" aria-hidden="true" /></button>
      </header>
      <div
        v-for="s in g.steps"
        :key="s.key"
        class="wp-dbg-step"
        :class="[
          `is-${s.status}`,
          {
            'is-open': expanded.has(s.key),
            'wp-row-flash': flashKey === s.key,
            'is-ctx': ctxActiveKey === s.key,
          },
        ]"
        :data-step-key="s.key"
        data-test="dbg-step"
      >
        <div
          class="wp-dbg-step__row"
          role="button"
          tabindex="0"
          :aria-expanded="expanded.has(s.key)"
          :title="s.id ? `module ${s.id}` : ''"
          @click="emit('toggle', s.key)"
          @keydown.enter.prevent="emit('toggle', s.key)"
          @keydown.space.prevent="emit('toggle', s.key)"
          @contextmenu="(ev) => emit('row-menu', ev, s)"
        >
          <span class="wp-dbg-step__order">{{ s.order }}</span>
          <span class="wp-kind-chip wp-dbg-step__kind" :class="`wp-kind-chip--${s.kind === 'unknown' ? 'unknown' : s.kind}`">{{ s.kindLabel }}</span>
          <span class="wp-dbg-step__title" :title="title(s)">
            <i v-if="pinned.has(s.key)" class="pi pi-star-fill wp-dbg-pin" aria-label="pinned" />
            <span class="wp-dbg-step__title-text">{{ title(s) }}</span>
            <i v-if="s.internal" class="pi pi-eye-slash wp-dbg-flag" title="Internal: kept out of the prompt" />
            <i v-if="s.seedLocked" class="pi pi-lock wp-dbg-flag" title="Rolled with a locked seed" />
          </span>
          <span class="wp-dbg-step__sum">
            <template v-if="s.constraint">
              <code>${{ refName(s.constraint.source) }}</code>
              <span class="wp-dbg-step__arrow">→</span>
              <code>${{ refName(s.constraint.target) }}</code>
            </template>
            <template v-else-if="s.writes.length">
              <code>${{ s.writes[0].variable }}</code>
              <span class="wp-dbg-step__arrow">=</span>
              <span class="wp-dbg-step__val">
                <RichTextPreview
                  v-if="s.writes[0].value"
                  :value="s.writes[0].value"
                  :uuid-to-name="uuidToName"
                  :uuid-to-kind="uuidToKind"
                  surface="wildcard"
                />
                <span v-else class="wp-dbg-step__empty">empty</span>
              </span>
              <span v-if="s.writes.length > 1" class="wp-dbg-step__more">+{{ s.writes.length - 1 }}</span>
            </template>
            <template v-else-if="s.bindings.length && s.status !== 'ok'">
              <code>${{ s.bindings.join(", $") }}</code>
            </template>
          </span>
          <span class="wp-dbg-step__badges">
            <span v-if="s.valueType" class="wp-dbg-badge" :title="s.isTemplate ? 'Template rendered from $slot values' : 'Value type on the wire'">{{ s.isTemplate ? "TPL" : s.valueType }}</span>
            <span
              v-if="typeof s.detail?.chance === 'number' && s.detail.chance < 0.995"
              class="wp-dbg-badge"
              title="Odds of the option that was picked"
            >{{ Math.round(s.detail.chance * 100) }}%</span>
            <span v-if="s.warningCount" class="wp-dbg-badge wp-dbg-badge--warn" :title="`${s.warningCount} warning${s.warningCount === 1 ? '' : 's'}`">
              <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ s.warningCount }}
            </span>
            <span v-if="s.status !== 'ok'" class="wp-dbg-status" :class="`is-${s.status}`" data-test="dbg-status">{{ s.statusLabel }}</span>
          </span>
          <i class="pi pi-chevron-right wp-dbg-step__chev" aria-hidden="true" />
        </div>
        <div v-if="expanded.has(s.key)" class="wp-dbg-step__detail">
          <div v-if="s.writes.length > 1" class="wp-dbg-step__writes">
            <div v-for="(w, wi) in s.writes" :key="wi" class="wp-dbg-step__write">
              <code>${{ w.variable }}</code>
              <span class="wp-dbg-step__arrow">=</span>
              <RichTextPreview
                v-if="w.value"
                :value="w.value"
                :uuid-to-name="uuidToName"
                :uuid-to-kind="uuidToKind"
                surface="wildcard"
              />
              <span v-else class="wp-dbg-step__empty">empty</span>
              <span v-if="w.overwrite" class="wp-dbg-step__more" title="Replaced an earlier value">↻</span>
            </div>
          </div>
          <div v-else-if="s.writes.length === 1 && s.writes[0].value.length > 60" class="wp-dbg-step__full">
            <RichTextPreview
              :value="s.writes[0].value"
              :uuid-to-name="uuidToName"
              :uuid-to-kind="uuidToKind"
              surface="wildcard"
            />
          </div>
          <DebugStepDetail
            :step="s"
            :warnings="warningsByStep.get(s.key) ?? []"
            :uuid-to-name="uuidToName"
            :uuid-to-kind="uuidToKind"
            :can-focus="canFocus"
            @copy="(t) => emit('copy', t)"
            @goto-step="(k) => emit('goto-step', k)"
            @focus-node="(id) => emit('focus-node', id)"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wp-dbg-trace { display: flex; flex-direction: column; gap: 8px; }
.wp-dbg-group { display: flex; flex-direction: column; }
.wp-dbg-group__head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 4px;
  font-size: 10px;
  color: var(--wp-text-dim);
}
.wp-dbg-group__title { font: 600 11px/1.4 var(--wp-font-sans); color: var(--wp-text); }
.wp-dbg-group__id, .wp-dbg-group__seed { font-family: var(--wp-font-mono); }
.wp-dbg-group__codename {
  font: 500 10px/1.5 var(--wp-font-mono);
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
}
.wp-dbg-group__focus {
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--wp-text-dim);
  cursor: pointer;
  padding: 0 2px;
}
.wp-dbg-group__focus:hover { color: var(--wp-text); }
.wp-dbg-group__focus .pi { font-size: 10px; }
.wp-dbg-step {
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
}
.wp-dbg-step:first-of-type { border-top-color: var(--wp-border); }
.wp-dbg-step.is-open { background: color-mix(in oklab, var(--wp-bg-deep, var(--wp-bg)) 70%, transparent); }
.wp-dbg-step.is-ctx .wp-dbg-step__row { outline: 1px solid var(--wp-accent); outline-offset: -1px; }
.wp-dbg-step__row {
  display: grid;
  grid-template-columns: 18px 68px minmax(70px, 130px) minmax(0, 1fr) auto 12px;
  align-items: center;
  column-gap: 8px;
  padding: 5px 6px;
  cursor: pointer;
  min-height: 26px;
}
.wp-dbg-step__row:hover { background: var(--wp-row-hover, var(--wp-bg2)); }
.wp-dbg-step__row:focus-visible { outline: 1px solid var(--wp-accent); outline-offset: -1px; }
.wp-dbg-step__order { font: 500 9px/1 var(--wp-font-mono); color: var(--wp-text-dim); text-align: right; }
.wp-dbg-step__kind { font-size: 9px; justify-self: start; }
.wp-dbg-step__title {
  font: 600 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text);
  white-space: nowrap;
  overflow: hidden;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-dbg-step__title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wp-dbg-flag { font-size: 9px; color: var(--wp-text-dim); }
.wp-dbg-pin { font-size: 9px; color: var(--wp-amber, var(--wp-warn)); }
.wp-dbg-step__sum {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 11px;
  color: var(--wp-text-muted);
}
.wp-dbg-step__sum code, .wp-dbg-step__write code {
  font-family: var(--wp-font-mono);
  color: var(--wp-accent-text, var(--wp-accent));
  flex: none;
}
.wp-dbg-step__arrow { color: var(--wp-text-dim); flex: none; }
.wp-dbg-step__val { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The row is a one-line summary; the full value lives in the detail. */
.wp-dbg-step__val :deep(*) { white-space: nowrap; }
.wp-dbg-step__empty { font-style: italic; color: var(--wp-text-dim); }
.wp-dbg-step__more { font: 500 9px/1 var(--wp-font-mono); color: var(--wp-text-dim); flex: none; }
.wp-dbg-step__badges { display: inline-flex; align-items: center; gap: 4px; }
.wp-dbg-badge {
  font: 600 9px/1 var(--wp-font-mono);
  padding: 3px 5px;
  border-radius: 999px;
  background: var(--wp-bg-2, var(--wp-bg2));
  color: var(--wp-text-dim);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.wp-dbg-badge .pi { font-size: 8px; }
.wp-dbg-badge--warn { background: color-mix(in oklab, var(--wp-warn) 18%, transparent); color: var(--wp-warn); }
.wp-dbg-status {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 6px;
  border-radius: 3px;
  color: var(--wp-text-dim);
  background: var(--wp-bg-2, var(--wp-bg2));
}
.wp-dbg-status.is-error { color: var(--wp-red, #e5484d); background: color-mix(in oklab, var(--wp-red, #e5484d) 16%, transparent); }
.wp-dbg-status.is-never { color: var(--wp-warn); background: color-mix(in oklab, var(--wp-warn) 16%, transparent); }
.wp-dbg-step.is-off .wp-dbg-step__row, .wp-dbg-step.is-frame .wp-dbg-step__row { opacity: 0.55; }
.wp-dbg-step.is-error { box-shadow: inset 2px 0 0 var(--wp-red, #e5484d); }
.wp-dbg-step__chev { font-size: 8px; color: var(--wp-text-dim); transition: transform var(--wp-motion-quick, 0.12s) ease; }
.wp-dbg-step.is-open .wp-dbg-step__chev { transform: rotate(90deg); }
.wp-dbg-step__writes, .wp-dbg-step__full {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 8px 0 30px;
  font-size: 11px;
  color: var(--wp-text);
  word-break: break-word;
}
.wp-dbg-step__write { display: flex; gap: 5px; align-items: baseline; flex-wrap: wrap; }
</style>
