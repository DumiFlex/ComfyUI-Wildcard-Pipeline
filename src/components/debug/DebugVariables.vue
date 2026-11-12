<script setup lang="ts">
/**
 * Variables tab: the context as it leaves this chain, one row per
 * variable, with the module that set it. Multi-picks list their items the
 * way `$name.K` indexes them, and a pick's `accepts` axes show as the
 * `$name.AXIS` reads they answer.
 */
import Button from "@/kit/Button.vue";
import Chip from "@/kit/Chip.vue";
import CopyButton from "@/kit/CopyButton.vue";
import { computed, ref } from "vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import { TEMPLATE_TYPE, valueTypeLook, type ValueTypeLook } from "../injector/value-types";
import {
  KIND_ICONS,
  NODE_KINDS,
  NODE_KIND_TITLES,
  kindColor,
  type Kind,
  type NodeInfo,
  type RawDetail,
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
  /** The host can select a node on the canvas. */
  canFocus?: boolean;
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
  /** A Context's codename, shown as a chip beside the title. */
  codename: string;
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
            : info?.title || "WP Context",
        codename: v.writerKey && !nodeKind ? info?.codename ?? "" : "",
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

// ── Rows from other nodes ────────────────────────────────────────────────
// Every row keeps the same metrics and everything a Context row shows
// (multi-pick items, negatives, axes, tags, write count); a node's rows only
// add how that node works: a switch, a radio mark, a model value, a type.
/** Long values fold to a few lines (and long lists to their first items)
 *  until the row is opened, so one long story doesn't fill the panel. */
const LONG_VALUE = 160;
const LONG_NEGATIVE = 120;
const FOLDED_ITEMS = 3;
const openRows = ref(new Set<string>());
function isLong(v: VarRow): boolean {
  if ((v.value ?? "").length > LONG_VALUE) return true;
  if (v.items && (v.items.length > FOLDED_ITEMS || v.items.some((it) => it.length > LONG_VALUE))) return true;
  return v.negatives.reduce((n, neg) => n + neg.text.length, 0) > LONG_NEGATIVE;
}
function isFolded(v: VarRow): boolean {
  return isLong(v) && !openRows.value.has(v.name);
}
function shownItems(v: VarRow): string[] {
  const items = v.items ?? [];
  return isFolded(v) ? items.slice(0, FOLDED_ITEMS) : items;
}
function moreLabel(v: VarRow): string {
  const hidden = (v.items?.length ?? 0) - FOLDED_ITEMS;
  return isFolded(v) && hidden > 0 ? `Show all (${hidden} more)` : isFolded(v) ? "Show all" : "Show less";
}
function toggleOpen(name: string): void {
  const next = new Set(openRows.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  openRows.value = next;
}
function stepOf(v: VarRow): TraceStep | null {
  return v.writerKey ? props.stepsByKey?.get(v.writerKey) ?? null : null;
}
function nodeKindOf(v: VarRow): Kind | null {
  return v.writerKind && NODE_KINDS.has(v.writerKind) ? v.writerKind : null;
}
function boolOf(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (t === "true") return true;
  if (t === "false") return false;
  return null;
}
function isPick(v: VarRow): boolean {
  return !!stepOf(v)?.source.startsWith("Pick one");
}
/** A toggle's on/off state (also each pick of a Pick one node); null for
 *  anything else. A toggle with a value text holds that text (empty while
 *  off) and its state stays readable as `$name.bool`. */
function switchOf(v: VarRow): boolean | null {
  if (v.writerKind !== "toggle" || isPick(v) || v.items) return null;
  const step = stepOf(v);
  if (step) return step.toggleBool;
  return boolOf(v.value);
}
function isSwitch(v: VarRow): boolean {
  return switchOf(v) !== null;
}
function hasToggleValue(v: VarRow): boolean {
  return !!stepOf(v)?.toggleHasValue;
}
/** Pick one mode: this node also wrote a Pick one variable. */
function inPickMode(sec: Section): boolean {
  return sec.kind === "toggle" && sec.rows.some(isPick);
}
/** The source column for a node-written variable: how that node set it. */
function nodeNote(sec: Section, v: VarRow): string {
  const step = stepOf(v);
  switch (v.writerKind) {
    case "toggle": {
      const up = step?.source.endsWith("set upstream") ? ", set upstream" : "";
      if (isPick(v)) return `pick one${up}`;
      if (!inPickMode(sec)) return `switch${up}`;
      return `${switchOf(v) ? "picked" : "not picked"}${up}`;
    }
    case "loop":
      return v.name.endsWith("_value") ? "value line" : v.name.endsWith("_total") ? "frames" : "frame";
    case "model":
      return step?.source ?? "";
    case "injector":
      return step?.isTemplate ? "template" : "wired in";
    default:
      return "";
  }
}
/** A Context module's one-line fact for the source column: how a wildcard
 *  picked (its odds, pinned, swept, matched) or which branch a derivation
 *  ran. Empty when there is nothing short to say. */
function moduleFact(v: VarRow): string {
  const step = stepOf(v);
  const d = step?.detail;
  if (!step || !d) return "";
  if (step.kind === "wildcard") {
    if (d.swept) return "swept";
    if (d.match_variable) return `matched $${d.match_variable}`;
    if (d.mode === "pinned") return "pinned";
    if (typeof d.chance === "number" && d.chance > 0 && d.chance < 1) return `${Math.round(d.chance * 100)}%`;
    return "";
  }
  if (step.kind === "derivation") {
    const fired = (d.rules ?? []).map((r) => r.fired).find((f) => f != null);
    if (fired === "else") return "else";
    if (typeof fired === "number") return `branch ${fired + 1}`;
  }
  return "";
}
/** The Injector's own icon + colour for this value's wire type. */
function injectorLook(v: VarRow): ValueTypeLook {
  const step = stepOf(v);
  if (step?.isTemplate) return TEMPLATE_TYPE;
  return valueTypeLook(step?.valueType);
}
function injectorType(v: VarRow): string {
  if (v.writerKind !== "injector") return "";
  const step = stepOf(v);
  if (!step) return "";
  return step.isTemplate ? "TPL" : step.valueType;
}
/** The Loop's frame line: frame, seed, sweep combination, value line. */
function loopDetail(sec: Section): RawDetail | null {
  if (sec.kind !== "loop") return null;
  for (const v of sec.rows) {
    const d = stepOf(v)?.detail;
    if (d && typeof d.frame === "number") return d;
  }
  return null;
}
function frameParts(sec: Section): string[] {
  const d = loopDetail(sec);
  if (!d) return [];
  const out = [d.of ? `frame ${d.frame} of ${d.of}` : `frame ${d.frame}`];
  if (d.bypass) out.push("loop bypassed");
  if (typeof d.combo === "number") out.push(`combination ${d.combo} / ${d.combos ?? "?"}`);
  if (typeof d.value_line === "number") out.push(`line ${d.value_line} / ${d.values ?? "?"}`);
  return out;
}
function loopSeed(sec: Section): string {
  const s = loopDetail(sec)?.seed;
  return typeof s === "number" ? String(s) : "";
}
function sectionWarnings(sec: Section): WarningRow[] {
  if (sec.kind === "context" || sec.kind === "upstream") return [];
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
  (e: "show-var", row: VarRow): void;
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
      <span v-if="sec.codename" class="wp-dbg-vsec__codename" data-test="dbg-var-section-codename">{{ sec.codename }}</span>
      <span class="wp-dbg-vsec__count">{{ sec.rows.length }}</span>
      <Button
        v-if="sec.kind !== 'upstream' && sec.firstKey"
        variant="link"
        size="sm"
        class="wp-dbg-vsec__goto"
        icon="pi-bolt"
        hint="Show this node's steps in the trace"
        @click="emit('goto-step', sec.firstKey)"
      >trace</Button>
    </header>
    <div v-if="frameParts(sec).length" class="wp-dbg-vsec__frame" data-test="dbg-loop-frame">
      <span v-for="(p, i) in frameParts(sec)" :key="i" :class="{ 'is-lead': i === 0 }">{{ p }}</span>
      <CopyButton
        v-if="loopSeed(sec)"
        :text="loopSeed(sec)"
        label="Copy this frame's seed"
        size="sm"
        variant="ghost"
        class="wp-dbg-vsec__seed"
      ><span class="wp-dbg-vsec__seed-label">seed</span>{{ loopSeed(sec) }}</CopyButton>
    </div>
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
        <span class="wp-dbg-var-row__mark" aria-hidden="true" />
        <code>${{ v.name }}</code>
        <i v-if="v.internal" class="pi pi-eye-slash wp-dbg-flag" title="Internal: downstream modules can read it, the prompt never shows it" />
        <span v-if="v.writeCount > 1" class="wp-dbg-var-row__count" :title="`Written ${v.writeCount} times; the last write wins`">×{{ v.writeCount }}</span>
      </div>
      <div class="wp-dbg-var-row__value" :class="{ 'is-model': v.writerKind === 'model', 'is-folded': isFolded(v) }">
        <Chip
          v-if="isSwitch(v) && !hasToggleValue(v)"
          class="wp-dbg-var-row__switch"
          :class="switchOf(v) ? 'is-on' : 'is-off'"
          :color="switchOf(v) ? kindColor('toggle') : null"
          dot
          :title="hasToggleValue(v) ? `$${v.name}.bool: the toggle is ${switchOf(v) ? 'on' : 'off'}` : `$${v.name}: the toggle is ${switchOf(v) ? 'on' : 'off'}`"
          data-test="dbg-node-switch"
        >{{ switchOf(v) ? "true" : "false" }}</Chip>
        <template v-if="isSwitch(v) && !hasToggleValue(v)" />
        <ol v-else-if="v.items" class="wp-dbg-var-row__items" data-test="dbg-var-items">
          <li v-for="(it, i) in shownItems(v)" :key="i">
            <span class="wp-dbg-var-row__idx" :title="`$${v.name}.${i}`">.{{ i }}</span>
            <RichTextPreview :value="it" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
          </li>
        </ol>
        <span v-else-if="v.value && v.writerKind === 'model'" class="wp-dbg-var-row__model">{{ v.value }}</span>
        <span v-else-if="v.value && isPick(v)" class="wp-dbg-var-row__pick">
          <i class="pi pi-circle-on wp-dbg-var-row__radio" title="The picked value" aria-hidden="true" />
          <RichTextPreview :value="v.value" :uuid-to-name="uuidToName" :uuid-to-kind="uuidToKind" surface="wildcard" />
        </span>
        <RichTextPreview
          v-else-if="v.value"
          :value="v.value"
          :uuid-to-name="uuidToName"
          :uuid-to-kind="uuidToKind"
          surface="wildcard"
        />
        <span v-else class="wp-dbg-var-row__empty">{{ v.writerKind === "model" ? "not detected" : isPick(v) ? "nothing picked" : isSwitch(v) ? "empty while off" : "empty" }}</span>
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
        <div v-if="v.axes.length || v.tags.length || hasToggleValue(v)" class="wp-dbg-var-row__extra">
          <Chip
            v-if="hasToggleValue(v)"
            class="wp-dbg-var-row__axis"
            :class="{ 'is-on': switchOf(v) }"
            :color="switchOf(v) ? kindColor('toggle') : null"
            dot
            data-test="dbg-var-bool"
            :title="`$${v.name}.bool: the toggle is ${switchOf(v) ? 'on' : 'off'}`"
          ><code>.bool</code> {{ switchOf(v) ? "true" : "false" }}</Chip>
          <Chip
            v-for="a in v.axes"
            :key="a.axis"
            class="wp-dbg-var-row__axis"
            :color="kindColor(v.writerKind ?? 'wildcard')"
            data-test="dbg-var-axis"
            :title="`$${v.name}.${a.axis}`"
          ><code>.{{ a.axis }}</code> {{ a.value || "—" }}</Chip>
          <Chip v-for="t in v.tags" :key="t" class="wp-dbg-var-row__tag" icon="pi-tag">{{ t }}</Chip>
        </div>
        <Button
          v-if="isLong(v)"
          variant="link"
          size="sm"
          class="wp-dbg-var-row__more"
          :icon="isFolded(v) ? 'pi-chevron-down' : 'pi-chevron-up'"
          :aria-expanded="!isFolded(v)"
          data-test="dbg-var-more"
          @click="toggleOpen(v.name)"
        >{{ moreLabel(v) }}</Button>
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
        <Chip
          v-if="injectorType(v)"
          :color="injectorLook(v).color"
          :icon="injectorLook(v).icon"
          class="wp-dbg-var-row__type"
          data-test="dbg-node-type"
        >{{ injectorType(v) }}</Chip>
        <span class="wp-dbg-var-row__src-name" :title="writerLabel(v)" :data-test="nodeKindOf(v) ? 'dbg-node-source' : undefined">{{ nodeKindOf(v) ? nodeNote(sec, v) || writerLabel(v) : writerLabel(v) }}</span>
        <span v-if="!nodeKindOf(v) && moduleFact(v)" class="wp-dbg-var-row__fact" data-test="dbg-var-fact">{{ moduleFact(v) }}</span>
      </Button>
      <span v-else class="wp-dbg-var-row__src wp-dbg-var-row__src--upstream" title="Came in from upstream, no module in this trace wrote it">upstream</span>
    </div>
    <div
      v-for="w in sectionWarnings(sec)"
      :key="`w-${w.key}`"
      class="wp-dbg-vsec__warn"
      :class="`is-${w.severity}`"
      data-test="dbg-node-warning"
    >
      <i class="pi pi-exclamation-triangle" aria-hidden="true" />
      <span class="wp-dbg-vsec__warn-label">{{ w.label }}</span>
      <span class="wp-dbg-vsec__warn-msg">{{ w.message }}</span>
    </div>
   </section>
  </div>
</template>

<style scoped>
.wp-dbg-vars { display: flex; flex-direction: column; }
.wp-dbg-vars.is-grouped { gap: 10px; }
.wp-dbg-vsec { display: flex; flex-direction: column; }
/* Grouped: each node is its own card, tinted by its kind. */
.wp-dbg-vars.is-grouped .wp-dbg-vsec {
  border: 1px solid color-mix(in oklab, var(--wp-dbg-kind) 26%, var(--wp-border));
  border-radius: min(7px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-dbg-kind) 3%, transparent);
  overflow: hidden;
}
.wp-dbg-vsec__head {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 8px;
  font-size: 10px; color: var(--wp-text-dim);
  background: color-mix(in oklab, var(--wp-dbg-kind) 10%, transparent);
  border-bottom: 1px solid color-mix(in oklab, var(--wp-dbg-kind) 20%, var(--wp-border));
}
.wp-dbg-vsec__icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; flex: none;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-size: 10px; color: var(--wp-dbg-kind);
  background: color-mix(in oklab, var(--wp-dbg-kind) 18%, transparent);
}
.wp-dbg-vsec__title { font: 600 11.5px/1.4 var(--wp-font-sans); color: var(--wp-text); }
.wp-dbg-vsec__codename {
  display: inline-flex; align-items: center;
  height: 17px; box-sizing: border-box;
  font: 600 10px/1 var(--wp-font-mono);
  letter-spacing: 0.03em;
  color: var(--wp-text);
  padding: 0 7px;
  border-radius: min(5px, var(--wp-radius-cap, 999px));
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  background: var(--wp-bg, transparent);
}
.wp-dbg-vsec__count { font: 500 9.5px/1 var(--wp-font-mono); }
.wp-dbg-vsec__goto.wp-btn { margin-left: auto; height: auto; min-height: 0; padding: 0; font-size: 10px; }
/* Only the word is underlined, not the icon (wp-kit fixes this for every
 * link button from 0.20; drop this once the kit is bumped). */
.wp-dbg-vsec__goto.wp-btn:is(:hover, :focus-visible) { text-decoration: none; }
.wp-dbg-vsec__goto.wp-btn:is(:hover, :focus-visible) :deep(.wp-btn__label) { text-decoration: underline; }
.wp-dbg-var-row {
  display: grid;
  grid-template-columns: max(90px, var(--wp-dbg-name-w, 90px)) minmax(0, 1fr) auto;
  column-gap: 12px;
  align-items: start;
  padding: 6px 8px;
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
  font-size: 11.5px;
}
.wp-dbg-vsec__head + .wp-dbg-var-row, .wp-dbg-vsec__frame + .wp-dbg-var-row, .wp-dbg-var-row:first-child { border-top: 0; }
/* The writer's kind as a small square before the name (none upstream). */
.wp-dbg-var-row__mark {
  display: inline-block; vertical-align: 1px; margin-right: 6px;
  width: 6px; height: 6px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: var(--wp-dbg-kind, var(--wp-border-strong));
}
.wp-dbg-var-row[data-kind="upstream"] .wp-dbg-var-row__mark { background: transparent; box-shadow: inset 0 0 0 1px var(--wp-text-dim); }
.wp-dbg-var-row:hover { background: var(--wp-row-hover, var(--wp-bg2)); }
.wp-dbg-var-row.is-ctx { outline: 1px solid var(--wp-accent); outline-offset: -1px; }
/* Inline flow, not flex: a long name breaks inside itself and the square
   stays on its first line. */
.wp-dbg-var-row__name { display: block; min-width: 0; line-height: 1.5; }
.wp-dbg-var-row__name > .wp-dbg-flag, .wp-dbg-var-row__name > .wp-dbg-var-row__count, .wp-dbg-var-row__name > .wp-dbg-pin { margin: 0 4px; }
.wp-dbg-var-row__name code { word-break: break-all; }
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
/* Folded: the value shows three lines, each negative one, until opened. */
.wp-dbg-var-row__value.is-folded > .wp-rtp,
.wp-dbg-var-row__value.is-folded .wp-dbg-var-row__pick > .wp-rtp,
.wp-dbg-var-row__value.is-folded .wp-dbg-var-row__items li > .wp-rtp {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden;
}
.wp-dbg-var-row__value.is-folded .wp-dbg-var-row__neg-text {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; overflow: hidden;
}
.wp-btn.wp-dbg-var-row__more { align-self: flex-start; height: auto; min-height: 0; padding: 0; font-size: 10.5px; }
.wp-dbg-var-row__extra { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
/* Kit chips, sized like the switch chip; the accessor reads in mono. */
.wp-chip.wp-dbg-var-row__axis, .wp-chip.wp-dbg-var-row__tag {
  height: 17px; min-height: 0; box-sizing: border-box;
  padding: 0 6px; gap: 4px;
  font: 500 10px/1 var(--wp-font-sans);
}
.wp-dbg-var-row__axis code { font: 600 10px/1 var(--wp-font-mono); }
.wp-dbg-var-row__fact {
  flex: none;
  font: 600 9.5px/1 var(--wp-font-mono);
  padding: 2px 5px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  color: var(--wp-dbg-kind);
  background: color-mix(in oklab, var(--wp-dbg-kind) 14%, transparent);
}
/* The plain span (upstream) and the kit link Button share this look. */
.wp-dbg-var-row__src, .wp-dbg-var-row__src.wp-btn {
  display: inline-flex; align-items: center; gap: 5px; height: auto; min-height: 0; padding: 1px 0;
  color: var(--wp-text-dim); font: 500 10.5px/1.5 var(--wp-font-sans);
  max-width: 150px; white-space: nowrap; text-decoration: none;
}
.wp-dbg-var-row__src.wp-btn:hover .wp-dbg-var-row__src-name { color: var(--wp-text); text-decoration: underline; }
.wp-dbg-var-row__src-name { overflow: hidden; text-overflow: ellipsis; }

/* Rows from other nodes: the same row, with how that node works. */
.wp-dbg-var-row__value.is-model { font: 600 11.5px/1.5 var(--wp-font-mono); color: var(--wp-dbg-kind); }
.wp-dbg-var-row__model { overflow-wrap: anywhere; }
.wp-dbg-var-row__pick { display: inline-flex; align-items: baseline; gap: 5px; min-width: 0; }
.wp-dbg-var-row__radio { font-size: 9px; color: var(--wp-dbg-kind); }
/* Kit chips sized to the row's text so they don't push it around. */
.wp-chip.wp-dbg-var-row__switch, .wp-chip.wp-dbg-var-row__type {
  height: 17px; min-height: 0; box-sizing: border-box;
  padding: 0 6px; gap: 4px;
  font: 600 10px/1 var(--wp-font-mono);
  vertical-align: middle;
}
.wp-dbg-vsec__frame {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px;
  padding: 4px 8px;
  font: 500 10.5px/1.6 var(--wp-font-sans);
  color: var(--wp-text-dim);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.wp-dbg-vsec__frame .is-lead { color: var(--wp-dbg-kind); font-weight: 600; }
.wp-copy-btn.wp-dbg-vsec__seed {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 4px;
  height: auto; min-height: 0;
  background: transparent; border: 0; padding: 0;
  color: var(--wp-text-muted);
  font: 500 10.5px/1.6 var(--wp-font-mono);
  cursor: pointer;
}
.wp-copy-btn.wp-dbg-vsec__seed:hover { color: var(--wp-text); }
.wp-dbg-vsec__seed-label { color: var(--wp-text-dim); font-family: var(--wp-font-sans); }
.wp-dbg-vsec__warn {
  display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px;
  padding: 4px 8px;
  font-size: 10.5px; color: var(--wp-warn);
  border-top: 1px solid var(--wp-border-soft, var(--wp-border));
  background: color-mix(in oklab, var(--wp-warn) 8%, transparent);
}
.wp-dbg-vsec__warn.is-error { color: var(--wp-red); background: color-mix(in oklab, var(--wp-red) 8%, transparent); }
.wp-dbg-vsec__warn.is-info { color: var(--wp-text-muted); background: transparent; }
.wp-dbg-vsec__warn .pi { font-size: 9px; }
.wp-dbg-vsec__warn-label { font-weight: 600; }
.wp-dbg-vsec__warn-msg { color: var(--wp-text-muted); }
.wp-dbg-var-row__src--upstream { cursor: default; font-style: italic; }
.wp-dbg-var-row__src-icon { font-size: 9px; flex: none; color: var(--wp-dbg-kind); }
.wp-dbg-var-row__src.wp-btn :deep(.wp-btn__label) { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.wp-dbg-var-row__src.wp-btn :deep(.wp-btn__label) { line-height: inherit; }
</style>
