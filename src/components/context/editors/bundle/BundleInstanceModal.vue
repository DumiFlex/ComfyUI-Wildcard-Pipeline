<script setup lang="ts">
/** Bundle edit modal — mirrors the per-kind module modal shell
 *  (head · identity · runtime · footer). Bundles aren't ModuleEntry,
 *  so this is dispatched directly from ContextWidget rather than via
 *  ModuleEditModal. Master Lock/Hide route to the live cascade
 *  handlers (same ones BundleHeader buttons call). */
import { computed } from "vue";
import type { BundleInstance } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";
import InstanceIdChip from "../InstanceIdChip.vue";

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
  return "var(--wp-bundle-default, #6366f1)";
});
const headerName = computed(() => props.bundle.name || props.libraryName || "Bundle");
</script>

<template>
  <div class="wp-bdm" :style="{ '--modal-accent': headerColor }">
    <header class="wp-bdm__head">
      <i class="pi pi-box wp-bdm__head-icon" aria-hidden="true" />
      <div class="wp-bdm__title-block">
        <div class="wp-bdm__title-row">
          <span class="wp-bdm__name" data-test="bdm-name-display">{{ headerName }}</span>
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
      <button
        type="button"
        class="wp-bdm__close"
        aria-label="Close"
        data-test="bdm-close"
        @click="emit('cancel')"
      >
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </header>

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

    <footer class="wp-bdm__foot">
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
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-bdm__btn wp-bdm__btn--quiet"
        data-test="bdm-reset-lib"
        title="Replace children with the frozen library snapshot — drops local edits"
        @click="emit('reset-to-library')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset to library
      </button>
      <span class="wp-bdm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-bdm__btn"
        data-test="bdm-save-lib"
        @click="emit('save-to-library')"
      >
        Save to library
      </button>
      <button type="button" class="wp-bdm__btn" data-test="bdm-cancel" @click="emit('cancel')">
        Cancel
      </button>
      <button
        type="button"
        class="wp-bdm__btn wp-bdm__btn--primary"
        data-test="bdm-save"
        @click="emit('save')"
      >
        Save
      </button>
    </footer>
    </div>
  </div>
</template>

<style scoped>
.wp-bdm { background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); width: 720px; max-width: 100%; max-height: 80vh; display: flex; flex-direction: column; overflow-y: auto; font-family: var(--wp-font-sans, sans-serif); font-size: 12px; color: var(--wp-text); }
.wp-bdm__head { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: linear-gradient(180deg, color-mix(in srgb, var(--modal-accent, var(--wp-accent)) 18%, var(--wp-bg2)) 0%, var(--wp-bg2) 100%); border-bottom: 1px solid var(--wp-border); }
.wp-bdm__head-icon { color: var(--modal-accent, var(--wp-accent)); font-size: 18px; width: 24px; text-align: center; }
.wp-bdm__title-block { flex: 1; min-width: 0; }
.wp-bdm__title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wp-bdm__name { font: 600 13px var(--wp-font-sans); color: var(--wp-text); }
.wp-bdm__chip { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 2px; background: color-mix(in srgb, var(--modal-accent, var(--wp-accent)) 22%, transparent); color: var(--modal-accent, var(--wp-accent)); }
.wp-bdm__sub { font: 400 10px var(--wp-font-mono); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 2px; }
.wp-bdm__badge { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 2px; }
.wp-bdm__badge--drift { background: color-mix(in srgb, var(--wp-warn, #fcd34d) 22%, transparent); color: var(--wp-warn, #fcd34d); }
.wp-bdm__badge--mod { background: color-mix(in srgb, var(--wp-status-modified, #f59e0b) 22%, transparent); color: var(--wp-status-modified, #f59e0b); }
.wp-bdm__close { background: transparent; border: 0; color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; padding: 4px; }
.wp-bdm__close:hover { color: var(--wp-text); }
.wp-bdm__close .pi { font-size: 12px; }
.wp-bdm__dock { position: sticky; bottom: 0; z-index: 2; background: var(--wp-bg2); }
.wp-bdm__foot { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.wp-bdm__spa-link { display: inline-flex; align-items: center; gap: 5px; font: 10px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); text-decoration: none; }
.wp-bdm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-bdm__spa-link .pi { font-size: 10px; }
.wp-bdm__hint { margin-left: auto; font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-bdm__hint kbd { font: 9px var(--wp-font-mono); background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); padding: 1px 4px; border-radius: 2px; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-bdm__btn { padding: 5px 12px; border: 1px solid var(--wp-border); border-radius: 3px; background: transparent; color: var(--wp-text-muted, var(--wp-text2)); font: 11px var(--wp-font-sans); cursor: pointer; }
.wp-bdm__btn--primary { border-color: var(--wp-accent); background: var(--wp-accent); color: white; }
.wp-bdm__btn:hover { border-color: var(--wp-border-strong, var(--wp-border2)); color: var(--wp-text); }
.wp-bdm__btn--primary:hover { border-color: var(--wp-accent2, var(--wp-accent)); background: var(--wp-accent2, var(--wp-accent)); color: white; }
.wp-bdm__btn--quiet { border-color: transparent; color: var(--wp-text-dim, var(--wp-text3)); display: inline-flex; align-items: center; gap: 5px; font-size: 10px; }
.wp-bdm__btn--quiet:hover { border-color: var(--wp-border); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-bdm__btn--quiet .pi { font-size: 10px; }
</style>
