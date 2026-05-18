<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import ValuesSection from "./sections/ValuesSection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
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

const isLibraryTracked = computed(() => Boolean(props.module.payload_hash));
const canSaveToLibrary = computed(() => isLibraryTracked.value && props.isModified);

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
  <div class="wp-fvm">
    <header class="wp-fvm__head">
      <i class="pi pi-tag wp-fvm__head-icon" aria-hidden="true" />
      <div class="wp-fvm__title-block">
        <div class="wp-fvm__title-row">
          <span class="wp-fvm__name" data-test="fvm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-fvm__chip" data-test="fvm-chip">fixed</span>
        </div>
        <div class="wp-fvm__sub">Library entry · static $var → value pairs</div>
      </div>
      <button
        type="button"
        class="wp-fvm__close"
        aria-label="Close"
        data-test="fvm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection :module="module" @update="onUpdate" />
    <ValuesSection :module="module" @update="onUpdate" />
    <RuntimeSection :module="module" @update="onUpdate" />

    <footer class="wp-fvm__foot">
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
      <button
        v-if="isLibraryTracked"
        type="button"
        class="wp-fvm__btn wp-fvm__btn--quiet"
        data-test="fvm-clear-all"
        title="Clear all instance overrides"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="wp-fvm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-fvm__btn"
        data-test="fvm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</button>
      <button type="button" class="wp-fvm__btn" data-test="fvm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="wp-fvm__btn wp-fvm__btn--primary" data-test="fvm-save" @click="emit('save')">Save</button>
    </footer>
  </div>
</template>

<style scoped>
.wp-fvm {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  width: 820px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}
/* Head styling lives in src/components/context/editors/_modal-head.css
 * (imported once by ContextWidget). */
.wp-fvm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
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
.wp-fvm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-fvm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-fvm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-fvm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.wp-fvm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-fvm__btn--quiet .pi { font-size: 10px; }
</style>
