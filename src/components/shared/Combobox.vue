<script setup lang="ts" generic="T extends string | number">
/**
 * A select you can type in: the list filters as you type, the arrows light
 * an option and Enter takes it. With `multiple` the picks sit as chips in
 * the box, the list stays open and marks what is picked, and Backspace in
 * the empty box takes the last pick off. The list floats in a kit Popover,
 * so it follows the box on scroll. Use WpSelect for a short fixed list and
 * TagInput when people may type their own words.
 *
 *   <Combobox v-model="model" :options="models" aria-label="Model" />
 *   <Combobox v-model="cats" multiple :options="categories" aria-label="Categories" />
 *
 * APG "combobox with list autocomplete": focus stays in the text field and
 * the lit option is named by aria-activedescendant.
 */
import { computed, nextTick, ref, useId, watch } from "vue";
import Popover from "./Popover.vue";

export interface ComboOption<V> { value: V; label: string; hint?: string; disabled?: boolean }

const props = withDefaults(defineProps<{
  modelValue: T | null | T[];
  options: ComboOption<T>[];
  multiple?: boolean;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  /** Show a ✕ that clears a single pick. */
  clearable?: boolean;
  /** What the list says when nothing matches. */
  emptyText?: string;
  /** How many options the list shows at once (it scrolls past that). */
  limit?: number;
}>(), {
  multiple: false, placeholder: "Choose…", size: "md", ariaLabel: "Choose",
  clearable: false, emptyText: "No matches", limit: 50,
});

const emit = defineEmits<{ (e: "update:modelValue", v: T | null | T[]): void }>();

const uid = useId();
const listId = `wp-combo-list-${uid}`;
const inputEl = ref<HTMLInputElement | null>(null);
const query = ref("");
const typing = ref(false);
const wanted = ref(false);
const active = ref(-1);
const said = ref("");

const picks = computed<T[]>(() => {
  const v = props.modelValue;
  if (Array.isArray(v)) return v;
  return v === null || v === undefined ? [] : [v];
});
const isPicked = (v: T): boolean => picks.value.includes(v);
const labelOf = (v: T): string => props.options.find((o) => o.value === v)?.label ?? String(v);
const single = computed(() => (!props.multiple && picks.value.length ? labelOf(picks.value[0]) : ""));

const matches = computed(() => {
  const q = typing.value ? query.value.trim().toLowerCase() : "";
  const hit = q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options;
  return [...hit.filter((o) => o.label.toLowerCase().startsWith(q)), ...hit.filter((o) => !o.label.toLowerCase().startsWith(q))]
    .slice(0, props.limit);
});
const open = computed(() => wanted.value && !props.disabled);
const activeId = computed(() => (open.value && active.value >= 0 ? `${listId}-${active.value}` : undefined));

// The text field shows the single pick's label while you are not typing.
watch(single, (l) => { if (!typing.value) query.value = l; }, { immediate: true });

function announce(text: string): void {
  said.value = "";
  void nextTick(() => { said.value = text; });
}

function choose(o: ComboOption<T>): void {
  if (o.disabled) return;
  if (props.multiple) {
    const on = isPicked(o.value);
    emit("update:modelValue", on ? picks.value.filter((v) => v !== o.value) : [...picks.value, o.value]);
    announce(`${on ? "Removed" : "Added"} ${o.label}`);
    query.value = "";
    typing.value = false;
    return;
  }
  emit("update:modelValue", o.value);
  typing.value = false;
  query.value = o.label;
  wanted.value = false;
  active.value = -1;
}

function removeAt(i: number, refocus = false): void {
  const v = picks.value[i];
  if (v === undefined || props.disabled) return;
  emit("update:modelValue", picks.value.filter((_, j) => j !== i));
  announce(`Removed ${labelOf(v)}`);
  if (refocus) inputEl.value?.focus();
}

function clear(): void {
  emit("update:modelValue", props.multiple ? [] : null);
  query.value = "";
  typing.value = false;
  announce("Cleared");
  inputEl.value?.focus();
}

function step(dir: 1 | -1): void {
  const n = matches.value.length;
  if (!n) return;
  let i = active.value;
  for (let k = 0; k < n; k++) {
    i = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
    if (!matches.value[i].disabled) break;
  }
  active.value = i;
  void nextTick(() => document.getElementById(`${listId}-${i}`)?.scrollIntoView?.({ block: "nearest" }));
}

function onKeydown(ev: KeyboardEvent): void {
  if (props.disabled) return;
  switch (ev.key) {
    case "ArrowDown":
    case "ArrowUp":
      ev.preventDefault();
      if (!wanted.value) { wanted.value = true; if (ev.altKey) return; }
      step(ev.key === "ArrowDown" ? 1 : -1);
      return;
    case "Enter": {
      const o = open.value && active.value >= 0 ? matches.value[active.value] : undefined;
      if (!o) return;
      ev.preventDefault();
      choose(o);
      return;
    }
    case "Escape":
      if (typing.value && !props.multiple) { typing.value = false; query.value = single.value; }
      return;
    case "Backspace":
      if (props.multiple && query.value === "" && picks.value.length) {
        ev.preventDefault();
        removeAt(picks.value.length - 1);
      }
      return;
    default:
  }
}

function onInput(): void {
  typing.value = true;
  wanted.value = true;
  active.value = matches.value.findIndex((o) => !o.disabled);
}

function onBlur(): void {
  wanted.value = false;
  active.value = -1;
  if (!props.multiple) { typing.value = false; query.value = single.value; }
  else query.value = "";
}

function pick(o: ComboOption<T>): void {
  choose(o);
  inputEl.value?.focus();
}

function setOpen(v: boolean): void {
  if (!v) { wanted.value = false; active.value = -1; }
}
</script>

<!-- Popover's autofocus prop is off here: focus stays in the box you type in. -->
<!-- eslint-disable vuejs-accessibility/no-autofocus -->
<template>
  <Popover :open="open" role="group" match-width :autofocus="false" :label="`${ariaLabel} choices`" @update:open="setOpen">
    <template #trigger>
      <!-- A click on the box's padding focuses the text field, which has the keys. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
      <div
        class="wp-combo"
        :data-size="size"
        :data-multiple="multiple || undefined"
        :data-disabled="disabled || undefined"
        :data-invalid="invalid || undefined"
        @click="inputEl?.focus(); wanted = true"
      >
        <template v-if="multiple">
          <span v-for="(v, i) in picks" :key="String(v)" class="wp-combo__chip">
            <span class="wp-combo__chip-text">{{ labelOf(v) }}</span>
            <button
              type="button"
              class="wp-combo__remove"
              :aria-label="`Remove ${labelOf(v)}`"
              :disabled="disabled"
              @click.stop="removeAt(i, true)"
            ><i class="pi pi-times" aria-hidden="true" /></button>
          </span>
        </template>
        <input
          ref="inputEl"
          v-model="query"
          class="wp-combo__field"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-label="ariaLabel"
          :aria-expanded="open"
          :aria-controls="open ? listId : undefined"
          :aria-activedescendant="activeId"
          :aria-invalid="invalid || undefined"
          :placeholder="multiple && picks.length ? '' : placeholder"
          :disabled="disabled"
          autocomplete="off"
          @focus="wanted = true"
          @blur="onBlur"
          @keydown="onKeydown"
          @input="onInput"
        >
        <button
          v-if="clearable && picks.length && !disabled"
          type="button"
          class="wp-combo__clear"
          aria-label="Clear"
          @mousedown.prevent
          @click.stop="clear"
        ><i class="pi pi-times" aria-hidden="true" /></button>
        <i class="pi pi-chevron-down wp-combo__caret" aria-hidden="true" />
        <span class="wp-combo__sr" aria-live="polite">{{ said }}</span>
      </div>
    </template>
    <ul
      :id="listId"
      class="wp-combo__list"
      role="listbox"
      :aria-label="`${ariaLabel} choices`"
      :aria-multiselectable="multiple || undefined"
    >
      <!-- Options are lit with aria-activedescendant; the text field keeps focus and the keys. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -->
      <li
        v-for="(o, i) in matches"
        :id="`${listId}-${i}`"
        :key="String(o.value)"
        class="wp-combo__opt"
        role="option"
        :aria-selected="isPicked(o.value)"
        :aria-disabled="o.disabled || undefined"
        :data-active="i === active || undefined"
        @mousedown.prevent
        @click="pick(o)"
      >
        <i class="pi pi-check wp-combo__tick" :data-on="isPicked(o.value) || undefined" aria-hidden="true" />
        <span class="wp-combo__opt-text">
          <span>{{ o.label }}</span>
          <span v-if="o.hint" class="wp-combo__hint">{{ o.hint }}</span>
        </span>
      </li>
      <li v-if="!matches.length" class="wp-combo__empty" role="presentation">{{ emptyText }}</li>
    </ul>
  </Popover>
</template>

<style scoped>
.wp-combo {
  --_h: var(--wp-control-h-md);
  position: relative;
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px; box-sizing: border-box;
  width: 100%; min-height: var(--_h); padding: 3px 28px 3px var(--wp-space-3);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  background: var(--wp-bg-1); color: var(--wp-text); cursor: text;
  font: 400 var(--wp-text-sm)/1 var(--wp-font-sans);
  transition: border-color var(--wp-motion-hover), box-shadow var(--wp-motion-hover);
}
.wp-combo[data-size="sm"] { --_h: var(--wp-control-h-sm); padding: 2px 24px 2px var(--wp-space-2); border-radius: var(--wp-radius-sm); font-size: var(--wp-text-xs); gap: 3px; }
.wp-combo[data-size="lg"] { --_h: var(--wp-control-h-lg); padding: 5px 32px 5px var(--wp-space-4); }
.wp-combo:hover { border-color: var(--wp-border-strong); }
.wp-combo:focus-within { border-color: var(--wp-border-focus); box-shadow: 0 0 0 3px var(--wp-focus-ring); }
.wp-combo[data-invalid] { border-color: var(--wp-error-border); }
.wp-combo[data-disabled] { opacity: 0.45; cursor: not-allowed; }
.wp-combo__chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 100%; box-sizing: border-box;
  height: 20px; padding: 0 2px 0 7px;
  border: 1px solid var(--wp-border-strong); border-radius: var(--wp-radius-cap, 999px); background: var(--wp-bg-3);
  color: var(--wp-text); font-size: var(--wp-text-xs); line-height: 1;
}
.wp-combo[data-size="sm"] .wp-combo__chip { height: 16px; padding-left: 5px; font-size: 10.5px; }
.wp-combo__chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-combo__remove, .wp-combo__clear {
  display: inline-grid; place-items: center; width: 16px; height: 16px; padding: 0;
  border: 0; border-radius: min(50%, var(--wp-radius-cap, 999px)); background: transparent; color: var(--wp-text-muted); cursor: pointer;
}
.wp-combo__remove { margin: -2px 0; position: relative; }
.wp-combo__remove::before { content: ""; position: absolute; inset: -2px; }
.wp-combo__remove .pi, .wp-combo__clear .pi { font-size: 8px; }
.wp-combo__clear { position: absolute; right: 24px; top: 50%; transform: translateY(-50%); }
.wp-combo__remove:hover:not(:disabled), .wp-combo__clear:hover { color: var(--wp-text); }
.wp-combo__remove:focus-visible, .wp-combo__clear:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-combo__caret {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  color: var(--wp-text-muted); font-size: 10px; pointer-events: none;
}
.wp-combo[data-size="sm"] .wp-combo__caret { right: 8px; font-size: 9px; }
.wp-combo__field {
  flex: 1 0 6ch; min-width: 6ch; height: calc(var(--_h) - 8px); margin: 0; padding: 0 2px;
  border: 0; outline: none; background: transparent; color: inherit; font: inherit;
  text-overflow: ellipsis;
}
.wp-combo__field::placeholder { color: var(--wp-text-dim); }
.wp-combo__field:disabled { cursor: not-allowed; }
.wp-combo__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.wp-combo__list { margin: calc(var(--wp-space-2) * -1); padding: 0; list-style: none; max-height: 280px; overflow: auto; }
.wp-combo__opt {
  display: flex; align-items: flex-start; gap: var(--wp-space-2);
  padding: 6px var(--wp-space-4) 6px var(--wp-space-2); border-radius: var(--wp-radius-sm);
  color: var(--wp-text); font-size: var(--wp-text-sm); cursor: pointer;
}
.wp-combo__opt:hover, .wp-combo__opt[data-active] { background: var(--wp-row-hover); }
.wp-combo__opt[data-active] { box-shadow: inset 2px 0 0 var(--wp-accent); }
.wp-combo__opt[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
.wp-combo__tick { width: 14px; margin-top: 2px; font-size: 10px; color: var(--wp-accent); visibility: hidden; }
.wp-combo__tick[data-on] { visibility: visible; }
.wp-combo__opt-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-combo__hint { color: var(--wp-text-muted); font-size: var(--wp-text-xs); }
.wp-combo__empty { padding: 6px var(--wp-space-4); color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
@media (prefers-reduced-motion: reduce) {
  .wp-combo { transition: none; }
}
</style>
