<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import type { PairingBadge } from "../../../../extension/constraint-pairs";
import IdentitySection from "./sections/IdentitySection.vue";
import PoolSection from "./sections/PoolSection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
    /** Names produced upstream of this Context node. Drives the
     *  IdentitySection collision warning. */
    upstreamVars?: string[];
    /** Names produced by other modules in the SAME Context node. */
    siblingVars?: string[];
    /** Per-option pair badges when this wildcard is a constraint carrier
     *  (one of its options contains a nested `@{uuid}` that resolves to a
     *  downstream constraint's target). Keyed by option id. */
    viaOptionPairs?: Map<string, PairingBadge[]>;
  }>(),
  { isDrifted: false, isModified: false, upstreamVars: () => [], siblingVars: () => [], viaOptionPairs: () => new Map() },
);

const emit = defineEmits<{
  "update": [patch: Partial<ModuleEntry>];
  "save": [];
  "cancel": [];
  "open-spa": [];
  "save-to-library": [];
  "clear-all-overrides": [];
}>();

// Save-to-library is always available when the row has a payload —
// the unified PushToLibraryModal owns the explicit "Update existing"
// (disabled when no payload_hash) vs "Save as new entry" choice, so
// the older gate of `isLibraryTracked && isModified` is gone.
const canSaveToLibrary = computed(() => Boolean(props.module.payload));

/** SP2a: when the instance picks more than one option the var resolves to a
 *  list, so the header subtitle drops the singular "per pick" framing. */
const isMultiPick = computed(() => {
  const inst = props.module.instance ?? {};
  const lo = typeof inst.pick_min === "number" ? inst.pick_min : 1;
  const hi = typeof inst.pick_max === "number" ? inst.pick_max : lo;
  const loC = Math.max(0, Math.min(lo, hi));
  return !(loC === 1 && Math.max(loC, hi) === 1);
});

function spaUrl(): string {
  // SPA base is `/wp/` (see `src/manager/router/index.ts:44`),
  // so wildcard editor lives at `/wp/wildcards/<id>/edit`. The
  // earlier `/wp/manager/...` prefix didn't match any route.
  return `/wp/wildcards/${props.module.id}/edit`;
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
  <div class="wp-wcm">
    <header class="wp-wcm__head">
      <i class="pi pi-sparkles wp-wcm__head-icon" aria-hidden="true" />
      <div class="wp-wcm__title-block">
        <div class="wp-wcm__title-row">
          <span class="wp-wcm__name" data-test="wcm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-wcm__chip" data-test="wcm-chip">wildcard</span>
        </div>
        <div class="wp-wcm__sub" data-test="wcm-sub">
          {{ isMultiPick
            ? "Library entry · resolves a list (multi-pick)"
            : "Library entry · weighted options resolved per pick" }}
        </div>
      </div>
      <button
        type="button"
        class="wp-wcm__close"
        aria-label="Close"
        data-test="wcm-close"
        @click="emit('cancel')"
      >
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </header>

    <IdentitySection
      :module="module"
      :upstream-vars="upstreamVars"
      :sibling-vars="siblingVars"
      @update="onUpdate"
    />
    <PoolSection :module="module" :via-option-pairs="viaOptionPairs" @update="onUpdate" />
    <RuntimeSection :module="module" @update="onUpdate" />

    <footer class="wp-wcm__foot">
      <a
        v-if="module.payload_hash"
        class="wp-wcm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="wcm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <button
        type="button"
        class="wp-wcm__btn wp-wcm__btn--quiet"
        data-test="wcm-clear-all"
        title="Clear all instance overrides on this wildcard"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="wp-wcm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-wcm__btn"
        data-test="wcm-save-lib"
        @click="emit('save-to-library')"
      >
        Save to library
      </button>
      <button type="button" class="wp-wcm__btn" data-test="wcm-cancel" @click="emit('cancel')">
        Cancel
      </button>
      <button
        type="button"
        class="wp-wcm__btn wp-wcm__btn--primary"
        data-test="wcm-save"
        @click="emit('save')"
      >
        Save
      </button>
    </footer>
  </div>
</template>

<style scoped>
.wp-wcm {
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
 * (imported once by ContextWidget). Adopted from InjectorBindingModal
 * so every per-instance edit modal reads as one design family. */
.wp-wcm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.wp-wcm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.wp-wcm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-wcm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-wcm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-wcm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-wcm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-wcm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.wp-wcm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-wcm__btn--quiet .pi { font-size: 10px; }
</style>
