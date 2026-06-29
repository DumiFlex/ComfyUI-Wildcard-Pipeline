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
import { computed, onMounted, ref } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import type { PairingBadge } from "../../../../extension/constraint-pairs";
import type { ModuleRow } from "../../../../manager/api/types";
import {
  buildWildcardRefData,
  collectLibraryWildcardRefs,
} from "../../../../manager/utils/library-suggestions";
import IdentitySection from "./sections/IdentitySection.vue";
import RulesSection from "./sections/RulesSection.vue";
import RuntimeSection from "./sections/RuntimeSection.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
    /** Vars produced upstream of this Context node — forwarded as the
     *  `$var` autocomplete list for the rule override fields. */
    upstreamVars?: string[];
    /** Vars produced by other modules in the SAME Context node. */
    siblingVars?: string[];
    /** Via-nested constraint-pair badges for this derivation when it acts
     *  as a constraint carrier (a rule ACTION value hosts a nested `@{uuid}`
     *  that resolves to a downstream constraint's target). Keyed by the
     *  engine branch key (`${rule_id}:${bi}` / `${rule_id}:else`). Forwarded
     *  verbatim to RulesSection, which renders the inline `↪#N` badge. */
    viaOptionPairs?: Map<string, readonly PairingBadge[]>;
    /** When true, a frame override context is active. Run-level controls
     *  are disabled in frame mode. */
    frameActive?: boolean;
  }>(),
  {
    isDrifted: false,
    isModified: false,
    upstreamVars: () => [],
    siblingVars: () => [],
    viaOptionPairs: () => new Map(),
  },
);

// ── Library catalog → `@{}` ref-data ───────────────────────────────
//
// Bug parity: the rule ACTION-value override fields reuse the wildcard
// `@{}` nested-ref machinery (autocomplete + chips + step-2 sub-cat
// picker), and the read-only summary chips `@{uuid}` refs. Both need the
// per-wildcard ref-data the SPA derivation editor builds from
// `moduleStore.catalog`. The canvas has no Pinia store, so we fetch the
// library ONCE when the modal mounts (same `/wp/api/modules` source the
// ModulePickerModal reads) and build the SAME maps via the shared
// `buildWildcardRefData`. The `@{}` source is the LIBRARY (by identity),
// NOT this Context node's chain — a chain sibling would be a `$var`.
const catalog = ref<ModuleRow[]>([]);

const refData = computed(() => buildWildcardRefData(catalog.value));
const uuidToName = computed(() => refData.value.uuidToName);
// Library wildcard uuids for `@{}` autocomplete, excluding this module's own
// id (a wildcard never nests itself) — sorted by display name to mirror the
// SPA's `collectLibraryWildcardRefs`.
const refSuggestions = computed(() =>
  collectLibraryWildcardRefs({ catalog: catalog.value }, props.module.id, refData.value.uuidToName),
);

/** `$var` suggestion list for the override fields — upstream + sibling
 *  producer vars, deduped + alpha-sorted (mirrors the combine modal). */
const varSuggestions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const n of props.upstreamVars) if (n) set.add(n);
  for (const n of props.siblingVars) if (n) set.add(n);
  return [...set].sort();
});

onMounted(async () => {
  // Fire-and-forget: until this resolves the ref-data maps stay empty, so
  // autocomplete simply shows nothing + summary chips fall back to cached
  // names — no crash, no blocking. A failed fetch leaves the catalog empty.
  try {
    if (typeof fetch !== "function") return;
    const res = await fetch("/wp/api/modules", { credentials: "same-origin" });
    if (!res.ok) return;
    const json = (await res.json()) as { items?: ModuleRow[] };
    if (Array.isArray(json.items)) catalog.value = json.items;
  } catch {
    // Non-fatal — leave catalog empty (editor still works without @{} data).
  }
});

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
    <header class="wp-dvm__head">
      <i class="pi pi-arrow-right-arrow-left wp-dvm__head-icon" aria-hidden="true" />
      <div class="wp-dvm__title-block">
        <div class="wp-dvm__title-row">
          <span class="wp-dvm__name" data-test="dvm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-dvm__chip" data-test="dvm-chip">derivation</span>
        </div>
        <div class="wp-dvm__sub">Library entry · conditional rule-based variable rewrites</div>
      </div>
      <button
        type="button"
        class="wp-dvm__close"
        aria-label="Close"
        data-test="dvm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection :module="module" @update="onUpdate" />
    <RulesSection
      :module="module"
      :var-suggestions="varSuggestions"
      :ref-suggestions="refSuggestions"
      :uuid-to-name="uuidToName"
      :uuid-to-sub-categories="refData.uuidToSubCategories"
      :uuid-to-has-null="refData.uuidToHasNull"
      :uuid-to-options-count="refData.uuidToOptionsCount"
      :uuid-to-option-tag-sets="refData.uuidToOptionTagSets"
      :uuid-to-tag-groups="refData.uuidToTagGroups"
      :via-option-pairs="viaOptionPairs"
      @update="onUpdate"
    />
    <div class="wp-dvm__dock">
    <RuntimeSection :module="module" :frame-active="frameActive" @update="onUpdate" />

    <footer class="wp-dvm__foot">
      <a
        v-if="isLibraryTracked"
        class="wp-dvm__spa-link"
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
        class="wp-dvm__btn wp-dvm__btn--quiet"
        data-test="dvm-clear-all"
        title="Clear all instance overrides on this derivation"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="wp-dvm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-dvm__btn"
        data-test="dvm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</button>
      <button type="button" class="wp-dvm__btn" data-test="dvm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="wp-dvm__btn wp-dvm__btn--primary" data-test="dvm-save" @click="emit('save')">Save</button>
    </footer>
    </div>
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
  /* The MODAL does not scroll — only the RULES list inside does (it caps at
   * an absolute max-height and scrolls in place). overflow:hidden here forces
   * that: it's the only overflow path, so header + identity stay pinned at
   * the top and the dock at the bottom while the rules scroll between them.
   * (overflow-y:auto on the modal instead let the WHOLE modal scroll, sliding
   * the bottom rules under the sticky dock — the "can't see the full rules"
   * bug. An absolute inner max-height — not flex:1, which collapses because
   * the overlay parents carry only max-height:100% — is the load-bearing
   * part; RulesSection sizes it to 80vh minus this fixed chrome so nothing
   * clips.) */
  overflow: hidden;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}
/* Head styling lives in src/components/context/editors/_modal-head.css
 * (imported once by ContextWidget). */
.wp-dvm__dock {
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: var(--wp-bg2);
  flex-shrink: 0;
}
.wp-dvm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.wp-dvm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.wp-dvm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-dvm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-dvm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-dvm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-dvm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-dvm__btn:hover {
  border-color: var(--wp-border-strong, var(--wp-border2));
  color: var(--wp-text);
}
.wp-dvm__btn--primary:hover {
  border-color: var(--wp-accent2, var(--wp-accent));
  background: var(--wp-accent2, var(--wp-accent));
  color: white;
}
.wp-dvm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.wp-dvm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-dvm__btn--quiet .pi { font-size: 10px; }
</style>
