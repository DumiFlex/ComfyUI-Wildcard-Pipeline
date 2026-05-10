<script setup lang="ts">
/**
 * CellFactorPopover — small popover anchored to a constraint cell or
 * exception row's cog button. Shows the override factor input + the
 * library default value + a ↺ reset button (visible only when the
 * override is currently set).
 *
 * Behavior:
 *   - Enter on input → emit `commit` with parsed number, then `close`
 *   - Escape on input → emit `close` (no commit)
 *   - ↺ click → emit `reset` (caller deletes the override key)
 *   - Negative or non-numeric input → reject silently (no commit)
 *
 * Caller is responsible for popover positioning + outside-click
 * close handling. This component is the body only.
 */
import { ref, watch } from "vue";

const props = defineProps<{
  libraryFactor: number;
  overrideFactor: number | null;
  label: string;
}>();

const emit = defineEmits<{
  "commit": [factor: number];
  "reset": [];
  "close": [];
}>();

const inputValue = ref<string>("");

watch(
  () => [props.libraryFactor, props.overrideFactor],
  () => {
    const initial = props.overrideFactor ?? props.libraryFactor;
    inputValue.value = String(initial);
  },
  { immediate: true },
);

function onInput(ev: Event): void {
  inputValue.value = (ev.target as HTMLInputElement).value;
}

function onCommit(): void {
  const parsed = Number(inputValue.value);
  if (!Number.isFinite(parsed) || parsed < 0) return;
  emit("commit", parsed);
  emit("close");
}

function onResetClick(): void {
  emit("reset");
  emit("close");
}

function onEscape(): void {
  emit("close");
}
</script>

<template>
  <div class="cfp" role="dialog" :aria-label="`Edit factor for ${label}`">
    <div class="cfp__head">{{ label }}</div>
    <label class="cfp__row">
      <span class="cfp__field-label">Factor</span>
      <input
        type="number"
        step="0.1"
        min="0"
        class="cfp__input"
        data-test="cfp-input"
        aria-label="Factor"
        :value="inputValue"
        @input="onInput"
        @keydown.enter.prevent="onCommit"
        @keydown.escape.prevent="onEscape"
      />
    </label>
    <div class="cfp__hint" data-test="cfp-library-hint">
      library: {{ libraryFactor }}
    </div>
    <button
      v-if="overrideFactor !== null"
      type="button"
      class="cfp__reset"
      data-test="cfp-reset"
      @click="onResetClick"
    >
      <i class="pi pi-replay" aria-hidden="true" />
      reset to library
    </button>
  </div>
</template>

<style scoped>
.cfp {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-accent);
  border-radius: var(--wp-radius);
  padding: 10px 12px;
  min-width: 200px;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
  font: 11px var(--wp-font-sans);
  color: var(--wp-text);
}
.cfp__head {
  font: 600 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  margin-bottom: 8px;
}
.cfp__row {
  display: grid;
  grid-template-columns: 50px 1fr;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.cfp__field-label {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.cfp__input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 4px 6px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  width: 100%;
  box-sizing: border-box;
}
.cfp__input:focus { border-color: var(--wp-accent); outline: none; }
.cfp__hint {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 6px;
}
.cfp__reset {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
  font: 10px var(--wp-font-sans);
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
}
.cfp__reset:hover {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.cfp__reset .pi { font-size: 9px; }
</style>
