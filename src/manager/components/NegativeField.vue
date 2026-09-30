<script setup lang="ts">
/**
 * NegativeField — the per-row "Negative" line under a value (send-to-negative,
 * schema v8).
 *
 * Collapsed to a dashed `+ negative` ghost button while empty; a NEG-tagged
 * RichTextInput once it holds text (or the user opened it). Every
 * RichTextInput prop the host passes (`surface`, the `@{}` ref maps,
 * `refSuggestions`, …) is forwarded through `$attrs`, so the negative gets the
 * same chips, remap popup and grammar as the value field above it.
 *
 * Emits `undefined` for an empty (or whitespace-only) negative: the host
 * stores that as an ABSENT key (`setNegative`), so a payload only stamps
 * schema v8 when a negative is really there.
 */
import { computed, nextTick, ref } from "vue";
import RichTextInput from "./RichTextInput.vue";
import { isBlankNegative } from "../utils/negatives";

defineOptions({ inheritAttrs: false });

interface Props {
  modelValue?: string;
  /** Labels of `@{}` refs in the negative that are not in the library. The
   *  row shows the same "not in the library" note the value field does. */
  brokenRefs?: string[];
  placeholder?: string;
  /** What the negative belongs to, for the accessible names. */
  label?: string;
  testId?: string;
  /** Skip the collapsed ghost button — for a host that already labels the
   *  field "Negative" (the combine editor). */
  alwaysOpen?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: undefined,
  brokenRefs: () => [],
  placeholder: "words to keep out of the image",
  label: "option",
  testId: undefined,
  alwaysOpen: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string | undefined];
}>();

const rootEl = ref<HTMLElement | null>(null);
/** Opened by the ghost button but still empty — keeps the input on screen
 *  while the user types their first character. */
const opened = ref(false);
const hasText = computed(() => (props.modelValue ?? "").trim().length > 0);
const expanded = computed(() => props.alwaysOpen || hasText.value || opened.value);

async function open(): Promise<void> {
  opened.value = true;
  await nextTick();
  const host = rootEl.value?.querySelector<HTMLElement>("[contenteditable='true']");
  host?.focus();
}

function onInput(v: string): void {
  emit("update:modelValue", isBlankNegative(v) ? undefined : v);
}

/** Leaving an empty field folds it back to the ghost button. */
function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null;
  if (next && rootEl.value?.contains(next)) return;
  if (!hasText.value) opened.value = false;
}

function clear(): void {
  opened.value = false;
  emit("update:modelValue", undefined);
}
</script>

<template>
  <div ref="rootEl" class="wp-negfield" :data-test="testId" @focusout="onFocusOut">
    <button
      v-if="!expanded"
      type="button"
      class="wp-negfield__add"
      :aria-label="`Add a negative to this ${label}`"
      :data-test="testId ? `${testId}-add` : undefined"
      @click="open"
    >+ negative</button>
    <template v-else>
      <div class="wp-negfield__row">
        <span class="wp-negfield__tag" title="Negative — goes to the Assembler's negative output when this is used">NEG</span>
        <RichTextInput
          v-bind="$attrs"
          class="wp-negfield__input"
          :model-value="modelValue ?? ''"
          wrap
          :placeholder="placeholder"
          :aria-label="`Negative for this ${label}`"
          @update:model-value="onInput"
        />
        <button
          v-if="!alwaysOpen || hasText"
          type="button"
          class="wp-negfield__clear"
          :aria-label="`Remove the negative from this ${label}`"
          title="Remove negative"
          :data-test="testId ? `${testId}-clear` : undefined"
          @click="clear"
        ><i class="pi pi-times" aria-hidden="true" /></button>
      </div>
      <div v-if="brokenRefs.length" class="wp-negfield__broken" role="note">
        <i class="pi pi-exclamation-triangle" aria-hidden="true" />
        <span>{{ brokenRefs.join(", ") }} not in the library · click the chip to point it at a module</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wp-negfield {
  margin-top: var(--wp-space-2, 6px);
}
.wp-negfield__add {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px dashed var(--wp-border);
  border-radius: var(--wp-radius);
  background: transparent;
  color: var(--wp-text-muted);
  font-family: var(--wp-font-mono, monospace);
  font-size: var(--wp-text-xs, 11px);
  cursor: pointer;
  opacity: 0.75;
  transition: opacity .12s, color .12s, border-color .12s;
}
.wp-negfield__add:hover,
.wp-negfield__add:focus-visible {
  opacity: 1;
  color: var(--wp-danger, #ef4444);
  border-color: color-mix(in oklab, var(--wp-danger, #ef4444) 55%, transparent);
}
.wp-negfield__row {
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-2, 6px);
}
.wp-negfield__tag {
  flex: none;
  margin-top: 7px;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--wp-danger, #ef4444);
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 14%, transparent);
}
.wp-negfield__input {
  flex: 1;
  min-width: 0;
}
.wp-negfield__input.wp-rt:not(.wp-rt--focused) {
  border-color: color-mix(in oklab, var(--wp-danger, #ef4444) 45%, transparent);
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 7%, var(--wp-bg-2));
}
.wp-negfield__clear {
  flex: none;
  margin-top: 4px;
  padding: 3px 5px;
  border: none;
  background: transparent;
  color: var(--wp-text-muted);
  cursor: pointer;
  border-radius: 4px;
}
.wp-negfield__clear:hover { color: var(--wp-danger, #ef4444); }
.wp-negfield__broken {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2, 6px);
  margin-top: var(--wp-space-2, 6px);
  font-size: var(--wp-text-xs, 11px);
  color: var(--wp-danger, #ef4444);
}
</style>
