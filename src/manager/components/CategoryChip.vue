<script setup lang="ts">
/**
 * The tinted category pill, in one place.
 *
 * It was ten hand-written copies of the same `<span class="wp-cat-chip"
 * :style="catChipStyle(...)">{{ name }}</span>` across the list views, the
 * dashboard, the categories page and the import/export picker. Giving
 * categories an icon meant touching all ten — the kind of edit that leaves one
 * behind, which is how the chips ended up subtly different in the first place.
 *
 * Colour still comes from `catChipStyle` (theme-aware blend, see
 * `utils/catChip.ts`); the icon rides in front of the label and inherits that
 * same colour, so a category reads as one unit rather than a glyph next to an
 * unrelated pill.
 *
 * `data-test` and other attributes fall through to the root span, so callers
 * keep whatever selector their tests already assert on.
 */
import { computed } from "vue";
import { catChipStyle } from "../utils/catChip";

interface Props {
  name: string;
  color?: string | null;
  /** PrimeIcons slug without the `pi-` prefix. Categories created before the
   *  icon column existed have none — the chip just renders its label. */
  icon?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  color: null,
  icon: null,
});

const style = computed(() => catChipStyle(props.color ?? undefined));
</script>

<template>
  <span class="wp-cat-chip" :style="style">
    <i v-if="icon" :class="`pi pi-${icon} wp-cat-chip__icon`" aria-hidden="true" />
    {{ name }}
  </span>
</template>

<style scoped>
/* Sized against the chip's own font rather than a fixed px so it scales with
 * the pill; colour is inherited from the chip's tinted `color`. */
.wp-cat-chip__icon {
  font-size: 0.92em;
  line-height: 1;
}
</style>
