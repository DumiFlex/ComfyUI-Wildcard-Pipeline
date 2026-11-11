<script setup lang="ts">
/**
 * Variables tab: the context as it leaves this chain, one row per
 * variable, with the module that set it. Multi-picks list their items the
 * way `$name.K` indexes them, and a pick's `accepts` axes show as the
 * `$name.AXIS` reads they answer.
 */
import Button from "@/kit/Button.vue";
import { computed } from "vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import DebugNodeCard, { type NodeEntry } from "./DebugNodeCard.vue";
import {
  KIND_ICONS,
  NODE_KINDS,
  NODE_KIND_TITLES,
  kindColor,
  type Kind,
  type NodeInfo,
  type TraceStep,
  type VarRow,
  type WarningRow,
} from "./debug-model";

const props = defineProps<{
  rows: VarRow[];
  pinned: Set<string>;
  flashed: Set<string>;
  uuidToName: Map<string, string>;
  uuidToKind: Map<string, string>;
  ctxActiveKey: string | null;
  /** Title + codename of a graph node (both "" when unknown). */
  nodeInfo?: (nodeId: string) => NodeInfo;
  stepsByKey?: Map<string, TraceStep>;
  warningsByStep?: Map<string, WarningRow[]>;
}>();

/** The variables grouped by the node that wrote them last: each Loop,
 *  Model Info, Toggles or Injector node gets a card drawn its own way, each
 *  Context a block of module rows, and values from outside the trace go
 *  last. One plain list when there is only one source. */
interface Section {
  id: string;
  kind: Kind | "context" | "upstream";
  nodeId: string;
  title: string;
  rows: VarRow[];
  firstKey: string;
}
const sections = computed((): Section[] => {
  const byId = new Map<string, Section>();
  const order: Section[] = [];
  for (const v of props.rows) {
    const nodeKind = v.writerKind && NODE_KINDS.has(v.writerKind) ? v.writerKind : null;
    const id = !v.writerKey ? "upstream" : `${nodeKind ? "n" : "c"}:${v.writerNodeId}`;
    let sec = byId.get(id);
    if (!sec) {
      const info = v.writerNodeId ? props.nodeInfo?.(v.writerNodeId) : undefined;
      sec = {
        id,
        kind: !v.writerKey ? "upstream" : nodeKind ?? "context",
        nodeId: v.writerNodeId,
        title: !v.writerKey
          ? "From upstream"
          : nodeKind
            ? info?.title || NODE_KIND_TITLES[nodeKind] || nodeKind
            : info?.codename || info?.title || "Context",
        rows: [],
        firstKey: v.writerKey ?? "",
      };
      byId.set(id, sec);
      order.push(sec);
    }
    sec.rows.push(v);
    if (v.writerKey && Number(v.writerKey) < Number(sec.firstKey)) sec.firstKey = v.writerKey;
  }
  return order.sort((a, b) => {
    if (a.kind === "upstream") return 1;
    if (b.kind === "upstream") return -1;
    return Number(a.firstKey) - Number(b.firstKey);
  });
});
const grouped = computed(() => sections.value.length > 1 || sections.value.some((s) => s.kind !== "context" && s.kind !== "upstream"));

function entries(sec: Section): NodeEntry[] {
  return sec.rows.map((v) => ({
    key: `var:${v.name}`,
    name: v.name,
    value: v.value,
    internal: v.internal,
    step: v.writerKey ? props.stepsByKey?.get(v.writerKey) ?? null : null,
  }));
}
function sectionWarnings(sec: Section): WarningRow[] {
  if (!props.warningsByStep || !props.stepsByKey) return [];
  const out: WarningRow[] = [];
  for (const [key, list] of props.warningsByStep) {
    if (props.stepsByKey.get(key)?.nodeId === sec.nodeId) out.push(...list);
  }
  return out;
}
function sectionIcon(sec: Section): string {
  if (sec.kind === "upstream") return "pi pi-arrow-down";
  if (sec.kind === "context") return "pi pi-sitemap";
  return KIND_ICONS[sec.kind];
}
function sectionColor(sec: Section): string {
  if (sec.kind === "upstream") return "var(--wp-text-dim)";
  if (sec.kind === "context") return "var(--wp-accent-text, var(--wp-accent))";
  return kindColor(sec.kind);
}

/** What the source column calls a variable's writer: the module's name, or
 *  for a node-written variable (Toggles, Model Info, Loop, Injector) that
 *  node's title on the canvas. */
function writerLabel(v: VarRow): string {
  if (v.writerName) return v.writerName;
  const kind = v.writerKind;
  if (kind && NODE_KINDS.has(kind)) {
    const title = v.writerNodeId ? props.nodeInfo?.(v.writerNodeId).title ?? "" : "";
    return title || NODE_KIND_TITLES[kind] || kind;
  }
  return kind ?? "";
}
const emit = defineEmits<{
  (e: "goto-step", key: string): void;
  (e: "row-menu", ev: MouseEvent, row: VarRow): void;
}>();

/** One name column for every row, sized to the longest name (capped;
 *  longer names wrap) so values line up down the list. */
const nameWidth = computed(() => {
  const longest = props.rows.reduce((n, v) => Math.max(n, v.name.length), 0);
  return `calc(${Math.min(longest + 1, 16)}ch + 26px)`;
});
</script>

<template>
  <div class="wp-dbg-vars" :class="{ 'is-grouped': grouped }" data-test="dbg-vars" :style="{ '--wp-dbg-name-w': nameWidth }">
   <section
      v-for="sec in sections"
      :key="sec.id"
      class="wp-dbg-vsec"
      :data-kind="sec.kind"
      :style="{ '--wp-dbg-kind': sectionColor(sec) }"
      data-test="dbg-var-section"
    >
    <header v-if="grouped" class="wp-dbg-vsec__head" data-test="dbg-var-section-head">
      <i :class="['wp-dbg-vsec__icon', sectionIcon(sec)]" aria-hidden="true" />
      <span class="wp-dbg-vsec__title">{{ sec.title }}</span>
      <span class="wp-dbg-vsec__count">{{ sec.rows.length }}</span>
      <Button
        v-if="sec.kind !== 'upstream' && sec.firstKey"
        variant="link"
        size="sm"
        class="wp-dbg-vsec__goto"
        hint="Show in trace"
        @click="emit('goto-step', sec.firstKey)"
      >trace</Button>
    </header>
    <DebugNodeCard
      v-if="sec.kind !== 'context' && sec.kind !== 'upstream'"
      :kind="sec.kind"
      :entries="entries(sec)"
      :warnings="sectionWarnings(sec)"
      :uuid-to-name="uuidToName"
      :uuid-to-kind="uuidToKind"
      :active-key="ctxActiveKey"
      :pinned="pinned"
    />
    <template v-else>
    <div
      v-for="v in sec.rows"
      :key="v.name"
      class="wp-dbg-var-row"
      :style="{ '--wp-dbg-kind': v.writerKind ? kindColor(v.writerKind) : 'transparent' }"
      :data-kind="v.writerKind ?? 'upstream'"
      :class="{
        'is-internal': v.internal,
        'wp-row-flash': flashed.has(v.name),
        'is-ctx': ctxActiveKey === `var:${v.name}`,
      }"
      data-test="dbg-var"
      @contextmenu="(ev) => emit('row-menu', ev, v)"
    >
      <div class="wp-dbg-var-row__name">
        <i v-if="pinned.has(`var:${v.name}`)" class="pi pi-star-fill wp-dbg-pin" aria-label="pinned" />
        <code>${{ v.name }}</code>
        <i v-if="v.internal" class="pi pi-eye-slash wp-dbg-flag" title="Internal: downstream modules can read it, the prompt never shows it" />
        <span v-if="v.writeCount > 1" class="wp-dbg-var-row__count" :title="`Written ${v.writeCount} times; the last write wins`">×{{ v.writeCount }}</span>
      </div>
      <div class="wp-dbg-var-row__value">
        <ol v-if="v.items" class="wp-dbg-var-row__items" data-test="dbg-var-items">
          <li v-for="(it, i) in v.items" :key="i">
            <span class="wp-dbg-var-row__idx" :title="`$${v.name}.${i}`">.{{ i }}</span>
            <RichTextPreview :value="it" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
          </li>
        </ol>
        <RichTextPreview
          v-else-if="v.value"
          :value="v.value"
          :uuid-to-name="uuidToName"
          :uuid-to-kind="uuidToKind"
          surface="wildcard"
        />
        <span v-else class="wp-dbg-var-row__empty">empty</span>
        <div
          v-for="(n, i) in v.negatives"
          :key="`neg-${i}`"
          class="wp-dbg-var-row__neg"
          data-test="dbg-var-neg"
          title="Negative words: an Assembler that renders this variable adds them to its negative output"
        >
          <span class="wp-dbg-var-row__neg-mark" aria-hidden="true">−</span>
          <span class="wp-dbg-var-row__neg-text">{{ n.text }}</span>
          <span v-if="n.source" class="wp-dbg-var-row__neg-src" data-test="dbg-var-neg-src">· {{ n.source }}</span>
        </div>
        <div v-if="v.axes.length || v.tags.length" class="wp-dbg-var-row__extra">
          <span v-for="a in v.axes" :key="a.axis" class="wp-dbg-var-row__axis" data-test="dbg-var-axis" :title="`$${v.name}.${a.axis}`">
            <code>.{{ a.axis }}</code> {{ a.value || "—" }}
          </span>
          <span v-for="t in v.tags" :key="t" class="wp-dbg-var-row__tag">{{ t }}</span>
        </div>
      </div>
      <Button
        v-if="v.writerKey"
        variant="link"
        size="sm"
        class="wp-dbg-var-row__src"
        hint="Show in trace"
        data-test="dbg-var-src"
        @click="emit('goto-step', v.writerKey)"
      >
        <i :class="['wp-dbg-var-row__src-icon', KIND_ICONS[v.writerKind ?? 'unknown']]" aria-hidden="true" />
        <span class="wp-dbg-var-row__src-name">{{ writerLabel(v) }}</span>
      </Button>
      <span v-else class="wp-dbg-var-row__src wp-dbg-var-row__src--upstream" title="Came in from upstream, no module in this trace wrote it">upstream</span>
    </div>
    </template>
   </section>
  </div>
</template>

<style scoped>
.wp-dbg-vars { display: flex; flex-direction: column; }
.wp-dbg-vars.is-grouped { gap: 8px; }
.wp-dbg-vsec { display: flex; flex-direction: column; }
.wp-dbg-vsec__head { display: flex; align-items: center; gap: 6px; padding: 0 4px 4px; font-size: 10px; color: var(--wp-text-dim); }
.wp-dbg-vsec__icon { font-size: 10px; color: var(--wp-dbg-kind); }
.wp-dbg-vsec__title { font: 600 11px/1.4 var(--wp-font-sans); color: var(--wp-text); }
.wp-dbg-vsec__count { font: 500 9.5px/1 var(--wp-font-mono); }
.wp-dbg-vsec__goto.wp-btn { margin-left: auto; height: auto; min-height: 0; padding: 0; font-size: 10px; }
.wp-dbg-var-row {
  display: grid;
  grid-template-columns: max(90px, var(--wp-dbg-name-w, 90px)) minmax(0, 1fr) auto;
  column-gap: 12px;
  align-items: start;
  padding: 5px 6px;
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
  font-size: 11.5px;
}
.wp-dbg-var-row:first-child { border-top: 0; }
/* The writer's kind colour on the left edge (none for upstream values). */
.wp-dbg-var-row { box-shadow: inset 2px 0 0 color-mix(in oklab, var(--wp-dbg-kind, transparent) 70%, transparent); }
.wp-dbg-var-row:hover { background: var(--wp-row-hover, var(--wp-bg2)); }
.wp-dbg-var-row.is-ctx { outline: 1px solid var(--wp-accent); outline-offset: -1px; }
.wp-dbg-var-row__name { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; }
.wp-dbg-var-row__name code { overflow-wrap: anywhere; }
.wp-dbg-var-row__name code { font: 600 11.5px/1.5 var(--wp-font-mono); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-dbg-var-row.is-internal .wp-dbg-var-row__name code { color: var(--wp-text-muted); }
.wp-dbg-flag { font-size: 9px; color: var(--wp-text-dim); }
.wp-dbg-pin { font-size: 9px; color: var(--wp-amber, var(--wp-warn)); }
.wp-dbg-var-row__count { font: 500 9px/1 var(--wp-font-mono); color: var(--wp-text-dim); }
.wp-dbg-var-row__value { min-width: 0; color: var(--wp-text); line-height: 1.5; word-break: break-word; }
.wp-dbg-var-row__empty { font-style: italic; color: var(--wp-text-dim); }
.wp-dbg-var-row__items { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 1px; }
.wp-dbg-var-row__items li { display: flex; gap: 6px; align-items: baseline; }
.wp-dbg-var-row__idx { font: 500 9.5px/1 var(--wp-font-mono); color: var(--wp-text-dim); min-width: 16px; }
.wp-dbg-var-row__neg { display: flex; gap: 5px; align-items: baseline; font: 500 10.5px/1.5 var(--wp-font-mono); }
.wp-dbg-var-row__neg-mark, .wp-dbg-var-row__neg-text { color: var(--wp-red); }
.wp-dbg-var-row__neg-text { min-width: 0; overflow-wrap: anywhere; }
.wp-dbg-var-row__neg-src { flex: none; color: var(--wp-text-dim); font-family: var(--wp-font-sans); }
.wp-dbg-var-row__extra { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.wp-dbg-var-row__axis, .wp-dbg-var-row__tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-2, var(--wp-bg2));
  color: var(--wp-text-muted);
}
.wp-dbg-var-row__axis code { font-family: var(--wp-font-mono); color: var(--wp-kind-wildcard); }
/* The plain span (upstream) and the kit link Button share this look. */
.wp-dbg-var-row__src, .wp-dbg-var-row__src.wp-btn {
  display: inline-flex; align-items: center; gap: 5px; height: auto; min-height: 0; padding: 1px 0;
  color: var(--wp-text-dim); font: 500 10.5px/1.5 var(--wp-font-sans);
  max-width: 150px; white-space: nowrap; text-decoration: none;
}
.wp-dbg-var-row__src.wp-btn:hover .wp-dbg-var-row__src-name { color: var(--wp-text); text-decoration: underline; }
.wp-dbg-var-row__src-name { overflow: hidden; text-overflow: ellipsis; }
.wp-dbg-var-row__src--upstream { cursor: default; font-style: italic; }
.wp-dbg-var-row__src-icon { font-size: 9px; flex: none; color: var(--wp-dbg-kind); }
.wp-dbg-var-row__src.wp-btn :deep(.wp-btn__label) { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.wp-dbg-var-row__src.wp-btn :deep(.wp-btn__label) { line-height: inherit; }
</style>
