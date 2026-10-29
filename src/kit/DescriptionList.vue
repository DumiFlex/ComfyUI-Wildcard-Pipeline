<script setup lang="ts">
/**
 * Description list: label and value rows (an item's details, a step of the
 * trace, model info). Labels line up in one column and values in the next;
 * `stacked` puts each label above its value for a narrow panel. Works on the
 * canvas and in the manager.
 *
 *   <DescriptionList :items="[{ label: 'Family', value: 'SDXL' }, { label: 'ID', value: id, mono: true, copy: true }]" />
 *   <DescriptionList :items="rows"><template #value-status="{ item }"><Badge dot tone="success" text="Live" /></template></DescriptionList>
 *
 * A value that is empty draws a dim dash. A row with `key` can fill its value
 * from the `value-<key>` slot.
 */
import CopyButton from "./CopyButton.vue";

export interface DescriptionItem {
  label: string;
  value?: string | number | null | undefined;
  /** Names the `value-<key>` slot for this row. */
  key?: string | undefined;
  /** Draw the value in the mono font (ids, seeds, paths). */
  mono?: boolean | undefined;
  /** Add a copy button after the value. */
  copy?: boolean | undefined;
}

withDefaults(defineProps<{
  items: DescriptionItem[];
  layout?: "columns" | "stacked" | undefined;
  size?: "sm" | "md" | undefined;
  /** Lines between rows. */
  divided?: boolean | undefined;
}>(), { layout: "columns", size: "md" });

const empty = (v: DescriptionItem["value"]): boolean => v === undefined || v === null || v === "";
</script>

<template>
  <dl class="wp-dl" :data-layout="layout" :data-size="size" :data-divided="divided || undefined">
    <div v-for="(it, i) in items" :key="it.key ?? `${i}-${it.label}`" class="wp-dl__row">
      <dt class="wp-dl__label">{{ it.label }}</dt>
      <dd class="wp-dl__value" :data-mono="it.mono || undefined">
        <slot v-if="it.key && $slots[`value-${it.key}`]" :name="`value-${it.key}`" :item="it" />
        <template v-else-if="empty(it.value)"><span class="wp-dl__empty" aria-label="None">—</span></template>
        <template v-else>
          <span class="wp-dl__text">{{ it.value }}</span>
          <CopyButton v-if="it.copy" :text="String(it.value)" :label="`Copy ${it.label}`" size="sm" class="wp-dl__copy" />
        </template>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.wp-dl {
  display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: var(--wp-space-6); row-gap: var(--wp-space-3);
  margin: 0; min-width: 0; font: 400 var(--wp-text-sm)/1.45 var(--wp-font-sans);
}
.wp-dl[data-size="sm"] { column-gap: var(--wp-space-5); row-gap: var(--wp-space-2); font-size: var(--wp-text-xs); }
.wp-dl__row { display: contents; }
.wp-dl__label { margin: 0; color: var(--wp-text-muted); }
.wp-dl__value { display: flex; align-items: center; gap: var(--wp-space-2); min-width: 0; margin: 0; color: var(--wp-text); }
.wp-dl__text { min-width: 0; overflow-wrap: anywhere; }
.wp-dl__value[data-mono] .wp-dl__text { font-family: var(--wp-font-mono); font-size: 0.95em; }
.wp-dl__empty { color: var(--wp-text-dim); }
.wp-dl__copy { margin: -4px 0; }
.wp-dl[data-divided] { row-gap: 0; }
.wp-dl[data-divided] .wp-dl__label, .wp-dl[data-divided] .wp-dl__value { padding: var(--wp-space-3) 0; border-top: 1px solid var(--wp-border-soft); }
.wp-dl[data-divided] .wp-dl__row:first-child > * { border-top: 0; }
.wp-dl[data-layout="stacked"] { grid-template-columns: minmax(0, 1fr); row-gap: var(--wp-space-4); }
.wp-dl[data-layout="stacked"] .wp-dl__row { display: flex; flex-direction: column; gap: 2px; }
.wp-dl[data-layout="stacked"] .wp-dl__label { font-size: var(--wp-text-xs); font-weight: 600; }
</style>
