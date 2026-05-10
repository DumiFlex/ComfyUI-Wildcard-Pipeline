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
  }>(),
  { isDrifted: false },
);

const emit = defineEmits<{
  "update": [patch: Partial<ModuleEntry>];
  "save": [];
  "cancel": [];
  "open-spa": [];
  "reset-from-library": [];
  "save-to-library": [];
  "clear-all-overrides": [];
}>();

const isLibraryTracked = computed(() => Boolean(props.module.payload_hash));

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
  <div class="fvm">
    <header class="fvm__head">
      <i class="pi pi-tag fvm__head-icon" aria-hidden="true" />
      <div class="fvm__title-block">
        <div class="fvm__title-row">
          <span class="fvm__name" data-test="fvm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="fvm__chip" data-test="fvm-chip">fixed</span>
        </div>
        <div class="fvm__sub">Library entry · static $var → value pairs</div>
      </div>
      <button
        type="button"
        class="fvm__close"
        aria-label="Close"
        data-test="fvm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection :module="module" @update="onUpdate" />
    <ValuesSection :module="module" @update="onUpdate" />
    <RuntimeSection :module="module" @update="onUpdate" />

    <footer class="fvm__foot">
      <a
        v-if="isLibraryTracked"
        class="fvm__spa-link"
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
        class="fvm__btn fvm__btn--quiet"
        data-test="fvm-clear-all"
        title="Clear all instance overrides"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="fvm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <div v-if="isLibraryTracked" class="fvm__kebab" data-test="fvm-kebab">
        <button
          type="button"
          class="fvm__btn"
          data-test="fvm-reset"
          @click="emit('reset-from-library')"
        >Reset to library</button>
        <button
          type="button"
          class="fvm__btn"
          data-test="fvm-save-lib"
          @click="emit('save-to-library')"
        >Save to library</button>
      </div>
      <button type="button" class="fvm__btn" data-test="fvm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="fvm__btn fvm__btn--primary" data-test="fvm-save" @click="emit('save')">Save</button>
    </footer>
  </div>
</template>

<style scoped>
.fvm {
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
.fvm__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--wp-brand-gradient);
  border-bottom: 1px solid var(--wp-border);
  position: relative;
}
.fvm__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.fvm__head > * { position: relative; z-index: 1; }
.fvm__head-icon {
  color: var(--wp-kind-fixed);
  font-size: 16px;
  margin-top: 1px;
}
.fvm__title-block { flex: 1; min-width: 0; }
.fvm__title-row { display: flex; align-items: center; gap: 8px; }
.fvm__name { font: 700 13px var(--wp-font-sans); color: var(--wp-text); }
.fvm__chip {
  font: 600 9px var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 2px 5px;
  border-radius: 2px;
  background: color-mix(in oklab, var(--wp-kind-fixed) 22%, transparent);
  color: var(--wp-kind-fixed);
}
.fvm__sub {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-top: 2px;
}
.fvm__close {
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 13px;
  padding: 4px;
  cursor: pointer;
}
.fvm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.fvm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.fvm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.fvm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.fvm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.fvm__kebab { display: inline-flex; gap: 6px; }
.fvm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.fvm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.fvm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.fvm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.fvm__btn--quiet .pi { font-size: 10px; }
</style>
