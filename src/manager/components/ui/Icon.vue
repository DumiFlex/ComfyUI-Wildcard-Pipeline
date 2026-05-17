<script lang="ts">
/**
 * Canonical icon sizes. Use these instead of raw numbers on `:size`.
 *
 *  ICON_SM (12) — micro indicators, badge glyphs, tight pill icons
 *  ICON_MD (14) — default toolbar / sidebar / inline icons
 *  ICON_LG (18) — emphasized icons (CTA buttons, empty-state subheadings,
 *                 panel-header glyphs)
 *
 * Outliers (e.g. very large empty-state icons at 48-80px) stay as raw
 * numbers — flag the locations in PR review so we can decide whether
 * to grow the scale.
 */
export const ICON_SM = 12;
export const ICON_MD = 14;
export const ICON_LG = 18;
</script>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  name: string;
  size?: number;
}
const props = defineProps<Props>();

const className = computed(() => {
  // Accept either bare name ("plus", "check-circle") or already-prefixed ("pi-plus").
  const n = props.name.startsWith("pi-") ? props.name : `pi-${props.name}`;
  return `pi ${n}`;
});

const style = computed(() => (props.size ? { fontSize: `${props.size}px` } : undefined));
</script>

<template>
  <i :class="className" :style="style" aria-hidden="true" />
</template>
