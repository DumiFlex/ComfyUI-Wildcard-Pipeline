<script setup lang="ts">
/**
 * The one search box: an inline magnifier, the text, an optional match count
 * or shortcut, and a ✕ that clears it.
 *
 * It replaced three look-alikes (ListFilter's own box, the import/export
 * PickerSearch, Input with a boxed search addon) and a dozen hand-built ones.
 * Lives in `components/shared/` and reads only SHARED_TOKENS, so the canvas
 * pickers and the manager draw the same box in their own colours. Canvas
 * callers pass `size="sm"`.
 *
 * - Attributes (`data-test`, `@keydown`, `@focus`…) land on the `<input>`;
 *   `class`, `style` and `data-ai-*` stay on the box so a parent can size it.
 * - `visible` + `total` show "3 of 12" while there is a query; add `noun` to
 *   also show "12 rules" when it's empty.
 * - Escape with text clears it and stops there; an empty box lets Escape
 *   through so a dialog around it still closes.
 * - The count and ✕ get `<testPrefix>-count` / `<testPrefix>-clear`, where
 *   `testPrefix` defaults to the input's own `data-test`.
 * - `focus()` and `select()` are exposed for pickers that focus on open.
 */
import Kbd from "./Kbd.vue";
import { computed, ref, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    placeholder?: string | undefined;
    ariaLabel?: string | undefined;
    size?: "sm" | "md" | "lg" | undefined;
    /** Rows after filtering. With `total`, shows "visible of total". */
    visible?: number | undefined;
    total?: number | undefined;
    /** Plural noun for the idle count ("12 rules"). */
    noun?: string | undefined;
    /** A key hint shown while the box is empty, e.g. "/" or "Ctrl K". */
    shortcut?: string | undefined;
    clearLabel?: string | undefined;
    disabled?: boolean | undefined;
    testPrefix?: string | undefined;
  }>(),
  { placeholder: "Search…", size: "md", clearLabel: "Clear search" },
);

const query = defineModel<string>({ required: true });

const attrs = useAttrs();
/** The box keeps `class`, `style` and the AI pointer's `data-ai-*` marks (so
 *  the pointer rings the whole box); everything else goes to the input. */
const onRoot = (k: string): boolean => k === "class" || k === "style" || k.startsWith("data-ai-");
const rootAttrs = computed(() => Object.fromEntries(Object.entries(attrs).filter(([k]) => onRoot(k))));
const inputAttrs = computed(() => Object.fromEntries(Object.entries(attrs).filter(([k]) => !onRoot(k))));
const prefix = computed(() => props.testPrefix ?? (attrs["data-test"] as string | undefined));
const tid = (suffix: string): string | undefined => (prefix.value ? `${prefix.value}-${suffix}` : undefined);

const hasQuery = computed(() => query.value.trim().length > 0);
const counted = computed(() => props.total !== undefined && props.visible !== undefined);

const field = ref<HTMLInputElement | null>(null);

function clear(): void {
  query.value = "";
  field.value?.focus();
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && query.value) {
    ev.preventDefault();
    ev.stopPropagation();
    query.value = "";
  }
}

defineExpose({
  focus: () => field.value?.focus(),
  select: () => field.value?.select(),
  el: field,
});
</script>

<template>
  <label
    class="wp-search"
    :class="[`wp-search--${size}`, { 'wp-search--on': hasQuery, 'is-disabled': disabled }]"
    v-bind="rootAttrs"
  >
    <i class="pi pi-search wp-search__icon" aria-hidden="true" />
    <input
      ref="field"
      v-model="query"
      class="wp-search__field"
      type="text"
      role="searchbox"
      :placeholder="placeholder"
      :aria-label="ariaLabel ?? placeholder"
      :disabled="disabled"
      spellcheck="false"
      autocomplete="off"
      v-bind="inputAttrs"
      @keydown="onKeydown"
    />
    <span
      v-if="counted && (hasQuery || noun)"
      class="wp-search__count"
      :data-zero="hasQuery && visible === 0 ? '' : null"
      :data-test="tid('count')"
      aria-live="polite"
    >
      <template v-if="hasQuery">{{ visible }} of {{ total }}</template>
      <template v-else>{{ total }} {{ noun }}</template>
    </span>
    <Kbd v-if="shortcut && !query" class="wp-search__kbd" :keys="shortcut" size="sm" aria-hidden="true" />
    <button
      v-if="query"
      type="button"
      class="wp-search__clear"
      :aria-label="clearLabel"
      :data-test="tid('clear')"
      :disabled="disabled"
      @click.prevent="clear"
    >
      <i class="pi pi-times" aria-hidden="true" />
    </button>
  </label>
</template>

<style scoped>
.wp-search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  min-width: 0;
  height: var(--wp-control-h-md);
  padding: 0 var(--wp-space-2) 0 var(--wp-space-3);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans);
  font-size: var(--wp-text-sm);
  cursor: text;
  transition: border-color var(--wp-motion-quick), box-shadow var(--wp-motion-quick);
}
.wp-search--sm { height: var(--wp-control-h-sm); font-size: var(--wp-text-xs); gap: var(--wp-space-1); padding-left: var(--wp-space-2); }
.wp-search--lg { height: var(--wp-control-h-lg); font-size: var(--wp-text-base); padding-left: var(--wp-space-4); }
.wp-search:hover { border-color: var(--wp-border-strong); }
.wp-search:focus-within { border-color: var(--wp-border-focus); box-shadow: var(--wp-focus-ring); }
.wp-search--on { border-color: var(--wp-accent-500); }
.wp-search.is-disabled { opacity: 0.45; cursor: not-allowed; }

.wp-search__icon { flex-shrink: 0; font-size: 12px; line-height: 1; color: var(--wp-text-dim); }
.wp-search--sm .wp-search__icon { font-size: 10px; }
.wp-search--on .wp-search__icon,
.wp-search:focus-within .wp-search__icon { color: var(--wp-text-muted); }

.wp-search__field {
  flex: 1 1 8ch;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  outline: none;
}
.wp-search__field::placeholder { color: var(--wp-text-dim); }
.wp-search__field:disabled { cursor: not-allowed; }

.wp-search__count {
  flex-shrink: 0;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.wp-search__count[data-zero] { color: var(--wp-danger); }

.wp-search__kbd { flex-shrink: 0; }

/* 20 px hit area even in the 24 px box; the mark draws at 9 px. */
.wp-search__clear {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--wp-radius-sm);
  background: none;
  color: var(--wp-text-dim);
  cursor: pointer;
}
.wp-search__clear .pi { font-size: 9px; line-height: 1; }
.wp-search__clear:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-search__clear:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
</style>
