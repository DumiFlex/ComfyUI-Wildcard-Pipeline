<script setup lang="ts">
/**
 * Split pane: two panels side by side (or one above the other) with a
 * handle between them that drags, takes focus and moves with the arrow
 * keys. v-model is the first panel's size in px; the second panel takes the
 * rest. Works on the canvas and in the manager.
 *
 *   <SplitPane v-model="listWidth" :min="200" :max="520" :default-size="280" label="List width">
 *     <template #start>…list…</template>
 *     <template #end>…detail…</template>
 *   </SplitPane>
 *
 * The parent decides the pane's own height (or width, when stacked). Keep
 * the size in a ref, or in the user's settings to remember it.
 */
import { useId } from "vue";
import ResizeHandle from "./ResizeHandle.vue";

withDefaults(defineProps<{
  /** The first panel's size in px. */
  modelValue: number;
  /** horizontal: side by side. vertical: one above the other. */
  orientation?: "horizontal" | "vertical";
  min?: number;
  max?: number;
  defaultSize?: number;
  /** What the handle resizes, for screen readers. */
  label?: string;
  disabled?: boolean;
}>(), { orientation: "horizontal", min: 120, max: Number.POSITIVE_INFINITY, defaultSize: undefined, label: "Resize panels" });

const emit = defineEmits<{ (e: "update:modelValue", v: number): void; (e: "end", v: number): void }>();
const startId = `wp-split-${useId()}`;
</script>

<template>
  <div class="wp-split" :data-orientation="orientation">
    <div
      :id="startId"
      class="wp-split__start"
      :style="orientation === 'horizontal' ? { width: `${modelValue}px` } : { height: `${modelValue}px` }"
    >
      <slot name="start" />
    </div>
    <ResizeHandle
      :model-value="modelValue"
      :axis="orientation === 'horizontal' ? 'x' : 'y'"
      :min="min"
      :max="max"
      :default-size="defaultSize"
      :label="label"
      :controls="startId"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
      @end="emit('end', $event)"
    />
    <div class="wp-split__end"><slot name="end" /></div>
  </div>
</template>

<style scoped>
.wp-split { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.wp-split[data-orientation="vertical"] { flex-direction: column; }
.wp-split__start { flex: none; min-width: 0; min-height: 0; overflow: auto; }
.wp-split__end { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.wp-split[data-orientation="horizontal"] > .wp-split__start { border-right: 1px solid var(--wp-border); }
.wp-split[data-orientation="vertical"] > .wp-split__start { border-bottom: 1px solid var(--wp-border); }
</style>
