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

const FACTOR_STEP = 0.1;
function bump(dir: 1 | -1): void {
  const cur = Number(inputValue.value);
  const base = Number.isFinite(cur) ? cur : props.libraryFactor;
  const next = Math.max(0, Math.round((base + dir * FACTOR_STEP) * 10) / 10);
  inputValue.value = String(next);
}
</script>

<template>
  <div class="cfp" role="dialog" :aria-label="`Edit factor for ${label}`">
    <div class="cfp__head">{{ label }}</div>
    <label class="cfp__row">
      <span class="cfp__field-label">Factor</span>
      <span class="cfp__input-wrap" @wheel.stop>
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
        <span class="cfp__spin">
          <button
            type="button"
            class="cfp__spin-btn"
            tabindex="-1"
            data-test="cfp-up"
            aria-label="Increase factor"
            @click="bump(1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
          </svg></button>
          <button
            type="button"
            class="cfp__spin-btn"
            tabindex="-1"
            data-test="cfp-down"
            aria-label="Decrease factor"
            @click="bump(-1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
          </svg></button>
        </span>
      </span>
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
.cfp__input-wrap {
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  height: 24px;
  overflow: hidden;
}
.cfp__input-wrap:focus-within { border-color: var(--wp-accent); }
.cfp__input {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0 6px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  text-align: right;
  width: 100%;
  min-width: 0;
  -moz-appearance: textfield;
}
.cfp__input::-webkit-outer-spin-button,
.cfp__input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.cfp__input:focus { outline: none; color: var(--wp-text); }
.cfp__spin {
  display: flex;
  flex-direction: column;
  width: 14px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border);
  background: var(--wp-bg);
}
.cfp__spin-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  line-height: 0;
}
.cfp__spin-btn + .cfp__spin-btn {
  border-top: 1px solid var(--wp-border);
}
.cfp__spin-btn:hover { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99, 102, 241, 0.10); }
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
