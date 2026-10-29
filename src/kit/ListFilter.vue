<script setup lang="ts">
import SearchInput from "./SearchInput.vue";

/**
 * Text filter for a long list inside an editor card.
 *
 * Extracted from the fixed-values editor, which grew this pattern first
 * (`fv-filter` in FixedEditor.vue). The wildcard options list has its own,
 * richer variant with a tag menu attached; this is the plain-text case, which
 * is what the constraint exceptions and derivation rules need.
 *
 * Since the component merge it is SearchInput with a list's rules on top:
 * the "3 of 12" count inside the box, and the hide-until-long gate below.
 *
 * Deliberately dumb: it owns the query string and the count readout, and
 * nothing else. Each caller keeps its own filtering, because what counts as a
 * match differs per surface — an exception matches on resolved source/target
 * labels, a rule matches on every variable name and value across its branches.
 */
withDefaults(
  defineProps<{
    /** Unfiltered row count. Drives the "n of N" readout and the show/hide gate. */
    total: number;
    /** Row count after filtering. */
    visible: number;
    /** Plural noun for the placeholder and idle readout, e.g. "exceptions". */
    noun: string;
    /** `data-test` prefix; yields `<prefix>-search`, `-count`, `-clear` (the ✕). */
    testPrefix: string;
    /**
     * Hide the control until the list is longer than this.
     *
     * Callers set it from how tall their rows are, not from a house style: a
     * derivation rule is a whole card and three of them already scroll, while
     * a fixed-value is one table row and eight fit comfortably.
     *
     * The default of 8 came from the fixed-values filter and was applied
     * unchanged to the constraint and derivation editors, where it hid the
     * feature outright — a real library measured 2026-08-06 had at most 3
     * rules and 2 exceptions per module, so nobody ever saw it.
     *
     * Gated on `total`, never on `visible`, so the box cannot disappear
     * underneath a query that filtered the list down past the threshold.
     */
    minRows?: number;
  }>(),
  { minRows: 8 },
);

const query = defineModel<string>({ required: true });
</script>

<template>
  <SearchInput
    v-if="total > minRows"
    v-model="query"
    class="wp-lfilter"
    size="sm"
    :placeholder="`Filter ${total} ${noun}…`"
    :aria-label="`Filter ${noun}`"
    :total="total"
    :visible="visible"
    :noun="noun"
    clear-label="Clear filter"
    :test-prefix="testPrefix"
    :data-test="`${testPrefix}-search`"
  />
</template>

<style scoped>
.wp-lfilter {
  /* Card's header puts a `.wp-spacer` (flex: 1) between the title and this
     slot. With a grow factor of 1 the two split the free space evenly and the
     search box ends up half the width it should be. A far larger factor takes
     effectively all of the slack while leaving the spacer in place, which is
     what still separates the title from the controls. */
  flex: 1000 1 auto;
  /* A floor, not a width. Below this the input is too small to read what you
     typed, so the card header (which wraps) drops the filter onto its own row
     instead of shaving it to nothing. The derivation card, with four buttons
     beside it, is the case that forces this. */
  min-width: 220px;
  margin-right: var(--wp-space-4);
}
</style>
