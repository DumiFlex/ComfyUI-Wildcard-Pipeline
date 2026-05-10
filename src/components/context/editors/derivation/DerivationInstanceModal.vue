<script setup lang="ts">
/**
 * DerivationInstanceModal — single-pane v2 modal for derivation
 * modules. Library-defining edits (rule conditions, branches,
 * actions) live in the SPA. Modal exposes per-instance overrides:
 *   - Display name (`meta.name`)
 *   - Per-rule + per-branch disable toggles
 *   - Action.value + condition.value overrides per branch
 *   - Rule reorder via drag-and-drop
 *   - Lock seed + Hide-from-prompt (Runtime section)
 *
 * Section order matches all shipped v2 modals: Header → Identity →
 * Rules (kind-specific) → Runtime → Footer.
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import RulesSection from "./sections/RulesSection.vue";
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
  return `/wp/derivations/${props.module.id}/edit`;
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
  <div class="dvm">
    <header class="dvm__head">
      <i class="pi pi-arrow-right-arrow-left dvm__head-icon" aria-hidden="true" />
      <div class="dvm__title-block">
        <div class="dvm__title-row">
          <span class="dvm__name" data-test="dvm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="dvm__chip" data-test="dvm-chip">derivation</span>
        </div>
        <div class="dvm__sub">Library entry · conditional rule-based variable rewrites</div>
      </div>
      <button
        type="button"
        class="dvm__close"
        aria-label="Close"
        data-test="dvm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection :module="module" @update="onUpdate" />
    <RulesSection :module="module" @update="onUpdate" />
    <RuntimeSection :module="module" @update="onUpdate" />

    <footer class="dvm__foot">
      <a
        v-if="isLibraryTracked"
        class="dvm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="dvm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <button
        type="button"
        class="dvm__btn dvm__btn--quiet"
        data-test="dvm-clear-all"
        title="Clear all instance overrides on this derivation"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="dvm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <div v-if="isDrifted && isLibraryTracked" class="dvm__kebab" data-test="dvm-kebab">
        <button
          type="button"
          class="dvm__btn"
          data-test="dvm-reset"
          @click="emit('reset-from-library')"
        >Reset to library</button>
        <button
          type="button"
          class="dvm__btn"
          data-test="dvm-save-lib"
          @click="emit('save-to-library')"
        >Save to library</button>
      </div>
      <button type="button" class="dvm__btn" data-test="dvm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="dvm__btn dvm__btn--primary" data-test="dvm-save" @click="emit('save')">Save</button>
    </footer>
  </div>
</template>

<style scoped>
.dvm {
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
.dvm__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--wp-brand-gradient);
  border-bottom: 1px solid var(--wp-border);
  position: relative;
}
.dvm__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.dvm__head > * { position: relative; z-index: 1; }
.dvm__head-icon {
  color: var(--wp-kind-derivation, var(--wp-accent));
  font-size: 16px;
  margin-top: 1px;
}
.dvm__title-block { flex: 1; min-width: 0; }
.dvm__title-row { display: flex; align-items: center; gap: 8px; }
.dvm__name { font: 700 13px var(--wp-font-sans); color: var(--wp-text); }
.dvm__chip {
  font: 600 9px var(--wp-font-sans);
  text-transform: lowercase;
  letter-spacing: 0.04em;
  padding: 2px 5px;
  border-radius: 2px;
  background: color-mix(in oklab, var(--wp-kind-derivation, var(--wp-accent)) 22%, transparent);
  color: var(--wp-kind-derivation, var(--wp-accent));
}
.dvm__sub {
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  margin-top: 2px;
}
.dvm__close {
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 13px;
  padding: 4px;
  cursor: pointer;
}
.dvm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.dvm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.dvm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.dvm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.dvm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.dvm__kebab { display: inline-flex; gap: 6px; }
.dvm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.dvm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.dvm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.dvm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.dvm__btn--quiet .pi { font-size: 10px; }
</style>
