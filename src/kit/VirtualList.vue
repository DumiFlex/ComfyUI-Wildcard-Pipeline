<script setup lang="ts" generic="T">
/**
 * Virtual list: a long list (thousands of options, every library item)
 * where only the rows in view are built, so it scrolls smoothly. Rows have
 * one fixed height. Works on the canvas and in the manager.
 *
 *   <VirtualList :items="options" :item-height="32" height="320px" :item-key="(o) => o.id" label="Options">
 *     <template #item="{ item, index }">…</template>
 *   </VirtualList>
 *
 * The rows keep their place in the list for screen readers
 * (`aria-setsize` / `aria-posinset`). `scrollToIndex(i)` brings a row into
 * view, e.g. the one a keyboard user moved to.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = withDefaults(defineProps<{
  items: T[];
  itemKey: (item: T, index: number) => string | number;
  /** Every row's height in px. */
  itemHeight: number;
  /** CSS height of the scrolling box. */
  height?: string;
  /** Rows built above and below the view. */
  overscan?: number;
  label?: string;
}>(), { height: "320px", overscan: 6, label: undefined });

const boxEl = ref<HTMLElement | null>(null);
const top = ref(0);
const viewH = ref(320);

const first = computed(() => Math.max(0, Math.floor(top.value / props.itemHeight) - props.overscan));
const last = computed(() => Math.min(props.items.length, Math.ceil((top.value + viewH.value) / props.itemHeight) + props.overscan));
const shown = computed(() => props.items.slice(first.value, last.value).map((item, k) => ({ item, index: first.value + k })));

function onScroll(): void {
  top.value = boxEl.value?.scrollTop ?? 0;
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  viewH.value = boxEl.value?.clientHeight || viewH.value;
  if (typeof ResizeObserver !== "undefined" && boxEl.value) {
    ro = new ResizeObserver(() => { viewH.value = boxEl.value?.clientHeight || viewH.value; });
    ro.observe(boxEl.value);
  }
});
onBeforeUnmount(() => ro?.disconnect());

/** Scroll so row `i` is in view (nearest edge). */
function scrollToIndex(i: number): void {
  const el = boxEl.value;
  if (!el) return;
  const y = i * props.itemHeight;
  if (y < el.scrollTop) el.scrollTop = y;
  else if (y + props.itemHeight > el.scrollTop + el.clientHeight) el.scrollTop = y + props.itemHeight - el.clientHeight;
  onScroll();
}

defineExpose({ scrollToIndex });
</script>

<template>
  <div ref="boxEl" class="wp-vlist" :style="{ height }" tabindex="0" role="list" :aria-label="label" @scroll.passive="onScroll">
    <div class="wp-vlist__space" :style="{ height: `${items.length * itemHeight}px` }">
      <div
        v-for="row in shown"
        :key="itemKey(row.item, row.index)"
        class="wp-vlist__row"
        role="listitem"
        :aria-setsize="items.length"
        :aria-posinset="row.index + 1"
        :style="{ top: `${row.index * itemHeight}px`, height: `${itemHeight}px` }"
      >
        <slot name="item" :item="row.item" :index="row.index" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-vlist { position: relative; overflow-y: auto; overscroll-behavior: contain; min-width: 0; outline: none; border-radius: var(--wp-radius); }
.wp-vlist:focus-visible { box-shadow: inset 0 0 0 2px var(--wp-border-focus); }
.wp-vlist__space { position: relative; width: 100%; }
.wp-vlist__row { position: absolute; left: 0; right: 0; display: flex; align-items: center; min-width: 0; box-sizing: border-box; }
</style>
