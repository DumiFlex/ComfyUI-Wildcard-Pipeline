<script setup lang="ts">
/**
 * One entity row for a picker section (export picker, import picker).
 *
 * Pure presentational: receives the checked state + badge/warning data
 * from the parent, emits `update:checked` when the user toggles. No
 * knowledge of section/bucket logic — that's PickerSection's job.
 *
 * `indent` lets a parent express nesting (e.g. a wildcard inside a
 * bundle row gets `indent=1`); each level adds 16px of left padding.
 */
import Checkbox from "../components/ui/Checkbox.vue";

export interface Badge {
  label: string;
  /**
   * - `info`  — neutral chip (e.g. "migrated from v0")
   * - `warn`  — amber chip (e.g. "fingerprint differs from library")
   * - `error` — red chip (e.g. "uuid collision")
   */
  kind: "info" | "warn" | "error";
}

interface Props {
  uuid: string;
  name: string;
  checked: boolean;
  badges: Badge[];
  /**
   * Human-readable dep-graph warnings (e.g. "references @{aabbccdd}
   * not selected"). Rendered one per line under the row, prefixed
   * with a warning glyph.
   */
  depWarnings: string[];
  /** 0..n indent levels. Each level adds 16px of left padding. */
  indent?: number;
}

const props = withDefaults(defineProps<Props>(), { indent: 0 });
const emit = defineEmits<{ (e: "update:checked", v: boolean): void }>();
</script>

<template>
  <div
    class="wp-picker-row"
    :data-uuid="props.uuid"
    :style="{ paddingLeft: `${props.indent * 16}px` }"
  >
    <Checkbox
      class="wp-picker-row__check"
      :model-value="checked"
      :aria-label="name"
      @update:model-value="(v: boolean) => emit('update:checked', v)"
    />
    <span class="wp-picker-row__name">{{ name }}</span>
    <span
      v-for="b in badges"
      :key="b.label"
      class="wp-picker-row__badge"
      :class="`wp-picker-row__badge--${b.kind}`"
    >{{ b.label }}</span>
    <span
      v-for="(w, idx) in depWarnings"
      :key="idx"
      class="wp-picker-row__warn"
    >⚠ {{ w }}</span>
  </div>
</template>

<style scoped>
.wp-picker-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--wp-text);
}
.wp-picker-row__name {
  flex: 0 1 auto;
  font-family: var(--wp-font-sans);
}
.wp-picker-row__badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg3);
  color: var(--wp-text2);
  line-height: 1.4;
}
.wp-picker-row__badge--warn {
  background: color-mix(in oklab, var(--wp-warn) 18%, transparent);
  color: var(--wp-warn);
}
.wp-picker-row__badge--error {
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent);
  color: var(--wp-danger);
}
.wp-picker-row__warn {
  flex-basis: 100%;
  font-size: 11px;
  color: var(--wp-warn);
  margin-left: 24px; /* indent past the checkbox so it lines up under name */
}
</style>
