<script setup lang="ts">
/**
 * ConstraintInstanceModal — single-pane v2 modal for constraint
 * modules. Library-defining edits (matrix shape, source/target
 * wildcard pair, exception authoring) live in the SPA. Modal
 * exposes per-instance overrides:
 *   - Display name (`meta.name`)
 *   - Per-cell mode + factor overrides
 *   - Per-cell disable (5-state cycle includes "disabled")
 *   - Per-exception mode + factor overrides + disable checkbox
 *   - Extra (instance-only) exceptions
 *
 * Section order: Header → Identity → Matrix → Exceptions → Footer.
 * NO Runtime section — constraint produces no $vars (engine returns
 * empty bindings dict from resolve), and engine doesn't honor
 * `locked_seed` for this kind. Dropping the section is honest;
 * dimmed dead UI would lie.
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import IdentitySection from "./sections/IdentitySection.vue";
import MatrixSection from "./sections/MatrixSection.vue";
import ExceptionsSection from "./sections/ExceptionsSection.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
    /** Sibling modules in the same WP_Context — used to populate
     *  matrix axes (sub_categories) + extra-exception autocomplete
     *  (option values). Optional; falls back to empty axes. */
    siblingModules?: ModuleEntry[];
  }>(),
  { isDrifted: false, isModified: false, siblingModules: () => [] },
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
  return `/wp/constraints/${props.module.id}/edit`;
}

interface WildcardPayload {
  sub_categories?: string[];
  options?: Array<{ value?: string }>;
}

function findWildcardModule(id: string | null | undefined): ModuleEntry | null {
  if (!id) return null;
  const m = props.siblingModules.find((x) => x.id === id);
  if (!m || m.type !== "wildcard") return null;
  return m;
}

function findWildcard(id: string | null | undefined): WildcardPayload | null {
  const m = findWildcardModule(id);
  return m ? ((m.payload ?? {}) as WildcardPayload) : null;
}

function wildcardName(id: string | null | undefined): string {
  // Return meta.name when sibling wildcard is loaded in this Context;
  // otherwise empty string. Caller falls back to "source"/"target"
  // role labels — a truncated UUID (`…ae07018b`) communicates nothing
  // useful to the user when the wildcard lives in another Context.
  const m = findWildcardModule(id);
  return m?.meta?.name ?? "";
}

interface ConstraintPayload {
  source_wildcard_id?: string;
  target_wildcard_id?: string;
  matrix?: Record<string, Record<string, unknown>>;
  exceptions?: Array<{ source_value?: string; target_value?: string; source?: string; target?: string }>;
}

/**
 * Matrix axes — prefer live sub_categories from the source/target
 * wildcards (most current), fall back to keys present in the payload
 * matrix when the wildcards aren't loaded in this Context. Otherwise
 * the modal renders an empty grid for any cross-Context constraint
 * even though the saved matrix data is still meaningful for editing.
 */
const sourceSubs = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = findWildcard(pl.source_wildcard_id)?.sub_categories;
  if (live && live.length > 0) return live;
  return Object.keys(pl.matrix ?? {});
});

const targetSubs = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = findWildcard(pl.target_wildcard_id)?.sub_categories;
  if (live && live.length > 0) return live;
  const set = new Set<string>();
  for (const row of Object.values(pl.matrix ?? {})) {
    for (const k of Object.keys(row ?? {})) set.add(k);
  }
  return Array.from(set);
});

/**
 * Extra-exception autocomplete suggestions — prefer live wildcard
 * option values, fall back to the union of source/target values
 * already present in library exceptions so cross-Context constraints
 * still get useful suggestions.
 */
const sourceValues = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = (findWildcard(pl.source_wildcard_id)?.options ?? [])
    .map((o) => o.value ?? "")
    .filter(Boolean);
  if (live.length > 0) return live;
  const set = new Set<string>();
  for (const e of pl.exceptions ?? []) {
    const v = e.source_value ?? e.source ?? "";
    if (v) set.add(v);
  }
  return Array.from(set);
});

const targetValues = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = (findWildcard(pl.target_wildcard_id)?.options ?? [])
    .map((o) => o.value ?? "")
    .filter(Boolean);
  if (live.length > 0) return live;
  const set = new Set<string>();
  for (const e of pl.exceptions ?? []) {
    const v = e.target_value ?? e.target ?? "";
    if (v) set.add(v);
  }
  return Array.from(set);
});

const sourceName = computed(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return wildcardName(pl.source_wildcard_id);
});
const targetName = computed(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return wildcardName(pl.target_wildcard_id);
});

function onUpdate(patch: Partial<ModuleEntry>): void {
  emit("update", patch);
}

function onSpaClick(): void {
  emit("open-spa");
  window.open(spaUrl(), "_blank", "noopener");
}
</script>

<template>
  <div class="cnm">
    <header class="wp-cnm__head">
      <i class="pi pi-link wp-cnm__head-icon" aria-hidden="true" />
      <div class="wp-cnm__title-block">
        <div class="wp-cnm__title-row">
          <span class="wp-cnm__name" data-test="cnm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-cnm__chip" data-test="cnm-chip">constraint</span>
        </div>
        <div class="wp-cnm__sub">Library entry · source pick → modifies target option weights</div>
      </div>
      <button
        type="button"
        class="wp-cnm__close"
        aria-label="Close"
        data-test="cnm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection :module="module" @update="onUpdate" />
    <MatrixSection
      :module="module"
      :source-subs="sourceSubs"
      :target-subs="targetSubs"
      :source-name="sourceName"
      :target-name="targetName"
      @update="onUpdate"
    />
    <ExceptionsSection
      :module="module"
      :source-values="sourceValues"
      :target-values="targetValues"
      @update="onUpdate"
    />

    <footer class="wp-cnm__foot">
      <a
        v-if="isLibraryTracked"
        class="wp-cnm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="cnm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <button
        type="button"
        class="wp-cnm__btn wp-cnm__btn--quiet"
        data-test="cnm-clear-all"
        title="Clear all instance overrides on this constraint"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="wp-cnm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-cnm__btn"
        data-test="cnm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</button>
      <button type="button" class="wp-cnm__btn" data-test="cnm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="wp-cnm__btn wp-cnm__btn--primary" data-test="cnm-save" @click="emit('save')">Save</button>
    </footer>
  </div>
</template>

<style scoped>
.cnm {
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
.wp-cnm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.wp-cnm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.wp-cnm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-cnm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-cnm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cnm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-cnm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-cnm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.wp-cnm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cnm__btn--quiet .pi { font-size: 10px; }
</style>
