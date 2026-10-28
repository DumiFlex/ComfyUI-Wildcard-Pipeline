<script setup lang="ts">
/**
 * The options card's filter bar: a text search, the axis-grouped tag filter
 * and the "N of M" count. The editor owns the filter state (it also drives
 * the option table and the no-results row); this renders it.
 */
import SearchInput from "@/components/shared/SearchInput.vue";
import TagPickerMenu, { type TagGroup } from "../TagPickerMenu.vue";

const query = defineModel<string>("query", { required: true });

defineProps<{
  /** Every option in the wildcard. */
  total: number;
  /** Options left after the filter. */
  shown: number;
  /** True while a text or tag filter is on. */
  active: boolean;
  /** The sub-category registry. */
  allTags: string[];
  groups: TagGroup[];
  selectedTags: string[];
  menuOpen: boolean;
  anchor: { top: number; left: number };
  dropUp: boolean;
  tagStyle: (tag: string) => Record<string, string>;
}>();

const emit = defineEmits<{
  "toggle-menu": [ev: MouseEvent];
  "toggle-tag": [tag: string];
  clear: [];
}>();
</script>

<template>
  <div class="wc-optfilter">
    <SearchInput
      v-model="query"
      class="wc-optfilter__search"
      size="sm"
      :placeholder="`Filter ${total} options…`"
      aria-label="Filter options"
      clear-label="Clear text filter"
      data-test="wc-opt-search" data-ai-anchor="opt-search" data-ai-label="Search the options"
    />

    <div v-if="allTags.length > 0" class="wc-optfilter__tagwrap">
      <button
        type="button"
        class="wc-optfilter__tagbtn"
        :data-on="selectedTags.length > 0 ? '' : null"
        :aria-expanded="menuOpen"
        data-test="wc-opt-tagfilter"
        @click.stop="emit('toggle-menu', $event)"
      >
        <i class="pi pi-tag" aria-hidden="true" />
        tags<template v-if="selectedTags.length"> · {{ selectedTags.length }}</template>
        <i class="pi pi-chevron-down" aria-hidden="true" />
      </button>
      <TagPickerMenu
        :open="menuOpen"
        :anchor="anchor"
        :drop-up="dropUp"
        :groups="groups"
        :all-tags="allTags"
        :selected="selectedTags"
        :tag-style="tagStyle"
        test-prefix="wc-opt-tagfilter"
        @toggle="(t: string) => emit('toggle-tag', t)"
      />
    </div>

    <!-- Same count grammar as the sub-category filter panel: a bar for the
         proportion, tabular numerals for the precision. Idle until a filter
         is on — "133 of 133" would be reporting a success nobody asked for. -->
    <span class="wc-optfilter__count" data-test="wc-opt-count">
      <template v-if="active">
        <span class="wc-optfilter__bar" :data-zero="shown === 0 ? '' : null">
          <i :style="{ width: Math.round((shown / Math.max(1, total)) * 100) + '%' }" />
        </span>
        <span class="wc-optfilter__n" :data-zero="shown === 0 ? '' : null">
          {{ shown }} of {{ total }}
        </span>
        <button type="button" class="wc-optfilter__clear" data-test="wc-opt-clear" @click="emit('clear')">Clear</button>
      </template>
      <span v-else class="wc-optfilter__idle">{{ total }} options</span>
    </span>
  </div>
</template>

<style scoped>
/* ── Options filter bar ─────────────────────────────────────────────── */
/* Sits inside the Card's actions row, so no padding or rule of its own —
   the header supplies both. `flex: 1` lets the search take the slack while
   the buttons beside it keep their intrinsic width. */
.wc-optfilter {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  /* Card's header puts a `.wp-spacer` (flex: 1) between the title and this
     slot. With a grow factor of 1 the two split the free space evenly and the
     search box ended up half the width it should be. A far larger factor takes
     effectively all of the slack while leaving the spacer in place, which is
     what still separates the title from the controls. */
  flex: 1000 1 auto;
  min-width: 0;
  margin-right: var(--wp-space-4);
}
/* The search takes whatever the fixed-size tag button and count leave. There
   is deliberately no spacer in this block: one used to right-align the count,
   and it competed with the search for the same free space and took half of
   it. */
.wc-optfilter__search { flex: 1; min-width: 90px; }
.wc-optfilter__tagwrap { position: relative; }
.wc-optfilter__tagbtn {
  display: inline-flex; align-items: center; gap: 5px; /* audit-exempt: icon gap */
  padding: 4px var(--wp-space-4);
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted);
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wc-optfilter__tagbtn[data-on] {
  background: color-mix(in oklab, var(--wp-accent-500) 24%, transparent);
  border-color: var(--wp-accent-500);
  color: var(--wp-accent-300);
}
.wc-optfilter__tagbtn .pi { font-size: 9px; }
.wc-optfilter__menu {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 30;
  min-width: 170px; max-height: 240px; overflow-y: auto;
  overscroll-behavior: contain;
  display: flex; flex-direction: column;
  padding: var(--wp-space-3);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-md);
}
.wc-optfilter__menuitem {
  display: flex; align-items: center; gap: var(--wp-space-3);
  padding: 4px var(--wp-space-3);
  background: none; border: none; border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted);
  font: 11px var(--wp-font-mono);
  text-align: left; cursor: pointer;
}
.wc-optfilter__menuitem:hover { background: var(--wp-bg-3); color: var(--wp-text); }
.wc-optfilter__menuitem[data-on] { color: var(--wp-accent-300); }
.wc-optfilter__box {
  width: 12px; height: 12px; flex-shrink: 0;
  display: grid; place-items: center;
  border: 1px solid var(--wp-border-strong);
  border-radius: min(3px, var(--wp-radius-cap, 999px)); /* audit-exempt: below the radius scale */
  font-size: 7px;
}
.wc-optfilter__menuitem[data-on] .wc-optfilter__box {
  background: var(--wp-accent-600); border-color: var(--wp-accent-600); color: #fff;
}
.wc-optfilter__count {
  display: flex; align-items: center; gap: var(--wp-space-3);
  font-size: 11px; white-space: nowrap;
}
.wc-optfilter__bar {
  width: 44px; height: 3px; border-radius: min(2px, var(--wp-radius-cap, 999px)); /* audit-exempt: hairline meter */
  background: var(--wp-bg-4); overflow: hidden;
}
.wc-optfilter__bar i { display: block; height: 100%; background: var(--wp-success); }
.wc-optfilter__bar[data-zero] { background: color-mix(in oklab, var(--wp-danger) 35%, transparent); }
.wc-optfilter__n {
  font-family: var(--wp-font-mono); font-variant-numeric: tabular-nums;
  font-weight: 600; color: var(--wp-success);
}
.wc-optfilter__n[data-zero] { color: var(--wp-danger); }
.wc-optfilter__idle { color: var(--wp-text-dim); font-family: var(--wp-font-mono); }
.wc-optfilter__clear {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--wp-text-muted); font: 11px var(--wp-font-sans);
  text-decoration: underline;
}
</style>
