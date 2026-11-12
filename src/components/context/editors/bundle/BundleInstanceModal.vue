<script setup lang="ts">
/** Bundle edit modal — mirrors the per-kind module modal shell
 *  (head · identity · runtime · footer). Bundles aren't ModuleEntry,
 *  so this is dispatched directly from ContextWidget rather than via
 *  ModuleEditModal. Master Lock/Hide route to the live cascade
 *  handlers (same ones BundleHeader buttons call). */
import Kbd from "@/kit/Kbd.vue";
import { computed } from "vue";
import type { BundleInstance } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";
import InstanceIdChip from "../InstanceIdChip.vue";
import Button from "@/kit/Button.vue";
import Modal from "@/kit/Modal.vue";


/** Platform-correct save chord for the footer hint. */
const props = withDefaults(
  defineProps<{
    bundle: BundleInstance;
    libraryName?: string;
    libraryColor?: string | null;
    libraryDrifted?: boolean;
    snapshotModified?: boolean;
    lockState?: "all" | "none" | "partial" | null;
    internalState?: "all" | "none" | "partial" | null;
    canSaveToLibrary?: boolean;
  }>(),
  {
    libraryName: "",
    libraryColor: null,
    libraryDrifted: false,
    snapshotModified: false,
    lockState: null,
    internalState: null,
    canSaveToLibrary: true,
  },
);

const emit = defineEmits<{
  (e: "update", patch: Partial<BundleInstance>): void;
  (e: "save"): void;
  (e: "cancel"): void;
  (e: "toggle-lock"): void;
  (e: "toggle-internal"): void;
  (e: "save-to-library"): void;
  (e: "reset-to-library"): void;
  (e: "open-spa"): void;
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

/** SPA URL for the bundle library entry. Mirrors WildcardInstanceModal's
 *  `/wp/wildcards/{id}/edit` pattern. */
function spaUrl(): string {
  return `/wp/bundles/${props.bundle.library_id}/edit`;
}
function onSpaClick(): void {
  emit("open-spa");
  window.open(spaUrl(), "_blank", "noopener");
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const headerColor = computed(() => {
  const c = props.bundle.color ?? "";
  if (HEX_RE.test(c)) return c;
  if (props.libraryColor && HEX_RE.test(props.libraryColor)) return props.libraryColor;
  return "var(--wp-bundle-default)";
});
const headerName = computed(() => props.bundle.name || props.libraryName || "Bundle");
</script>

<template>
  <Modal :open="true" size="lg" flush :accent="headerColor" icon="box" @update:open="onModalOpen" @keydown="onModalKey">
    <template #header="{ titleId }">
      <div class="wp-bdm__title-block">
        <div class="wp-bdm__title-row">
          <span :id="titleId" class="wp-bdm__name" data-test="bdm-name-display">{{ headerName }}</span>
          <span class="wp-bdm__chip" data-test="bdm-chip">bundle</span>
          <InstanceIdChip :id="bundle.library_id" :uid="bundle._uid" />
          <span
            v-if="libraryDrifted"
            class="wp-bdm__badge wp-bdm__badge--drift"
            title="Library entry has been edited since this bundle was inserted."
            data-test="bdm-badge-drift"
          >library updated</span>
          <span
            v-if="snapshotModified"
            class="wp-bdm__badge wp-bdm__badge--mod"
            title="Children diverge from the library snapshot — save to library to update."
            data-test="bdm-badge-mod"
          >modified</span>
        </div>
        <div class="wp-bdm__sub">Per-Context instance · name + color edits stay local</div>
      </div>
    </template>
  <div class="wp-bdm">
    <slot name="banner" />
    
    <IdentitySection
      :bundle="bundle"
      :library-name="libraryName"
      :library-color="libraryColor"
      @update="(patch) => emit('update', patch)"
    />
    <div class="wp-bdm__dock">
    <RuntimeSection
      :lock-state="lockState"
      :internal-state="internalState"
      @toggle-lock="emit('toggle-lock')"
      @toggle-internal="emit('toggle-internal')"
    />

        </div>
  </div>
    <template #footer>
      <a
        v-if="bundle.library_id"
        class="wp-bdm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="bdm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <Button
        v-if="canSaveToLibrary"
        size="sm"
        variant="ghost"
        icon="pi-replay"
        data-test="bdm-reset-lib"
        title="Replace children with the frozen library snapshot — drops local edits"
        @click="emit('reset-to-library')"
      >Reset to library</Button>
      <span class="wp-bdm__hint">
        <Kbd keys="Esc" size="sm" /> cancel · <Kbd keys="Mod+Enter" size="sm" /> save
      </span>
      <Button
        v-if="canSaveToLibrary"
        size="sm"
        data-test="bdm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</Button>
      <Button size="sm" data-test="bdm-cancel" @click="emit('cancel')">Cancel</Button>
      <Button size="sm" variant="primary" data-test="bdm-save" @click="emit('save')">Save</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-bdm { display: flex; flex-direction: column; font-family: var(--wp-font-sans, sans-serif); font-size: 12px; color: var(--wp-text); }
.wp-bdm__title-block { flex: 1; min-width: 0; }
.wp-bdm__title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wp-bdm__name { font: 600 13px var(--wp-font-sans); color: var(--wp-text); }
.wp-bdm__chip { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: min(2px, var(--wp-radius-cap, 999px)); background: color-mix(in srgb, var(--wp-modal-accent, var(--wp-accent)) 22%, transparent); color: var(--wp-modal-accent, var(--wp-accent)); }
.wp-bdm__sub { font: 400 10px var(--wp-font-mono); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 2px; }
.wp-bdm__badge { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: min(2px, var(--wp-radius-cap, 999px)); }
.wp-bdm__badge--drift { background: color-mix(in srgb, var(--wp-warn) 22%, transparent); color: var(--wp-warn); }
.wp-bdm__badge--mod { background: color-mix(in srgb, var(--wp-status-modified) 22%, transparent); color: var(--wp-status-modified); }
.wp-bdm__dock { position: sticky; bottom: 0; z-index: 2; background: var(--wp-bg2); }
.wp-bdm__spa-link { display: inline-flex; align-items: center; gap: 5px; font: 10px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); text-decoration: none; }
.wp-bdm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-bdm__spa-link .pi { font-size: 10px; }
.wp-bdm__hint { margin-left: auto; font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
</style>
