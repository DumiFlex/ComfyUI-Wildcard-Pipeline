<script setup lang="ts">
/**
 * The kit IconPicker (every glyph) drawn as a small square like a compact
 * `ColorField`: the glyph in a bordered square, a red slash for none, no
 * caret. WP Toggles uses it for a toggle's icon and a group's icon, next to
 * their colour swatches.
 */
import IconPicker from "@/kit/IconPicker.vue";

defineProps<{
  modelValue: string | null;
  color?: string | undefined;
  ariaLabel?: string | undefined;
  dataTest?: string | undefined;
}>();
const emit = defineEmits<{ "update:modelValue": [v: string | null] }>();
</script>

<template>
  <span class="wp-tg-iconswatch">
    <IconPicker
      :model-value="modelValue"
      all
      compact
      :color="color"
      :aria-label="ariaLabel ?? 'Icon'"
      :data-test="dataTest"
      @update:model-value="(v: string | null) => emit('update:modelValue', v)"
    />
  </span>
</template>

<style scoped>
.wp-tg-iconswatch { display: inline-flex; flex: none; }
.wp-tg-iconswatch :deep(.wp-iconpick__trigger) {
  height: var(--wp-control-h-sm, 24px);
  padding: 0 3px;
  gap: 0;
}
.wp-tg-iconswatch :deep(.wp-iconpick__caret) { display: none; }
.wp-tg-iconswatch :deep(.wp-iconpick__slot) {
  position: relative;
  box-sizing: border-box;
  border: 1px solid var(--wp-border-strong);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font-size: 10px;
  overflow: hidden;
}
/* No icon: the same red slash ColorField draws for None. */
.wp-tg-iconswatch :deep(.wp-iconpick__none) {
  position: absolute;
  inset: 0;
  color: transparent;
  background: linear-gradient(to top right, transparent calc(50% - 1px), var(--wp-danger) 50%, transparent calc(50% + 1px));
}
</style>
