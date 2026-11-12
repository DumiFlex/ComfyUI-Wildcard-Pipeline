<script setup lang="ts">
import Kbd from "@/kit/Kbd.vue";
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import ValuesSection from "./sections/ValuesSection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";
import InstanceIdChip from "../InstanceIdChip.vue";
import Button from "@/kit/Button.vue";
import Modal from "@/kit/Modal.vue";


/** Platform-correct save chord for the footer hint. */
const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
    /** When true, a frame override context is active. Run-level controls
     *  are disabled in frame mode. */
    frameActive?: boolean;
  }>(),
  { isDrifted: false, isModified: false },
);

const emit = defineEmits<{
  "update": [patch: Partial<ModuleEntry>];
  "save": [];
  "cancel": [];
  "open-spa": [];
  "save-to-library": [];
  "clear-all-overrides": [];
}>();
/** The kit Modal closes on Escape, the backdrop and its ×: that is Cancel. */
function onModalOpen(open: boolean): void {
  if (!open) emit("cancel");
}
/** Ctrl/Cmd+Enter saves from anywhere in the window. */
function onModalKey(ev: KeyboardEvent): void {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
    ev.preventDefault();
    emit("save");
  }
}

const isLibraryTracked = computed(() => Boolean(props.module.payload_hash));
// See WildcardInstanceModal — PushToLibraryModal owns the update vs fork
// choice, so save-to-library is always available when payload exists.
const canSaveToLibrary = computed(() => Boolean(props.module.payload));

function spaUrl(): string {
  return `/wp/fixed-values/${props.module.id}/edit`;
}

function onUpdate(patch: Partial<ModuleEntry>): void {
  emit("update", patch);
}

function onSpaClick(): void {
  emit("open-spa");
  window.open(spaUrl(), "_blank", "noopener");
}
</script>

<template>
  <Modal :open="true" size="lg" flush accent="var(--wp-kind-fixed)" icon="tag" @update:open="onModalOpen" @keydown="onModalKey">
    <template #header="{ titleId }">
      <div class="wp-fvm__title-block">
        <div class="wp-fvm__title-row">
          <span :id="titleId" class="wp-fvm__name" data-test="fvm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-fvm__chip" data-test="fvm-chip">fixed</span>
          <InstanceIdChip :id="module.id" :uid="module._uid" />
        </div>
        <div class="wp-fvm__sub">Library entry · static $var → value pairs</div>
      </div>
    </template>
  <div class="wp-fvm">
    <slot name="banner" />
    
    <IdentitySection :module="module" @update="onUpdate" />
    <ValuesSection :module="module" @update="onUpdate" />
    <div class="wp-fvm__dock">
    <RuntimeSection :module="module" :frame-active="frameActive" @update="onUpdate" />

        </div>
  </div>
    <template #footer>
      <a
        v-if="isLibraryTracked"
        class="wp-fvm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="fvm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <Button
        v-if="isLibraryTracked"
        size="sm"
        variant="ghost"
        icon="pi-replay"
        data-test="fvm-clear-all"
        title="Clear all instance overrides"
        @click="emit('clear-all-overrides')"
      >Reset overrides</Button>
      <span class="wp-fvm__hint">
        <Kbd keys="Esc" size="sm" /> cancel · <Kbd keys="Mod+Enter" size="sm" /> save
      </span>
      <Button
        v-if="canSaveToLibrary"
        size="sm"
        data-test="fvm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</Button>
      <Button size="sm" data-test="fvm-cancel" @click="emit('cancel')">Cancel</Button>
      <Button size="sm" variant="primary" data-test="fvm-save" @click="emit('save')">Save</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-fvm {
  display: flex;
  flex-direction: column;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}
/* The frame, the coloured header and the footer row are the kit Modal's;
 * the title block's styles live in src/components/context/editors/_modal-head.css
 * (imported once by ContextWidget). */
.wp-fvm__dock {
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: var(--wp-bg2);
}
.wp-fvm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.wp-fvm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-fvm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
