<script setup lang="ts">
/**
 * Variables tab: the context as it leaves this chain, one row per
 * variable, with the module that set it. Multi-picks list their items the
 * way `$name.K` indexes them, and a pick's `accepts` axes show as the
 * `$name.AXIS` reads they answer.
 */
import { computed } from "vue";
import RichTextPreview from "../../manager/components/RichTextPreview.vue";
import type { VarRow } from "./debug-model";

const props = defineProps<{
  rows: VarRow[];
  pinned: Set<string>;
  flashed: Set<string>;
  uuidToName: Map<string, string>;
  uuidToKind: Map<string, string>;
  ctxActiveKey: string | null;
}>();
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
  <div class="wp-dbg-vars" data-test="dbg-vars" :style="{ '--wp-dbg-name-w': nameWidth }">
    <div
      v-for="v in rows"
      :key="v.name"
      class="wp-dbg-var-row"
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
      <button
        v-if="v.writerKey"
        type="button"
        class="wp-dbg-var-row__src"
        :title="'Show in trace'"
        data-test="dbg-var-src"
        @click="emit('goto-step', v.writerKey)"
      >
        <span class="wp-dbg-kind-dot" :style="{ background: `var(--wp-kind-${v.writerKind === 'fixed' ? 'fixed' : v.writerKind})` }" />
        <span class="wp-dbg-var-row__src-name">{{ v.writerName || v.writerKind }}</span>
      </button>
      <span v-else class="wp-dbg-var-row__src wp-dbg-var-row__src--upstream" title="Came in from upstream, no module in this trace wrote it">upstream</span>
    </div>
  </div>
</template>

<style scoped>
.wp-dbg-vars { display: flex; flex-direction: column; }
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
.wp-dbg-var-row__neg-mark, .wp-dbg-var-row__neg-text { color: var(--wp-red, #e5484d); }
.wp-dbg-var-row__neg-text { min-width: 0; overflow-wrap: anywhere; }
.wp-dbg-var-row__neg-src { flex: none; color: var(--wp-text-dim); font-family: var(--wp-font-sans); }
.wp-dbg-var-row__extra { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.wp-dbg-var-row__axis, .wp-dbg-var-row__tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--wp-bg-2, var(--wp-bg2));
  color: var(--wp-text-muted);
}
.wp-dbg-var-row__axis code { font-family: var(--wp-font-mono); color: var(--wp-kind-wildcard); }
.wp-dbg-var-row__src {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 0;
  padding: 1px 0;
  color: var(--wp-text-dim);
  font: 500 10.5px/1.5 var(--wp-font-sans);
  cursor: pointer;
  max-width: 150px;
  white-space: nowrap;
}
.wp-dbg-var-row__src:hover .wp-dbg-var-row__src-name { color: var(--wp-text); text-decoration: underline; }
.wp-dbg-var-row__src-name { overflow: hidden; text-overflow: ellipsis; }
.wp-dbg-var-row__src--upstream { cursor: default; font-style: italic; }
.wp-dbg-kind-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
</style>
