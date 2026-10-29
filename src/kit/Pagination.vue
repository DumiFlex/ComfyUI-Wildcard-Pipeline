<script setup lang="ts">
/**
 * Pagination: move through a long list a page at a time, or load more at
 * its end. Works on the canvas and in the manager.
 *
 *   <Pagination v-model:page="page" :total="rows.length" :page-size="50" />
 *   <Pagination mode="more" :shown="shown.length" :total="230" :loading="busy" @more="loadMore" />
 *
 * Pages: a `nav` with Previous / Next and the page numbers (first, last, the
 * current page with `siblings` either side, "…" between), the current one
 * marked `aria-current="page"`. More: one "Load more" button under a
 * "Showing 50 of 230" line. Nothing is drawn when everything fits on one page.
 */
import { computed } from "vue";
import { pageItems } from "./pagination";
import WpButton from "./WpButton.vue";

const props = withDefaults(defineProps<{
  /** pages: numbered pages. more: a Load more button. */
  mode?: "pages" | "more" | undefined;
  /** The current page, from 1. */
  page?: number | undefined;
  /** How many items there are in all. */
  total: number;
  pageSize?: number | undefined;
  /** Pages shown either side of the current one. */
  siblings?: number | undefined;
  /** In "more" mode: how many items are on screen. */
  shown?: number | undefined;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  size?: "sm" | "md" | undefined;
  /** The item's name in "Showing 50 of 230 modules". */
  noun?: string | undefined;
  ariaLabel?: string | undefined;
}>(), { mode: "pages", page: 1, pageSize: 25, siblings: 1, shown: 0, size: "md", noun: undefined, ariaLabel: "Pages" });

const emit = defineEmits<{ (e: "update:page", v: number): void; (e: "more"): void }>();

const pages = computed(() => Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize))));
const items = computed(() => pageItems(props.page, pages.value, props.siblings));
const from = computed(() => Math.min(props.total, (props.page - 1) * props.pageSize + 1));
const to = computed(() => Math.min(props.total, props.page * props.pageSize));

function go(p: number): void {
  const next = Math.min(Math.max(1, p), pages.value);
  if (next !== props.page && !props.disabled) emit("update:page", next);
}
const btnSize = computed(() => (props.size === "sm" ? "sm" : "md"));
</script>

<template>
  <nav v-if="mode === 'pages' && pages > 1" class="wp-paging" :data-size="size" :aria-label="ariaLabel">
    <span class="wp-paging__range" aria-live="polite">{{ from }}–{{ to }} of {{ total }}</span>
    <ul class="wp-paging__list">
      <li>
        <WpButton variant="ghost" :size="btnSize" icon="pi-chevron-left" aria-label="Previous page" :disabled="disabled || props.page <= 1" @click="go(props.page - 1)" />
      </li>
      <li v-for="it in items" :key="it">
        <span v-if="typeof it !== 'number'" class="wp-paging__gap" aria-hidden="true">…</span>
        <button
          v-else
          type="button"
          class="wp-paging__page"
          :data-size="size"
          :aria-current="it === page ? 'page' : undefined"
          :aria-label="`Page ${it}`"
          :disabled="disabled"
          @click="go(it)"
        >{{ it }}</button>
      </li>
      <li>
        <WpButton variant="ghost" :size="btnSize" icon="pi-chevron-right" aria-label="Next page" :disabled="disabled || props.page >= pages" @click="go(props.page + 1)" />
      </li>
    </ul>
  </nav>
  <div v-else-if="mode === 'more' && total > 0" class="wp-paging wp-paging--more" :data-size="size">
    <span class="wp-paging__range" aria-live="polite">Showing {{ Math.min(props.shown, total) }} of {{ total }}{{ noun ? ` ${noun}` : "" }}</span>
    <WpButton v-if="props.shown < total" variant="secondary" :size="btnSize" :loading="loading" :disabled="disabled" @click="emit('more')">Load more</WpButton>
  </div>
</template>

<style scoped>
.wp-paging {
  display: flex; align-items: center; justify-content: space-between; gap: var(--wp-space-4); flex-wrap: wrap;
  min-width: 0; color: var(--wp-text-muted); font: 400 var(--wp-text-sm)/1.2 var(--wp-font-sans);
}
.wp-paging[data-size="sm"] { font-size: var(--wp-text-xs); gap: var(--wp-space-3); }
.wp-paging--more { flex-direction: column; justify-content: center; }
.wp-paging__range { font-variant-numeric: tabular-nums; }
.wp-paging__list { display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none; }
.wp-paging__gap { display: inline-grid; place-items: center; min-width: 20px; color: var(--wp-text-dim); }
.wp-paging__page {
  display: inline-grid; place-items: center; box-sizing: border-box;
  min-width: var(--wp-control-h-md); height: var(--wp-control-h-md); margin: 0; padding: 0 var(--wp-space-2);
  border: 1px solid transparent; border-radius: var(--wp-radius);
  background: transparent; color: var(--wp-text-muted); font: 500 var(--wp-text-sm)/1 var(--wp-font-sans);
  font-variant-numeric: tabular-nums; cursor: pointer;
  transition: background var(--wp-motion-hover), color var(--wp-motion-hover);
}
.wp-paging__page[data-size="sm"] { min-width: var(--wp-control-h-sm); height: var(--wp-control-h-sm); border-radius: var(--wp-radius-sm); font-size: var(--wp-text-xs); }
.wp-paging__page:hover:not(:disabled) { background: var(--wp-row-hover); color: var(--wp-text); }
.wp-paging__page[aria-current="page"] { border-color: var(--wp-border-strong); background: var(--wp-bg-3); color: var(--wp-text); font-weight: 600; }
.wp-paging__page:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-paging__page:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
