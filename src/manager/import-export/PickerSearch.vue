<script setup lang="ts">
/**
 * Free-text filter box shared by the Export and Import pickers.
 *
 * Extracted from ExportTab when Import grew the same affordance. It is
 * presentation only — the parent owns the query string and decides what
 * "matches" means for its own rows, because the two sides search different
 * fields (Export has live library rows, Import has payload rows plus badge
 * state).
 *
 * `dataTest` is a prop rather than a fixed attribute so each host keeps the
 * selector its own tests already assert on.
 */
interface Props {
  placeholder?: string;
  ariaLabel?: string;
  dataTest?: string;
}

withDefaults(defineProps<Props>(), {
  placeholder: "Search by name, $variable or id…",
  ariaLabel: "Search entities",
  dataTest: "picker-search",
});

const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="wp-picker-search">
    <i class="pi pi-search" aria-hidden="true" />
    <input
      v-model="model"
      type="search"
      class="wp-picker-search__field"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      spellcheck="false"
      autocomplete="off"
      :data-test="dataTest"
    />
    <button
      v-if="model"
      type="button"
      class="wp-picker-search__clear"
      aria-label="Clear search"
      :data-test="`${dataTest}-clear`"
      @click="model = ''"
    ><i class="pi pi-times" aria-hidden="true" /></button>
  </div>
</template>

<style scoped>
.wp-picker-search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 0 var(--wp-space-4);
  margin-bottom: 6px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}
.wp-picker-search:focus-within { border-color: var(--wp-accent); }
.wp-picker-search .pi-search { font-size: 12px; color: var(--wp-text-dim); }
.wp-picker-search__field {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  padding: var(--wp-space-3) 0;
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
}
.wp-picker-search__field:focus { outline: none; }
/* Chrome renders its own clear affordance for `type=search`; ours is themed
 * and sits in the flex row, so suppress the native one to avoid two Xs. */
.wp-picker-search__field::-webkit-search-cancel-button { display: none; }
.wp-picker-search__clear {
  background: none;
  border: 0;
  padding: 2px;
  cursor: pointer;
  color: var(--wp-text-dim);
  font-size: 11px;
}
.wp-picker-search__clear:hover { color: var(--wp-text); }
</style>
