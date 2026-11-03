<script setup lang="ts">
/**
 * The options card's filter bar: a text search, the axis-grouped tag filter
 * and the "N of M" count. The editor owns the filter state (it also drives
 * the option table and the no-results row); this renders it.
 */
import SearchInput from "@/kit/SearchInput.vue";
import Button from "@/kit/Button.vue";
import TagPickerMenu, { type TagGroup } from "../TagPickerMenu.vue";

const query = defineModel<string>("query", { required: true });
/** The tag menu's open state. */
const menuOpen = defineModel<boolean>("menuOpen", { required: true });

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
  tagStyle: (tag: string) => Record<string, string>;
}>();

const emit = defineEmits<{
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

    <TagPickerMenu
      v-if="allTags.length > 0"
      v-model:open="menuOpen"
      :groups="groups"
      :all-tags="allTags"
      :selected="selectedTags"
      :tag-style="tagStyle"
      test-prefix="wc-opt-tagfilter"
      @toggle="(t: string) => emit('toggle-tag', t)"
    >
      <template #trigger="{ props: triggerProps }">
        <Button
          v-bind="triggerProps"
          variant="secondary"
          size="sm"
          icon="pi-tag"
          icon-right="pi-chevron-down"
          class="wc-optfilter__tagbtn"
          :pressed="selectedTags.length > 0"
          data-test="wc-opt-tagfilter"
        >tags<template v-if="selectedTags.length"> · {{ selectedTags.length }}</template></Button>
      </template>
    </TagPickerMenu>

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
        <Button variant="link" size="sm" data-test="wc-opt-clear" @click="emit('clear')">Clear</Button>
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
/* Compact, like the "12 options" count beside it. */
.wc-optfilter__tagbtn { font-size: 11px; }
</style>
