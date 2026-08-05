<script setup lang="ts">
/**
 * Text filter for a long list inside an editor card.
 *
 * Extracted from the fixed-values editor, which grew this pattern first
 * (`fv-filter` in FixedEditor.vue). The wildcard options list has its own,
 * richer variant with a tag menu attached; this is the plain-text case, which
 * is what the constraint exceptions and derivation rules need.
 *
 * FixedEditor has NOT been migrated onto this yet — doing so would mix a
 * refactor of a working surface into the commit that adds two new ones. It is
 * the obvious first follow-up.
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
    /** `data-test` prefix; yields `<prefix>-search`, `-count`, `-clear`. */
    testPrefix: string;
    /**
     * Hide the control until the list is at least this long. A filter over
     * four rows is noise — the rows are already all on screen.
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
  <div v-if="total > minRows" class="wp-lfilter">
    <label class="wp-lfilter__search" :class="{ 'wp-lfilter__search--on': query.length > 0 }">
      <i class="pi pi-search" aria-hidden="true" />
      <input
        v-model="query"
        type="text"
        :placeholder="`Filter ${total} ${noun}…`"
        :aria-label="`Filter ${noun}`"
        spellcheck="false"
        autocomplete="off"
        :data-test="`${testPrefix}-search`"
      />
      <button
        v-if="query"
        type="button"
        class="wp-lfilter__clearx"
        aria-label="Clear filter"
        @click="query = ''"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </label>
    <span class="wp-lfilter__count" :data-test="`${testPrefix}-count`">
      <template v-if="query.trim().length > 0">
        <!-- data-zero rather than a class so the "no matches" state is one
             attribute selector, and so a test can assert it without matching
             on colour. -->
        <span class="wp-lfilter__n" :data-zero="visible === 0 ? '' : null">
          {{ visible }} of {{ total }}
        </span>
        <button
          type="button"
          class="wp-lfilter__clear"
          :data-test="`${testPrefix}-clear`"
          @click="query = ''"
        >Clear</button>
      </template>
      <span v-else class="wp-lfilter__idle">{{ total }} {{ noun }}</span>
    </span>
  </div>
</template>

<style scoped>
.wp-lfilter {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  /* Card's header puts a `.wp-spacer` (flex: 1) between the title and this
     slot. With a grow factor of 1 the two split the free space evenly and the
     search box ends up half the width it should be. A far larger factor takes
     effectively all of the slack while leaving the spacer in place, which is
     what still separates the title from the controls. Inherited from the
     fixed-values filter this was extracted from — the same header, the same
     problem. */
  flex: 1000 1 auto;
  /* A floor, not a width. Below this the input is too small to read what you
     typed, so the card header (which wraps) drops the filter onto its own row
     instead of shaving it to nothing. The derivation card, with four buttons
     beside it, is the case that forces this. */
  min-width: 220px;
  margin-right: var(--wp-space-4);
}

.wp-lfilter__search {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  gap: var(--wp-space-3);
  padding: 0 var(--wp-space-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-surface-2);
  transition: border-color 120ms ease;
}

.wp-lfilter__search--on { border-color: var(--wp-accent-500); }
.wp-lfilter__search .pi { font-size: 11px; color: var(--wp-text-dim); }

.wp-lfilter__search input {
  /* 13ch basis is what the fixed-values filter used as a fixed width; keeping
     it as the BASIS means a roomy header grows the box instead of leaving
     slack, while a cramped one can still shrink rather than pushing the
     card's buttons out of the row. */
  flex: 1 1 13ch;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--wp-text);
  font: inherit;
  padding: 4px 0;
  outline: none;
}

.wp-lfilter__clearx {
  display: flex;
  border: 0;
  background: none;
  color: var(--wp-text-dim);
  cursor: pointer;
  padding: 0;
}

.wp-lfilter__clearx:hover { color: var(--wp-text); }

.wp-lfilter__count {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  font-size: var(--wp-font-size-xs);
  white-space: nowrap;
}

.wp-lfilter__n { color: var(--wp-text-dim); font-family: var(--wp-font-mono); }
.wp-lfilter__n[data-zero] { color: var(--wp-danger); }
.wp-lfilter__idle { color: var(--wp-text-dim); font-family: var(--wp-font-mono); }

.wp-lfilter__clear {
  border: 0;
  background: none;
  padding: 0;
  color: var(--wp-accent-500);
  cursor: pointer;
  font: inherit;
}

.wp-lfilter__clear:hover { text-decoration: underline; }
</style>
