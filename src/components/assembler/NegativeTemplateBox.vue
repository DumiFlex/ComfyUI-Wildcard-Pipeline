<script setup lang="ts">
/**
 * The Assembler's `negative_template` box: the same editor as the prompt
 * template behind a collapsible header, with the negative (danger) accent.
 *
 * Heights are fixed on purpose (header 30px, open box 100px, both on the
 * LiteGraph 10px grid) so the mount glue can report an exact content height
 * and the node gives every spare pixel to the prompt editor above instead of
 * leaving a dead band here.
 */
import { computed, defineAsyncComponent } from "vue";
import ListRow from "@/kit/ListRow.vue";
import type { VarProducer } from "../../extension/graph";

const RichTextInput = defineAsyncComponent(() => import("../../manager/components/RichTextInput.vue"));

const props = defineProps<{
  modelValue: string;
  collapsed: boolean;
  /** Driven by a STRING link: read-only, like the prompt template. */
  linked: boolean;
  varSuggestions: string[];
  varProducers: Map<string, VarProducer>;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "toggle"): void;
}>();

/** One-line summary shown in the collapsed header. */
const summary = computed(() => {
  if (props.linked) return "driven by the connected input";
  const t = props.modelValue.trim().replace(/\s+/g, " ");
  return t || "empty: just the variables' negatives";
});
</script>

<template>
  <div
    class="wp-negbox"
    :class="{ 'wp-negbox--collapsed': collapsed }"
    data-test="neg-template-box"
  >
    <ListRow
      size="sm"
      :icon="collapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
      class="wp-negbox__head"
      :aria-expanded="!collapsed"
      aria-controls="wp-negbox-body"
      data-test="neg-template-toggle"
      :data-wp-socket="collapsed ? 'negative_template' : undefined"
      :title="collapsed ? 'Show the negative template' : 'Hide the negative template'"
      @click="emit('toggle')"
    >
      <span class="wp-negbox__line">
        <span class="wp-negbox__label">negative</span>
        <span v-if="collapsed" class="wp-negbox__summary" data-test="neg-template-summary">{{ summary }}</span>
        <span v-else-if="linked" class="wp-negbox__summary">driven by the connected input</span>
      </span>
    </ListRow>
    <div v-if="!collapsed" class="wp-negbox__body" data-wp-socket="negative_template">
      <RichTextInput
        :model-value="modelValue"
        surface="assembler"
        multiline
        :rows="2"
        fill
        :placeholder="linked
          ? 'Driven by the connected input — disconnect it to edit here.'
          : '$negatives'"
        :disabled="linked"
        :var-suggestions="varSuggestions"
        :var-producers="varProducers"
        graph-aware
        aria-label="Negative template"
        @update:model-value="(v: string) => emit('update:modelValue', v)"
      />
    </div>
  </div>
</template>

<style scoped>
/* Tokens (`--wp-*`) resolve from the theme the Assembler helper already
   loads; not @imported here so this chunk stays small (bundle gate). */
.wp-negbox {
  display: flex;
  flex-direction: column;
  height: 100px;
  box-sizing: border-box;
  padding: 0 6px;
  font-family: var(--wp-font-sans);
  color: var(--wp-text);
}
.wp-negbox--collapsed { height: 30px; }
/* A kit ListRow (sm) in the negative's danger colour, held at the 26px header. */
.wp-negbox__head {
  --wp-list-row-icon: var(--wp-danger);
  gap: 6px;
  height: 26px;
  min-height: 26px;
  flex: 0 0 26px;
  padding: 0 2px;
  color: var(--wp-danger);
  font: 500 11px/1 var(--wp-font-sans);
  text-transform: lowercase;
}
.wp-negbox__head:hover:not(:disabled) { color: var(--wp-danger); }
.wp-negbox__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wp-negbox__summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--wp-text-dim);
  font: 11px/1 var(--wp-font-mono);
  text-transform: none;
}
.wp-negbox__body {
  flex: 1 1 0%;
  min-height: 0;
  padding-bottom: 4px;
}
/* Negative accent on the editor frame. The editor is a child component, so
   reach its root through :deep(). */
.wp-negbox__body :deep(.wp-rt) {
  border-color: color-mix(in srgb, var(--wp-danger) 45%, var(--wp-border));
  background: color-mix(in srgb, var(--wp-danger) 6%, var(--wp-bg-2, var(--wp-bg)));
}
.wp-negbox__body :deep(.wp-rt.wp-rt--focused) { border-color: var(--wp-danger); }
.wp-negbox__body :deep(.wp-rt__host--multi) { min-height: 0; }
</style>
