<script setup lang="ts">
/**
 * One setting: label and hint on the left, its control on the right.
 *
 * `settingKey` is the anchor the Settings search jumps to (`#<key>`) and the
 * row briefly highlights when it is the target. `stacked` puts the control
 * under the text, for wide controls (a colour picker, a path list).
 */
import { computed } from "vue";
import { useRoute } from "vue-router";

const props = defineProps<{
  label: string;
  hint?: string;
  settingKey?: string;
  stacked?: boolean;
  /** Control id, so the label is a real <label for>. */
  for?: string;
}>();

const route = useRoute();
const targeted = computed(() => !!props.settingKey && route?.hash === `#${props.settingKey}`);
</script>

<template>
  <div
    :id="settingKey"
    class="wp-set-row"
    :class="{ 'wp-set-row--stacked': stacked, 'wp-set-row--target': targeted }"
    :data-setting="settingKey"
  >
    <div class="wp-set-row__text">
      <label v-if="props.for" class="wp-set-row__label" :for="props.for">{{ label }}<slot name="badge" /></label>
      <span v-else class="wp-set-row__label">{{ label }}<slot name="badge" /></span>
      <p v-if="hint" class="wp-set-row__hint">{{ hint }}</p>
      <slot name="extra" />
    </div>
    <div class="wp-set-row__control">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.wp-set-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-6);
  padding: var(--wp-space-5) var(--wp-space-6);
  border-top: 1px solid var(--wp-border);
  scroll-margin-top: 80px;
}
.wp-set-row:first-child { border-top: 0; }
.wp-set-row--stacked { flex-direction: column; align-items: stretch; gap: var(--wp-space-4); }
.wp-set-row--target { animation: wp-set-row-flash 1.6s ease-out 1; }
@keyframes wp-set-row-flash {
  0%, 30% { background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent); }
  100% { background: transparent; }
}
.wp-set-row__text { flex: 1; min-width: 0; }
.wp-set-row__label {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  font-size: var(--wp-text-sm);
  font-weight: 600;
  color: var(--wp-text);
}
.wp-set-row__hint {
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--wp-text-dim);
}
.wp-set-row__control {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  max-width: 55%;
}
.wp-set-row--stacked .wp-set-row__control { max-width: none; flex-wrap: wrap; }
.wp-set-row__control :deep(.wp-select) { min-width: 200px; }
@media (max-width: 720px) {
  .wp-set-row { flex-direction: column; align-items: stretch; }
  .wp-set-row__control { max-width: none; }
}
</style>
