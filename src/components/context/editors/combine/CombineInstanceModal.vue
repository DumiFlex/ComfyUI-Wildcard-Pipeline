<script setup lang="ts">
/**
 * CombineInstanceModal — single-pane v2 modal for combine modules.
 * Mirrors WildcardInstanceModal + FixedValuesInstanceModal: brand-gradient
 * head with kind icon (pi pi-link) + mint --wp-kind-combine accent,
 * three stacked sections (Identity / Template / Runtime), and a
 * footer with SPA link + reset overrides + drift kebab + cancel/save.
 *
 * Library-defining edits (template, output_var, description, tags)
 * remain in the SPA. The modal exposes only the per-instance overrides
 * a user might need at queue time: name, variable binding, template
 * override, locked seed, hide-from-prompt.
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import TemplateSection from "./sections/TemplateSection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** Upstream var names from chain — fed into TemplateSection's
     *  insert-var dropdown so users don't have to remember which
     *  bindings they can reach from this module. */
    upstreamVars?: string[];
    /** Resolved upstream-var snapshot — drives the TemplateSection's
     *  live preview pane with substituted values. */
    upstreamResolved?: Record<string, string>;
    /** Sibling var names produced by other modules in this same Context
     *  node. Combined with upstreamVars to populate the dropdown. */
    siblingVars?: string[];
  }>(),
  {
    isDrifted: false,
    upstreamVars: () => [],
    upstreamResolved: () => ({}),
    siblingVars: () => [],
  },
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
  // SPA base is `/wp/`. Combine library editor lives at
  // `/wp/combines/<id>/edit`. Route may not exist yet — link is
  // ornamental until SPA support lands.
  return `/wp/combines/${props.module.id}/edit`;
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
  <div class="cbm">
    <header class="cbm__head">
      <i class="pi pi-link cbm__head-icon" aria-hidden="true" />
      <div class="cbm__title-block">
        <div class="cbm__title-row">
          <span class="cbm__name" data-test="cbm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="cbm__chip" data-test="cbm-chip">combine</span>
        </div>
        <div class="cbm__sub">Library entry · template interpolates $vars into output binding</div>
      </div>
      <button
        type="button"
        class="cbm__close"
        aria-label="Close"
        data-test="cbm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection
      :module="module"
      :upstream-vars="upstreamVars"
      :sibling-vars="siblingVars"
      @update="onUpdate"
    />
    <TemplateSection
      :module="module"
      :upstream-vars="upstreamVars"
      :upstream-resolved="upstreamResolved"
      :sibling-vars="siblingVars"
      @update="onUpdate"
    />
    <RuntimeSection :module="module" @update="onUpdate" />

    <footer class="cbm__foot">
      <a
        v-if="isLibraryTracked"
        class="cbm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="cbm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <button
        type="button"
        class="cbm__btn cbm__btn--quiet"
        data-test="cbm-clear-all"
        title="Clear all instance overrides on this combine"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="cbm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <div v-if="isLibraryTracked" class="cbm__kebab" data-test="cbm-kebab">
        <button
          type="button"
          class="cbm__btn"
          data-test="cbm-reset"
          @click="emit('reset-from-library')"
        >Reset to library</button>
        <button
          type="button"
          class="cbm__btn"
          data-test="cbm-save-lib"
          @click="emit('save-to-library')"
        >Save to library</button>
      </div>
      <button type="button" class="cbm__btn" data-test="cbm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="cbm__btn cbm__btn--primary" data-test="cbm-save" @click="emit('save')">Save</button>
    </footer>
  </div>
</template>

<style scoped>
.cbm {
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
.cbm__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--wp-brand-gradient);
  border-bottom: 1px solid var(--wp-border);
  position: relative;
}
.cbm__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.cbm__head > * { position: relative; z-index: 1; }
.cbm__head-icon {
  color: var(--wp-kind-combine);
  font-size: 16px;
  margin-top: 1px;
}
.cbm__title-block { flex: 1; min-width: 0; }
.cbm__title-row { display: flex; align-items: center; gap: 8px; }
.cbm__name { font: 700 13px var(--wp-font-sans); color: var(--wp-text); }
.cbm__chip {
  font: 600 9px var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 2px 5px;
  border-radius: 2px;
  background: color-mix(in oklab, var(--wp-kind-combine) 22%, transparent);
  color: var(--wp-kind-combine);
}
.cbm__sub {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-top: 2px;
}
.cbm__close {
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 13px;
  padding: 4px;
  cursor: pointer;
}
.cbm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.cbm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.cbm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.cbm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.cbm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.cbm__kebab { display: inline-flex; gap: 6px; }
.cbm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.cbm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.cbm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.cbm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.cbm__btn--quiet .pi { font-size: 10px; }
</style>
