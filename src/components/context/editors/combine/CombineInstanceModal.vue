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
import { type ResolvedValue } from "../../../../widgets/richTokenize";
import type { ModuleEntry } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import TemplateSection from "./sections/TemplateSection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
    /** Upstream var names from chain — fed into TemplateSection's
     *  insert-var dropdown so users don't have to remember which
     *  bindings they can reach from this module. */
    upstreamVars?: string[];
    /** Resolved upstream-var snapshot — drives the TemplateSection's
     *  live preview pane with substituted values. */
    upstreamResolved?: Record<string, ResolvedValue>;
    /** Sibling var names produced by other modules in this same Context
     *  node. Combined with upstreamVars to populate the dropdown. */
    siblingVars?: string[];
  }>(),
  {
    isDrifted: false,
    isModified: false,
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
  "save-to-library": [];
  "clear-all-overrides": [];
}>();

const isLibraryTracked = computed(() => Boolean(props.module.payload_hash));
// See WildcardInstanceModal — PushToLibraryModal owns the update vs fork
// choice, so save-to-library is always available when payload exists.
const canSaveToLibrary = computed(() => Boolean(props.module.payload));

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
    <header class="wp-cbm__head">
      <i class="pi pi-link wp-cbm__head-icon" aria-hidden="true" />
      <div class="wp-cbm__title-block">
        <div class="wp-cbm__title-row">
          <span class="wp-cbm__name" data-test="cbm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-cbm__chip" data-test="cbm-chip">combine</span>
        </div>
        <div class="wp-cbm__sub">Library entry · template interpolates $vars into output binding</div>
      </div>
      <button
        type="button"
        class="wp-cbm__close"
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

    <footer class="wp-cbm__foot">
      <a
        v-if="isLibraryTracked"
        class="wp-cbm__spa-link"
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
        class="wp-cbm__btn wp-cbm__btn--quiet"
        data-test="cbm-clear-all"
        title="Clear all instance overrides on this combine"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="wp-cbm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-cbm__btn"
        data-test="cbm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</button>
      <button type="button" class="wp-cbm__btn" data-test="cbm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="wp-cbm__btn wp-cbm__btn--primary" data-test="cbm-save" @click="emit('save')">Save</button>
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
/* Head styling lives in src/components/context/editors/_modal-head.css
 * (imported once by ContextWidget). Every modal in this family shares
 * the same accent-tinted gradient + chip + close button. */
.wp-cbm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.wp-cbm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.wp-cbm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-cbm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-cbm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cbm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-cbm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-cbm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.wp-cbm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cbm__btn--quiet .pi { font-size: 10px; }
</style>
