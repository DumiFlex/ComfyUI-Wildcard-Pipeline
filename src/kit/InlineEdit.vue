<script setup lang="ts">
/**
 * Inline edit: a name that turns into a text box where it stands. Click it
 * (or focus it and press Enter or F2), type, then Enter or a click away
 * saves and Escape puts the old text back. Works on the canvas and in the
 * manager.
 *
 *   <InlineEdit v-model="mod.name" label="Wildcard name" />
 *   <InlineEdit v-model="title" label="Chat title" :validate="(v) => taken(v) ? 'That name is taken' : null" />
 *
 * Read view is a button named "Rename <label>: <value>", with a pencil on
 * hover and focus. An empty or invalid value keeps the box open with the
 * message under it; `update:modelValue` only fires on a saved change.
 */
import { computed, nextTick, ref, useId } from "vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  /** What is being renamed, e.g. "Wildcard name". */
  label: string;
  placeholder?: string;
  /** Return a message to refuse the value, or null to take it. */
  validate?: (v: string) => string | null;
  /** Refuse an empty value. On by default. */
  required?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  /** Trim spaces from both ends before saving. */
  trim?: boolean;
  maxlength?: number;
}>(), { placeholder: "Untitled", required: true, size: "md", trim: true, maxlength: undefined });

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "edit"): void;
  (e: "cancel"): void;
}>();

const editing = ref(false);
const draft = ref("");
const error = ref<string | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const readEl = ref<HTMLButtonElement | null>(null);
const errId = `wp-inline-edit-${useId()}`;

const shown = computed(() => props.modelValue || props.placeholder);

async function open(): Promise<void> {
  if (props.disabled || editing.value) return;
  draft.value = props.modelValue;
  error.value = null;
  editing.value = true;
  emit("edit");
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
}

function check(v: string): string | null {
  if (props.required && !v) return `${props.label} can't be empty`;
  return props.validate?.(v) ?? null;
}

async function close(): Promise<void> {
  editing.value = false;
  error.value = null;
  await nextTick();
  readEl.value?.focus();
}

function save(refocus = true): void {
  if (!editing.value) return;
  const v = props.trim ? draft.value.trim() : draft.value;
  const msg = check(v);
  if (msg) {
    error.value = msg;
    return;
  }
  if (v !== props.modelValue) emit("update:modelValue", v);
  if (refocus) void close();
  else { editing.value = false; error.value = null; }
}

function cancel(): void {
  if (!editing.value) return;
  emit("cancel");
  void close();
}

function onBlur(): void {
  // A click away saves; a value that can't be saved is put back instead of
  // leaving a box open that nobody is looking at.
  if (!editing.value) return;
  const v = props.trim ? draft.value.trim() : draft.value;
  if (check(v)) { editing.value = false; error.value = null; emit("cancel"); return; }
  save(false);
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter") { ev.preventDefault(); save(); }
  else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); }
}

function onReadKey(ev: KeyboardEvent): void {
  if (ev.key === "F2") { ev.preventDefault(); void open(); }
}
</script>

<template>
  <span class="wp-inline-edit" :data-size="size" :data-editing="editing || undefined">
    <template v-if="editing">
      <input
        ref="inputEl"
        v-model="draft"
        class="wp-inline-edit__input"
        type="text"
        :aria-label="label"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? errId : undefined"
        :placeholder="placeholder"
        :maxlength="maxlength"
        @keydown="onKeydown"
        @blur="onBlur"
      >
      <span v-if="error" :id="errId" class="wp-inline-edit__error" role="alert">{{ error }}</span>
    </template>
    <button
      v-else
      ref="readEl"
      type="button"
      class="wp-inline-edit__read"
      :data-empty="!modelValue || undefined"
      :aria-label="`Rename ${label}: ${modelValue || placeholder}`"
      :disabled="disabled"
      @click="open"
      @keydown="onReadKey"
    >
      <span class="wp-inline-edit__text">{{ shown }}</span>
      <i class="pi pi-pencil wp-inline-edit__pen" aria-hidden="true" />
    </button>
  </span>
</template>

<style scoped>
.wp-inline-edit {
  --_h: var(--wp-control-h-md);
  position: relative; display: inline-flex; flex-direction: column; align-items: flex-start; min-width: 0; max-width: 100%;
  /* The padding of the hover box sits outside the text's line. */
  margin-left: calc(var(--wp-space-3) * -1);
  font: inherit; vertical-align: middle;
}
.wp-inline-edit[data-size="sm"] { --_h: var(--wp-control-h-sm); }
.wp-inline-edit[data-size="lg"] { --_h: var(--wp-control-h-lg); }
.wp-inline-edit__read, .wp-inline-edit__input {
  box-sizing: border-box; height: var(--_h); margin: 0; min-width: 0;
  padding: 0 var(--wp-space-3); border-radius: var(--wp-radius-sm);
  font: inherit; color: var(--wp-text);
}
.wp-inline-edit__read {
  display: inline-flex; align-items: center; gap: var(--wp-space-3); max-width: 100%;
  border: 1px solid transparent; background: transparent; cursor: text; text-align: left;
  transition: background var(--wp-motion-hover), border-color var(--wp-motion-hover);
}
.wp-inline-edit__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-inline-edit__read[data-empty] .wp-inline-edit__text { color: var(--wp-text-dim); font-style: italic; }
.wp-inline-edit__pen { flex: none; font-size: 0.8em; color: var(--wp-text-dim); opacity: 0; transition: opacity var(--wp-motion-hover); }
.wp-inline-edit__read:hover:not(:disabled) { background: var(--wp-row-hover); border-color: var(--wp-border-soft); }
.wp-inline-edit__read:hover .wp-inline-edit__pen, .wp-inline-edit__read:focus-visible .wp-inline-edit__pen { opacity: 1; }
.wp-inline-edit__read:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-inline-edit__read:disabled { cursor: default; }
.wp-inline-edit__input {
  width: 100%; min-width: 12ch;
  border: 1px solid var(--wp-border-focus); background: var(--wp-bg-1); outline: none;
  box-shadow: 0 0 0 3px var(--wp-focus-ring);
}
.wp-inline-edit__input[aria-invalid="true"] { border-color: var(--wp-error-border); box-shadow: 0 0 0 3px color-mix(in srgb, var(--wp-danger) 22%, transparent); }
.wp-inline-edit__error {
  margin-top: 2px; color: var(--wp-error-text); font: 400 var(--wp-text-xs)/1.3 var(--wp-font-sans);
}
@media (prefers-reduced-motion: reduce) {
  .wp-inline-edit__read, .wp-inline-edit__pen { transition: none; }
}
</style>
