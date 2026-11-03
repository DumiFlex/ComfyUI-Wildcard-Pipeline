<script setup lang="ts">
/** Bundle identity — display name + frame color override.
 *  Name empty → falls back to library; color null → bundle-default token.
 *  Per-field reset surfaces when current value diverges from the
 *  supplied library default. The colour is the kit ColorField (swatch +
 *  hex, square and hex box in its popover) with the presets as kit
 *  swatches beside it. A "Clear" button always surfaces when
 *  bundle.color is set so users can drop the override and fall back
 *  to the bundle-default token — useful for legacy bundles whose
 *  library entry stored the now-deprecated gray default. */
import { computed } from "vue";
import type { BundleInstance } from "../../../../../widgets/_shared";
import { COLOUR_PRESETS, DEFAULT_COLOUR } from "@/kit/colour-presets";
import ColorField from "@/kit/ColorField.vue";
import RadioGroup from "@/kit/RadioGroup.vue";
import Button from "@/kit/Button.vue";

const props = withDefaults(
  defineProps<{
    bundle: BundleInstance;
    libraryName?: string;
    libraryColor?: string | null;
  }>(),
  { libraryName: "", libraryColor: null },
);
const emit = defineEmits<{ "update": [patch: Partial<BundleInstance>] }>();

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const nameValue = computed(() => props.bundle.name ?? "");
const colorValue = computed(() => props.bundle.color ?? "");
const nameOverridden = computed(
  () => props.libraryName !== "" && nameValue.value !== props.libraryName,
);
/** Reset-to-library surfaces when the instance color diverges from
 *  the library entry. When the library itself stores no color (null /
 *  empty), the reset button still surfaces if the instance picked a
 *  color — clicking drops to null so the canvas falls back through
 *  library → `--wp-bundle-default` (indigo). */
const colorOverridden = computed(() => {
  const lib = (props.libraryColor ?? "").toLowerCase();
  return colorValue.value.toLowerCase() !== lib;
});
const hsvModelValue = computed(() => {
  if (HEX_RE.test(colorValue.value)) return colorValue.value;
  if (props.libraryColor && HEX_RE.test(props.libraryColor)) return props.libraryColor;
  return DEFAULT_COLOUR;
});


function onNameInput(ev: Event): void {
  emit("update", { name: (ev.target as HTMLInputElement).value });
}
function onHsvUpdate(hex: string): void {
  emit("update", { color: hex });
}
function onPickSwatch(hex: string): void {
  emit("update", { color: hex });
}
function onResetName(): void {
  emit("update", { name: props.libraryName });
}
/** Reset color to the library entry's value. Library null → instance
 *  null → canvas falls back to `--wp-bundle-default` (indigo). */
function onResetColor(): void {
  emit("update", { color: props.libraryColor ?? null });
}
</script>

<template>
  <section class="id">
    <div class="id__label">Identity</div>

    <div class="id__row">
      <span class="id__key">Display name</span>
      <div class="id__input-row">
        <input
          class="id__input"
          :class="{ 'id__input--mod': nameOverridden }"
          data-test="bdm-name"
          type="text"
          :value="nameValue"
          :placeholder="libraryName || 'bundle name'"
          aria-label="Display name"
          @input="onNameInput"
        />
        <Button
          v-if="nameOverridden"
          size="sm"
          variant="outline"
          icon="pi-replay"
          data-test="bdm-name-reset"
          :hint="`Restore name to library default: ${libraryName}`"
          aria-label="Reset display name to library default"
          @click="onResetName"
        />
      </div>
    </div>

    <div class="id__row">
      <span class="id__key">Frame color</span>
      <div class="id__input-row">
        <div class="bdm-color-wrap" :class="{ 'bdm-color-wrap--mod': colorOverridden }">
          <!-- The kit colour field (swatch + hex; the square and a hex box open
               under it) and the presets as kit swatches. -->
          <ColorField
            :model-value="hsvModelValue"
            size="sm"
            aria-label="Frame color"
            data-test="bdm-color-swatch"
            @update:model-value="onHsvUpdate"
          />
          <RadioGroup
            class="bdm-color-presets"
            :model-value="colorValue.toLowerCase()"
            :options="COLOUR_PRESETS.map((hex) => ({ value: hex, label: hex, color: hex }))"
            variant="swatch"
            size="sm"
            aria-label="Color presets"
            @update:model-value="onPickSwatch"
          />
        </div>
        <Button
          v-if="colorOverridden"
          size="sm"
          variant="outline"
          icon="pi-replay"
          data-test="bdm-color-reset"
          :hint="libraryColor
            ? `Restore color to library default: ${libraryColor}`
            : 'Reset to library: falls back to the default indigo (the library has no colour)'"
          aria-label="Reset frame color to library default"
          @click="onResetColor"
        />
      </div>
    </div>

  </section>
</template>

<style scoped>
.id { padding: 12px 16px; background: var(--wp-bg); border-bottom: 1px solid var(--wp-border-soft, var(--wp-border)); }
.id__label { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.14em; color: var(--wp-text-dim, var(--wp-text3)); margin-bottom: 8px; }
.id__row { display: grid; grid-template-columns: 100px 1fr; gap: 10px; align-items: center; margin-bottom: 6px; }
.id__row:last-child { margin-bottom: 0; }
.id__key { font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.id__input { background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: min(3px, var(--wp-radius-cap, 999px)); padding: 5px 8px; font: 11px var(--wp-font-mono); color: var(--wp-text); }
.id__input:focus { border-color: var(--wp-accent); outline: none; }
.id__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.id__input--mod { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); }
.id__input-row { display: flex; align-items: stretch; gap: 6px; }
.id__input-row .id__input { flex: 1; min-width: 0; }
.bdm-color-wrap { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
/* Overridden from the library: the field's border goes to the accent. */
.bdm-color-wrap--mod :deep(.wp-color-field) { border-color: var(--wp-accent); }
</style>

