<script setup lang="ts" generic="T extends string">
/**
 * Segmented radio group for 2–4 short choices (theme, density, …). A select
 * hides the alternatives behind a click; for this few, showing them all is
 * faster to read and to change.
 */
export interface SegOption<V extends string> { value: V; label: string; icon?: string }

const props = defineProps<{
  modelValue: T;
  options: SegOption<T>[];
  ariaLabel: string;
  testPrefix?: string;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: T): void }>();

function pick(v: T): void {
  if (v !== props.modelValue) emit("update:modelValue", v);
}
</script>

<template>
  <div class="wp-seg" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      class="wp-seg__opt"
      :aria-checked="modelValue === o.value"
      :data-active="modelValue === o.value ? 'true' : 'false'"
      :data-test="testPrefix ? `${testPrefix}-${o.value}` : undefined"
      @click="pick(o.value)"
    >
      <i v-if="o.icon" class="pi" :class="o.icon" aria-hidden="true" />{{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.wp-seg {
  display: inline-flex;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius);
  overflow: hidden;
  flex: none;
}
.wp-seg__opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0;
  border-left: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted);
  font: inherit;
  font-size: var(--wp-text-sm);
  cursor: pointer;
  white-space: nowrap;
}
.wp-seg__opt:first-child { border-left: 0; }
.wp-seg__opt:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-seg__opt[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  color: var(--wp-accent-text);
  font-weight: 600;
}
.wp-seg__opt:focus-visible { outline: 2px solid var(--wp-accent-500); outline-offset: -2px; }
.wp-seg .pi { font-size: 12px; }
</style>
