<script setup lang="ts">
/**
 * One image at a time, full screen, over a dimmed page: ← / → (or the side
 * buttons) step through the list, Escape or the ✕ closes, and focus goes
 * back to what opened it. Built on ModalShell, so keys pressed inside never
 * reach ComfyUI's shortcuts. ImageGrid opens it for you; use it alone for
 * a single image (a docs screenshot, a preview).
 *
 *   <Lightbox v-model:open="open" v-model:index="at" :images="shots" />
 *   <Lightbox v-model:open="open" :images="frames" zoom />
 *
 * `zoom` shows each picture in WpImageZoom (Fit / 100% / 200%, wheel, drag,
 * + − 0 1 2 keys); the level and the spot carry over as you step, so you
 * can compare the same part of every frame.
 */
import { computed, nextTick, ref, watch } from "vue";
import ModalShell from "./ModalShell.vue";
import WpImageZoom from "./WpImageZoom.vue";
import CloseButton from "./CloseButton.vue";
import { focusablesIn } from "./useDialogFocus";

export interface LightboxImage { src: string; alt: string; caption?: string | undefined }

const props = withDefaults(defineProps<{
  open: boolean;
  images: LightboxImage[];
  index?: number | undefined;
  /** Go round from the last image to the first. */
  loop?: boolean | undefined;
  /** Real zoom levels (WpImageZoom) instead of a picture fitted to the screen. */
  zoom?: boolean | undefined;
}>(), { index: 0, loop: false, zoom: false });

/** The zoom level, kept across images while the viewer is open. */
const level = ref<number | null>(null);

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "update:index", v: number): void;
}>();

const panelEl = ref<HTMLElement | null>(null);
let returnTo: HTMLElement | null = null;

const count = computed(() => props.images.length);
const at = computed(() => Math.min(Math.max(props.index, 0), Math.max(count.value - 1, 0)));
const image = computed(() => props.images[at.value]);
const canPrev = computed(() => count.value > 1 && (props.loop || at.value > 0));
const canNext = computed(() => count.value > 1 && (props.loop || at.value < count.value - 1));

function go(dir: 1 | -1): void {
  if (dir < 0 ? !canPrev.value : !canNext.value) return;
  emit("update:index", (at.value + dir + count.value) % count.value);
}

function close(): void {
  emit("update:open", false);
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === "ArrowLeft") { ev.preventDefault(); go(-1); }
  else if (ev.key === "ArrowRight") { ev.preventDefault(); go(1); }
  else if (ev.key === "Home" && count.value) { ev.preventDefault(); emit("update:index", 0); }
  else if (ev.key === "End" && count.value) { ev.preventDefault(); emit("update:index", count.value - 1); }
  else if (ev.key === "Tab") {
    // Keep Tab inside: ModalShell stops the keys at its overlay, so this is the trap.
    const els = focusablesIn(panelEl.value);
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
}

watch(() => props.open, async (v, was) => {
  if (typeof document === "undefined") return;
  if (v) {
    level.value = null;
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    panelEl.value?.focus();
  } else if (was) {
    const el = returnTo;
    returnTo = null;
    if (el?.isConnected) el.focus();
  }
}, { immediate: true });
</script>

<template>
  <ModalShell :visible="open" @close="close" @keydown="onKey">
    <!-- A click on the dark area closes, like the modal's own backdrop; Escape is the keyboard way. -->
    <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
    <div
      ref="panelEl"
      class="wp-lightbox"
      tabindex="-1"
      role="group"
      aria-roledescription="image viewer"
      :aria-label="image ? `${image.alt}, ${at + 1} of ${count}` : 'Image viewer'"
      @click.self="close"
    >
      <div class="wp-lightbox__bar">
        <span v-if="count > 1" class="wp-lightbox__count" aria-hidden="true">{{ at + 1 }} / {{ count }}</span>
        <CloseButton class="wp-lightbox__close" kbd="Esc" @click="close" />
      </div>
      <figure v-if="image" class="wp-lightbox__figure" :data-zoom="zoom || undefined">
        <WpImageZoom v-if="zoom" v-model:zoom="level" class="wp-lightbox__zoom" :src="image.src" :alt="image.alt" size="md" minimap />
        <img v-else class="wp-lightbox__img" :src="image.src" :alt="image.alt">
        <figcaption v-if="image.caption" class="wp-lightbox__caption">{{ image.caption }}</figcaption>
      </figure>
      <button
        v-if="count > 1"
        type="button"
        class="wp-lightbox__step"
        data-dir="prev"
        aria-label="Previous image"
        :disabled="!canPrev"
        @click="go(-1)"
      ><i class="pi pi-chevron-left" aria-hidden="true" /></button>
      <button
        v-if="count > 1"
        type="button"
        class="wp-lightbox__step"
        data-dir="next"
        aria-label="Next image"
        :disabled="!canNext"
        @click="go(1)"
      ><i class="pi pi-chevron-right" aria-hidden="true" /></button>
    </div>
  </ModalShell>
</template>

<style scoped>
.wp-lightbox {
  position: relative; display: flex; flex-direction: column; align-items: center;
  width: min(1200px, 100%); max-height: calc(100vh - 40px); outline: none;
  color: var(--wp-text); font-family: var(--wp-font-sans);
}
/* Its own near-black scrim in both themes: the shared modal one is light enough to read a dialog
   over (and pale grey in light mode), too light to look at a picture on. A click on it closes. */
.wp-lightbox::before { content: ""; position: fixed; inset: 0; z-index: -1; background: rgb(0 0 0 / 0.86); }
.wp-lightbox__bar { display: flex; align-items: center; justify-content: flex-end; gap: var(--wp-space-3); align-self: stretch; padding-bottom: var(--wp-space-2); }
.wp-lightbox__count { color: rgb(255 255 255 / 0.75); font-size: var(--wp-text-sm); font-variant-numeric: tabular-nums; }
.wp-lightbox .wp-lightbox__close { color: rgb(255 255 255 / 0.85); }
.wp-lightbox__figure { display: flex; flex-direction: column; align-items: center; gap: var(--wp-space-2); min-height: 0; margin: 0; }
.wp-lightbox__figure[data-zoom] { align-self: stretch; }
.wp-lightbox__zoom {
  width: 100%; height: calc(100vh - 140px);
  border-radius: var(--wp-radius); overflow: hidden; background: var(--wp-bg-1); box-shadow: var(--wp-shadow-lg);
}
.wp-lightbox__img {
  display: block; max-width: 100%; max-height: calc(100vh - 140px); object-fit: contain;
  border-radius: var(--wp-radius); box-shadow: var(--wp-shadow-lg); background: var(--wp-bg-1);
}
.wp-lightbox__caption { color: rgb(255 255 255 / 0.8); font-size: var(--wp-text-sm); text-align: center; }
.wp-lightbox__step {
  position: absolute; top: 50%; transform: translateY(-50%);
  display: grid; place-items: center; width: var(--wp-control-h-lg); height: var(--wp-control-h-lg);
  border: 1px solid var(--wp-border-strong); border-radius: min(50%, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2); color: var(--wp-text); cursor: pointer; box-shadow: var(--wp-shadow-md);
  transition: background var(--wp-motion-hover);
}
.wp-lightbox__step[data-dir="prev"] { left: var(--wp-space-2); }
.wp-lightbox__step[data-dir="next"] { right: var(--wp-space-2); }
.wp-lightbox__step:hover:not(:disabled) { background: var(--wp-bg-3); }
.wp-lightbox__step:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--wp-focus-ring); border-color: var(--wp-border-focus); }
.wp-lightbox__step:disabled { opacity: 0.35; cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) {
  .wp-lightbox__step { transition: none; }
}
</style>
