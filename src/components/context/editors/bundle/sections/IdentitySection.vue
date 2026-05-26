<script setup lang="ts">
/** Bundle identity — display name + frame color override.
 *  Name empty → falls back to library; color null → bundle-default token.
 *  Per-field reset surfaces when current value diverges from the
 *  supplied library default. Swatch button toggles an HSV popover
 *  (teleported to body with fixed positioning so it escapes the
 *  modal's overflow clip). A "Clear" button always surfaces when
 *  bundle.color is set so users can drop the override and fall back
 *  to the bundle-default token — useful for legacy bundles whose
 *  library entry stored the now-deprecated gray default. */
import { computed, onBeforeUnmount, ref, nextTick } from "vue";
import type { BundleInstance } from "../../../../../widgets/_shared";
import HsvPicker from "../../../../shared/HsvPicker.vue";

const props = withDefaults(
  defineProps<{
    bundle: BundleInstance;
    libraryName?: string;
    libraryColor?: string | null;
  }>(),
  { libraryName: "", libraryColor: null },
);
const emit = defineEmits<{ "update": [patch: Partial<BundleInstance>] }>();

const PRESETS = [
  "#6366f1", "#7c3aed", "#a78bfa", "#22d3ee",
  "#10b981", "#34d399", "#fbbf24", "#f59e0b",
  "#f472b6", "#fb7185", "#ef4444", "#8b5cf6",
] as const;
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
const previewColor = computed(() => {
  if (HEX_RE.test(colorValue.value)) return colorValue.value;
  if (props.libraryColor && HEX_RE.test(props.libraryColor)) return props.libraryColor;
  return "var(--wp-bundle-default, #6366f1)";
});
const hsvModelValue = computed(() => {
  if (HEX_RE.test(colorValue.value)) return colorValue.value;
  if (props.libraryColor && HEX_RE.test(props.libraryColor)) return props.libraryColor;
  return "#6366f1";
});

// ── Popover state ────────────────────────────────────────────────
const pickerOpen = ref(false);
const popoverEl = ref<HTMLDivElement | null>(null);
const swatchEl = ref<HTMLButtonElement | null>(null);
const popoverPos = ref<{ top: number; left: number }>({ top: 0, left: 0 });

const POPOVER_W = 240;
const POPOVER_H = 180;

function positionPopover(): void {
  const sw = swatchEl.value;
  if (!sw) return;
  const rect = sw.getBoundingClientRect();
  // Default: below the swatch, left edge aligned with swatch.
  let top = rect.bottom + 6;
  let left = rect.left;
  // Flip above if there isn't enough room below.
  if (top + POPOVER_H > window.innerHeight - 8) {
    top = Math.max(8, rect.top - POPOVER_H - 6);
  }
  // Clamp horizontally so the popover fits inside the viewport.
  const maxLeft = window.innerWidth - POPOVER_W - 8;
  left = Math.max(8, Math.min(left, maxLeft));
  popoverPos.value = { top, left };
}

function togglePicker(): void {
  pickerOpen.value = !pickerOpen.value;
  if (pickerOpen.value) {
    void nextTick(positionPopover);
    setTimeout(() => {
      document.addEventListener("mousedown", onOutsideClick);
      window.addEventListener("resize", positionPopover);
      window.addEventListener("scroll", positionPopover, true);
    }, 0);
  } else {
    detachListeners();
  }
}

function detachListeners(): void {
  document.removeEventListener("mousedown", onOutsideClick);
  window.removeEventListener("resize", positionPopover);
  window.removeEventListener("scroll", positionPopover, true);
}

function onOutsideClick(ev: MouseEvent): void {
  const target = ev.target as Node | null;
  if (!target) return;
  if (popoverEl.value?.contains(target)) return;
  if (swatchEl.value?.contains(target)) return;
  pickerOpen.value = false;
  detachListeners();
}

onBeforeUnmount(detachListeners);

function onNameInput(ev: Event): void {
  emit("update", { name: (ev.target as HTMLInputElement).value });
}
function onColorInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value.trim();
  emit("update", { color: raw.length === 0 ? null : raw });
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
        <button
          v-if="nameOverridden"
          type="button"
          class="id__reset"
          data-test="bdm-name-reset"
          :title="`Restore name to library default: ${libraryName}`"
          aria-label="Reset display name to library default"
          @click="onResetName"
        ><i class="pi pi-replay" aria-hidden="true" /></button>
      </div>
    </div>

    <div class="id__row">
      <span class="id__key">Frame color</span>
      <div class="id__input-row">
        <div class="bdm-color-wrap" :class="{ 'bdm-color-wrap--mod': colorOverridden }">
          <button
            ref="swatchEl"
            type="button"
            class="bdm-color-swatch"
            :class="{ 'bdm-color-swatch--open': pickerOpen }"
            :style="{ background: previewColor }"
            data-test="bdm-color-swatch"
            :aria-label="pickerOpen ? 'Close color picker' : 'Open color picker'"
            :aria-expanded="pickerOpen"
            @click.stop="togglePicker"
          />
          <input
            class="bdm-color-input"
            data-test="bdm-color"
            type="text"
            :value="colorValue"
            :placeholder="libraryColor || '#6366f1'"
            aria-label="Frame color (hex)"
            spellcheck="false"
            @input="onColorInput"
          />
          <div class="bdm-color-presets" role="listbox" aria-label="Color presets">
            <button
              v-for="hex in PRESETS"
              :key="hex"
              type="button"
              class="bdm-color-preset"
              :class="{ 'bdm-color-preset--on': colorValue.toLowerCase() === hex }"
              :style="{ background: hex }"
              :title="hex"
              :aria-label="`Pick ${hex}`"
              :aria-selected="colorValue.toLowerCase() === hex"
              @click="onPickSwatch(hex)"
            />
          </div>
        </div>
        <button
          v-if="colorOverridden"
          type="button"
          class="id__reset"
          data-test="bdm-color-reset"
          :title="libraryColor
            ? `Restore color to library default: ${libraryColor}`
            : 'Reset to library — falls back to default indigo (library has no explicit color)'"
          aria-label="Reset frame color to library default"
          @click="onResetColor"
        ><i class="pi pi-replay" aria-hidden="true" /></button>
      </div>
    </div>

    <!-- HSV popover teleported to body with fixed positioning so it
         escapes the modal's overflow clip + sits above every other
         layer. Click-outside and resize/scroll handlers keep it
         glued to the swatch as the viewport changes. -->
    <Teleport to="body">
      <div
        v-if="pickerOpen"
        ref="popoverEl"
        class="wp-bdm-color-popover"
        data-test="bdm-color-popover"
        role="dialog"
        aria-label="Custom color picker"
        :style="{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }"
        @click.stop
        @mousedown.stop
      >
        <HsvPicker
          :model-value="hsvModelValue"
          aria-label="Frame color HSV picker"
          @update:model-value="onHsvUpdate"
        />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.id { padding: 12px 16px; background: var(--wp-bg); border-bottom: 1px solid var(--wp-border-soft, var(--wp-border)); }
.id__label { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.14em; color: var(--wp-text-dim, var(--wp-text3)); margin-bottom: 8px; }
.id__row { display: grid; grid-template-columns: 100px 1fr; gap: 10px; align-items: center; margin-bottom: 6px; }
.id__row:last-child { margin-bottom: 0; }
.id__key { font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.id__input { background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; padding: 5px 8px; font: 11px var(--wp-font-mono); color: var(--wp-text); }
.id__input:focus { border-color: var(--wp-accent); outline: none; }
.id__input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.id__input--mod { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); }
.id__input-row { display: flex; align-items: stretch; gap: 6px; }
.id__input-row .id__input { flex: 1; min-width: 0; }
.bdm-color-wrap { flex: 1; display: flex; align-items: center; gap: 8px; padding: 4px 6px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; min-width: 0; }
.bdm-color-wrap--mod { border-color: var(--wp-accent); }
.bdm-color-swatch { width: 18px; height: 18px; border-radius: 3px; border: 1px solid var(--wp-border); flex-shrink: 0; cursor: pointer; padding: 0; transition: outline-offset 0.08s, outline-color 0.08s; }
.bdm-color-swatch:hover { outline: 1px solid var(--wp-accent); outline-offset: 1px; }
.bdm-color-swatch--open { outline: 2px solid var(--wp-accent); outline-offset: 2px; }
.bdm-color-input { flex: 0 0 80px; background: transparent; border: 0; outline: none; padding: 2px 0; font: 11px var(--wp-font-mono); color: var(--wp-text); }
.bdm-color-input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.bdm-color-presets { display: flex; gap: 4px; flex-wrap: wrap; }
.bdm-color-preset { width: 16px; height: 16px; border-radius: 3px; border: 1px solid color-mix(in srgb, currentColor 22%, transparent); cursor: pointer; padding: 0; transition: transform 0.08s; }
.bdm-color-preset:hover { transform: scale(1.12); }
.bdm-color-preset--on { outline: 2px solid var(--wp-text); outline-offset: 1px; }
</style>

<style>
/* Unscoped — popover is teleported to body, scoped attribute can't
 * reach it. Class is wp-prefixed so the global declaration is
 * collision-safe (enforced by pnpm check:css-isolation). */
.wp-bdm-color-popover {
  position: fixed;
  z-index: 10000;
  width: 240px;
  padding: 10px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
}
</style>
