<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import type { ModuleEntry } from "../../widgets/_shared";
import WildcardEditorBody from "./editors/WildcardEditorBody.vue";
import FixedValuesEditorBody from "./editors/FixedValuesEditorBody.vue";
import CombineEditorBody from "./editors/CombineEditorBody.vue";
import DerivationEditorBody from "./editors/DerivationEditorBody.vue";
import ConstraintEditorBody from "./editors/ConstraintEditorBody.vue";
import {
  KIND_TITLE,
  kindHeaderIcon,
  INSTANCE_FIELDS_PER_KIND,
  INSTANCE_TAB_VISIBLE,
  type InstanceFieldKey,
} from "./editors/_shell";
import ModalTabStrip from "./editors/tabs/ModalTabStrip.vue";
import LibraryRoundTripActions from "./editors/library/LibraryRoundTripActions.vue";
import CombineInstanceBody from "./editors/instance/CombineInstanceBody.vue";
import DerivationInstanceBody from "./editors/instance/DerivationInstanceBody.vue";
import ConstraintInstanceBody from "./editors/instance/ConstraintInstanceBody.vue";
import { pruneStaleInstanceRefs } from "./editors/instance/prune";
import { hashes, refreshModule, setLibraryHash } from "./drift-store";
import { pushToast } from "../shared/toast-store";
import ConfirmDialog from "../shared/ConfirmDialog.vue";
import WildcardInstanceModal from "./editors/wildcard/WildcardInstanceModal.vue";
import FixedValuesInstanceModal from "./editors/fixed-values/FixedValuesInstanceModal.vue";

/**
 * Per-kind subtitle text shown under the modal title (mockup v5
 * lines 1040, 1180, 1260, 1317, 1436). Phase A keeps these as
 * static taglines describing the kind's behaviour at a glance —
 * library timestamps + content hashes are deferred to the Phase B
 * library-integration pass. Falls back to an empty string for
 * unknown kinds so the subtitle slot collapses cleanly.
 */
/**
 * Normalize a module type into the slug used by the
 * `--wp-kind-{slug}` palette tokens. Engine stores `fixed_values`
 * but the colour token is `--wp-kind-fixed`, so the kind chip
 * needs the same alias map ContextWidget uses.
 */
function kindChipModifier(kind: string): string {
  return kind === "fixed_values" ? "fixed" : kind;
}

const KIND_SUBTITLE: Record<string, string> = {
  wildcard:    "Library entry · weighted options resolved per pick",
  fixed_values:"Pinned $var → value pairs · no resolution",
  combine:     "Template interpolates $vars into a single string · stored at output binding",
  derivation:  "Rules independent · per-rule branches IF/ELIF/ELSE — first match wins",
  constraint:  "Source pick → modifies target option weights · matrix + per-value exceptions",
};


const props = defineProps<{
  visible: boolean;
  module: ModuleEntry | null;
  /** Variable names defined upstream — used for autocomplete + validity checks. */
  upstreamVars?: string[];
  /** Variable names defined by OTHER modules in the same node. */
  siblingVars?: string[];
  /** Other modules in the same WP_Context node — used by the constraint
   *  preview to resolve source/target uuids back to var-binding names.
   *  May include the module being edited; lookups by uuid skip self. */
  siblingModules?: ModuleEntry[];
  /**
   * Pull the seed THIS module actually rolled with on the last
   * queue. Returns `locked_seed` for wildcards locked at run time;
   * the chain seed otherwise. Snapshotted by the seed widget's
   * `beforeQueued` hook (see widgets/context.ts). Lock toggle uses
   * it so re-locking restores the seed THIS wildcard used, not the
   * generic chain seed.
   */
  lastUsedSeedReader?: (moduleId?: string) => number | null;
}>();

const emit = defineEmits<{
  (e: "save", value: ModuleEntry): void;
  (e: "close"): void;
}>();

// Draft state — owned by the modal. Cancel discards, Save commits via emit.
// `module` prop is the source-of-truth snapshot at open time; we deep-clone
// via JSON round-trip (Proxy-safe at every depth, unlike structuredClone).
const draft = ref<ModuleEntry | null>(null);

// Active tab — Library shows the existing kind-body editors (snapshot
// state), Instance shows per-kind override editors. Smart-defaulted when
// a draft loads via `pickInitialTab()`.
const activeTab = ref<"library" | "instance">("library");

watch(() => props.visible, (v) => {
  if (v && props.module) {
    draft.value = JSON.parse(JSON.stringify(props.module));
    activeTab.value = pickInitialTab();
    window.addEventListener("keydown", onKeydown);
  } else {
    window.removeEventListener("keydown", onKeydown);
    draft.value = null;
  }
}, { immediate: true });

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function onKeydown(ev: KeyboardEvent) {
  if (!props.visible) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
    ev.preventDefault();
    save();
  }
}

// Dispatch to per-kind body component.
const kindBody = computed(() => {
  switch (draft.value?.type) {
    case "wildcard":     return WildcardEditorBody;
    case "fixed_values": return FixedValuesEditorBody;
    case "combine":      return CombineEditorBody;
    case "derivation":   return DerivationEditorBody;
    case "constraint":   return ConstraintEditorBody;
    default:             return null;
  }
});

// Per-kind instance override body. Mirrors `kindBody` but for the
// Instance tab — pipelines have no overrides and resolve to null.
const instanceBody = computed(() => {
  // wildcard never reaches here — the kind dispatcher in <template>
  // short-circuits to <WildcardInstanceModal> before the v1 instanceBody
  // dispatch runs. Other v1 kinds fall through this switch.
  switch (draft.value?.type) {
    // fixed_values never reaches here — kind dispatcher routes it
    // to FixedValuesInstanceModal before this v1 instanceBody dispatch.
    case "combine":      return CombineInstanceBody;
    case "derivation":   return DerivationInstanceBody;
    case "constraint":   return ConstraintInstanceBody;
    default:             return null;
  }
});

// Tab strip is suppressed for kinds with no instance overrides (today
// only `pipeline`). Driven by the registry in `_shell.ts` so adding a
// new kind needs only one source of truth.
const hasInstanceTab = computed(() =>
  draft.value ? INSTANCE_TAB_VISIBLE[draft.value.type] : false,
);

// Modified-state — true when ANY registry field on `instance` is
// non-null. The `_ui` namespace is excluded by virtue of not appearing
// in `INSTANCE_FIELDS_PER_KIND`, so toggling Lock off (which leaves a
// `_ui.last_locked_seed` behind) does NOT light the orange dot.
const instanceModified = computed(() => {
  if (!draft.value) return false;
  const fields = INSTANCE_FIELDS_PER_KIND[draft.value.type];
  const inst = draft.value.instance;
  if (!inst) return false;
  return fields.some((f) => (inst as Record<string, unknown>)[f] != null);
});

const isLibraryTracked = computed(() => !!draft.value?.payload_hash);
const isDrifted = computed(() => {
  if (!draft.value || !draft.value.payload_hash) return false;
  const live = hashes.value?.[draft.value.id];
  return live != null && live !== draft.value.payload_hash;
});

/**
 * Smart default for the active tab on draft load. If the kind has no
 * Instance tab → Library. Otherwise: Instance when any registry field
 * is non-null, Library when none are. Spec §6.3.
 */
function pickInitialTab(): "library" | "instance" {
  if (!draft.value) return "library";
  if (!INSTANCE_TAB_VISIBLE[draft.value.type]) return "library";
  const fields = INSTANCE_FIELDS_PER_KIND[draft.value.type];
  const inst = draft.value.instance;
  if (!inst) return "library";
  return fields.some((f) => (inst as Record<string, unknown>)[f] != null)
    ? "instance"
    : "library";
}

function onUpdate(patch: Record<string, unknown>): void {
  if (!draft.value) return;
  draft.value = { ...draft.value, ...patch };
}

/**
 * Themed confirm dialog — replaces `window.confirm()`. Each prompt
 * configures title/body/labels/variant + a callback to fire on
 * Confirm. Cancel always closes. Single-action queue (one dialog
 * at a time) since browser confirm was the same.
 */
interface ConfirmConfig {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
}
const confirmDialog = ref<ConfirmConfig | null>(null);

function askConfirm(config: ConfirmConfig): void {
  confirmDialog.value = config;
}
function onConfirmDialogConfirm(): void {
  const cb = confirmDialog.value?.onConfirm;
  confirmDialog.value = null;
  cb?.();
}
function onConfirmDialogCancel(): void {
  confirmDialog.value = null;
}

/**
 * "Reset overrides" — clears pool overrides only. Identity (name +
 * variable_binding) has its own per-field reset buttons in the
 * Identity section, so the footer sweep deliberately leaves them
 * alone. Runtime (lock, internal) is also preserved. For wildcard
 * the scope is:
 *   identity → KEPT (per-field reset owns this)
 *   pool     → enabled_options, option_weights, category_filter
 *   runtime  → locked_seed, internal · KEPT
 *   _ui      → KEPT (under-prefix scratch)
 *
 * For other v1 kinds (combine / fixed_values / derivation / constraint)
 * the historical "clear all overrides" still nulls every registry field
 * since they don't separate identity / runtime concerns the same way.
 */
const WILDCARD_RESET_FIELDS: readonly InstanceFieldKey[] = [
  "enabled_options", "option_weights", "category_filter",
] as const;

function onClearAllOverrides(): void {
  if (!draft.value) return;
  const moduleName = draft.value.meta?.name || "this module";
  const isWildcard = draft.value.type === "wildcard";
  const body = isWildcard
    ? `Pool overrides (enabled options, weights, category filter) on "${moduleName}" will be cleared. Identity (name, binding) and runtime (lock, hide) are preserved — use the per-field reset buttons for those.`
    : `All instance overrides on "${moduleName}" will be cleared.`;
  askConfirm({
    title: "Reset overrides?",
    body,
    confirmLabel: "Reset",
    variant: "danger",
    onConfirm: doClearAllOverrides,
  });
}

function doClearAllOverrides(): void {
  if (!draft.value) return;
  const isWildcard = draft.value.type === "wildcard";
  const fields = isWildcard
    ? WILDCARD_RESET_FIELDS
    : INSTANCE_FIELDS_PER_KIND[draft.value.type];

  const cleared: Record<string, unknown> = { ...(draft.value.instance ?? {}) };
  for (const f of fields) {
    cleared[f as InstanceFieldKey] = null;
  }

  // Identity (meta.name) is intentionally left alone — the
  // IdentitySection has its own per-field reset button that owns
  // name restoration. Footer sweep handles pool only.
  let nextEntries = draft.value.entries;
  if (draft.value.type === "fixed_values" && draft.value.payload_hash) {
    // Fixed-values reset must also rewind `entries` to mirror
    // `payload.values`. Without this, save()'s entries→values
    // rebuild resurrects the override (with re-derived `val_NNNN`
    // IDs) on the next save, which breaks library-id match on
    // reopen and renders every row as instance-added (green).
    const libValues = (draft.value.payload as { values?: Array<{ name?: string; value?: string }> } | undefined)?.values ?? [];
    nextEntries = libValues.map((v) => ({
      variable_name: v.name ?? "",
      value: v.value ?? "",
    }));
  }
  draft.value = {
    ...draft.value,
    entries: nextEntries,
    instance: cleared as NonNullable<ModuleEntry["instance"]>,
  };
}

/**
 * "Reset to library" — replaces draft.payload + payload_hash with the
 * refreshed library snapshot, then prunes any instance refs that no
 * longer match the new payload (e.g. dropped option ids). Surfaces a
 * toast summarising whether stale overrides got removed.
 */
function onResetFromLibrary(refreshed: ModuleEntry): void {
  if (!draft.value) return;
  const pruned = pruneStaleInstanceRefs(
    draft.value.instance, refreshed.payload, refreshed.type,
  );
  if (pruned.warnings.length > 0) {
    pushToast(
      `Reset complete. ${pruned.warnings.length} stale override(s) removed.`,
      { severity: "warning" },
    );
  } else {
    pushToast("Reset from library", { severity: "success" });
  }
  draft.value = {
    ...refreshed,
    instance: pruned.instance,
  };
}

/**
 * Wildcard v2 round-trip handlers — bridge `WildcardInstanceModal`
 * kebab-menu events to the same fetch / confirm / toast logic that
 * `LibraryRoundTripActions` runs for v1 kinds. Inline here (vs reusing
 * the v1 component) so the wildcard branch stays self-contained;
 * later phases will fold this into a shared helper once all kinds
 * migrate to v2.
 */
function onWildcardResetClick(): void {
  if (!draft.value) return;
  const moduleName = draft.value.meta?.name || "this module";
  askConfirm({
    title: "Reset to library?",
    body: `Discard ${moduleName}'s local edits and restore the library version. Stale option overrides will be pruned.`,
    confirmLabel: "Reset to library",
    variant: "danger",
    onConfirm: () => { void doWildcardReset(); },
  });
}

async function doWildcardReset(): Promise<void> {
  if (!draft.value) return;
  try {
    const refreshed = await refreshModule(draft.value);
    onResetFromLibrary(refreshed);
  } catch (err) {
    pushToast(`Reset failed: ${(err as Error).message}`, { severity: "error" });
  }
}

function onWildcardSaveToLibraryClick(): void {
  if (!draft.value) return;
  const moduleName = draft.value.meta?.name || "this module";
  askConfirm({
    title: "Save to library?",
    body: `Push current changes to library entry "${moduleName}". Other workflows referencing this module will see the new version on their next open.`,
    confirmLabel: "Save to library",
    onConfirm: () => { void doWildcardSaveToLibrary(); },
  });
}

async function doWildcardSaveToLibrary(): Promise<void> {
  if (!draft.value) return;
  try {
    const res = await fetch(`/wp/api/modules/${draft.value.id}/payload`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: draft.value.payload, meta: draft.value.meta }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { new_hash: string };
    setLibraryHash(draft.value.id, body.new_hash);
    pushToast("Saved to library", { severity: "success" });
  } catch (err) {
    pushToast(`Save failed: ${(err as Error).message}`, { severity: "error" });
  }
}

/**
 * Fixed-values v2 round-trip handlers — siblings of the wildcard
 * pair. Same fetch / confirm / toast logic, just framed for the
 * fixed_values kind.
 */
function onFixedValuesResetClick(): void {
  if (!draft.value) return;
  const moduleName = draft.value.meta?.name || "this module";
  askConfirm({
    title: "Reset to library?",
    body: `Discard ${moduleName}'s local edits and restore the library version. Stale row overrides will be pruned.`,
    confirmLabel: "Reset to library",
    variant: "danger",
    onConfirm: () => { void doFixedValuesReset(); },
  });
}

async function doFixedValuesReset(): Promise<void> {
  if (!draft.value) return;
  try {
    const refreshed = await refreshModule(draft.value);
    onResetFromLibrary(refreshed);
  } catch (err) {
    pushToast(`Reset failed: ${(err as Error).message}`, { severity: "error" });
  }
}

function onFixedValuesSaveToLibraryClick(): void {
  if (!draft.value) return;
  const moduleName = draft.value.meta?.name || "this module";
  askConfirm({
    title: "Save to library?",
    body: `Push current values to library entry "${moduleName}". Other workflows referencing this module will see the new version on their next open.`,
    confirmLabel: "Save to library",
    onConfirm: () => { void doFixedValuesSaveToLibrary(); },
  });
}

async function doFixedValuesSaveToLibrary(): Promise<void> {
  if (!draft.value) return;
  try {
    const res = await fetch(`/wp/api/modules/${draft.value.id}/payload`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: draft.value.payload, meta: draft.value.meta }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { new_hash: string };
    setLibraryHash(draft.value.id, body.new_hash);
    pushToast("Saved to library", { severity: "success" });
  } catch (err) {
    pushToast(`Save failed: ${(err as Error).message}`, { severity: "error" });
  }
}

function save() {
  if (!draft.value) return;
  const next = JSON.parse(JSON.stringify(draft.value)) as ModuleEntry;
  if (next.type === "fixed_values") {
    // Two-tier model:
    //   - Inline-created (no `payload_hash`, no library link): the
    //     module is local-only, so user edits write straight into
    //     `payload.values` — that array IS the source of truth.
    //   - Library-tracked (`payload_hash` set by the picker): the
    //     library snapshot's `payload.values` stays immutable; user
    //     edits land in `instance.values_overrides`, mirroring the
    //     wildcard pattern. The engine's resolver picks overrides
    //     when present, library payload otherwise. Modified-state +
    //     "reset to library" both pivot on the override field.
    //
    // v2 FixedValuesInstanceModal sets `instance.values_overrides`
    // directly with library-row IDs preserved. Detect that path and
    // skip the entries→values rebuild — otherwise we'd re-derive
    // `val_NNNN` IDs from position and stomp the original library
    // IDs, which makes every row render as instance-added (green) on
    // reopen.
    const inst = { ...(next.instance ?? {}) };
    const v2Override = (inst as { values_overrides?: unknown }).values_overrides;
    if (next.payload_hash) {
      const libraryValues = (next.payload as { values?: unknown } | undefined)?.values;
      if (Array.isArray(v2Override)) {
        // v2 path — IDs already correct; just check sameAsLibrary so
        // a fully reverted instance drops the override field cleanly.
        const sameAsLibrary =
          Array.isArray(libraryValues)
          && libraryValues.length === v2Override.length
          && libraryValues.every((lib, i) => {
            const l = lib as { id?: unknown; name?: unknown; value?: unknown };
            const cur = v2Override[i] as { id?: unknown; name?: unknown; value?: unknown };
            return l.id === cur.id && l.name === cur.name && l.value === cur.value;
          });
        if (sameAsLibrary) {
          delete (inst as { values_overrides?: unknown }).values_overrides;
        }
        next.instance = inst;
      } else {
        // v1 path — derive values from entries (FixedValuesEditorBody
        // round-trip still routes through entries; kept for backward
        // compatibility until the v1 inline editor is removed).
        const values = next.entries.map((e, i) => ({
          id: `val_${i.toString(16).padStart(4, "0")}`,
          name: e.variable_name,
          value: e.value,
        }));
        const sameAsLibrary =
          Array.isArray(libraryValues)
          && libraryValues.length === values.length
          && libraryValues.every((lib, i) => {
            const l = lib as { name?: unknown; value?: unknown };
            const cur = values[i];
            return l.name === cur.name && l.value === cur.value;
          });
        if (sameAsLibrary) {
          delete (inst as { values_overrides?: unknown }).values_overrides;
        } else {
          (inst as { values_overrides: typeof values }).values_overrides = values;
        }
        next.instance = inst;
      }
    } else {
      // Inline-created path — payload.values is the only store. v2
      // modal still emits entries in sync, so derivation works
      // identically to the v1 path.
      const values = next.entries.map((e, i) => ({
        id: `val_${i.toString(16).padStart(4, "0")}`,
        name: e.variable_name,
        value: e.value,
      }));
      next.payload = { ...(next.payload ?? {}), values };
    }
  }
  emit("save", next);
}

function cancel() {
  emit("close");
}
</script>

<template>
  <ModalShell :visible="visible" @close="cancel">
    <!-- v2 wildcard branch — single-pane tailored modal renders its
         own header/footer/body. No v1 chrome (no .wp-medit wrapper,
         no tab strip, no LibraryRoundTripActions footer). -->
    <WildcardInstanceModal
      v-if="draft && draft.type === 'wildcard'"
      :module="draft"
      :is-drifted="isDrifted"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @reset-from-library="onWildcardResetClick"
      @save-to-library="onWildcardSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

    <!-- v2 fixed-values branch — single-pane tailored modal. -->
    <FixedValuesInstanceModal
      v-else-if="draft && draft.type === 'fixed_values'"
      :module="draft"
      :is-drifted="isDrifted"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @reset-from-library="onFixedValuesResetClick"
      @save-to-library="onFixedValuesSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

    <!-- v1 tabbed branch — non-wildcard, non-fixed_values kinds keep
         the existing Library/Instance tab structure until each kind
         is migrated to its own v2 single-pane modal. -->
    <div v-else-if="draft" class="wp-medit">
      <header class="wp-medit__head">
        <i
          :class="[kindHeaderIcon(draft.type), 'wp-medit__head-icon', `type-${draft.type}`]"
          aria-hidden="true"
        ></i>

        <!-- Title block — V2 (mockup v5 lines 1039-1040, 1180, 1260,
             1317, 1436). Stacks the name row over a kind-specific
             subtitle so the modal reads as a real header instead of
             a single-line title. Subtitle text comes from the
             KIND_SUBTITLE static map; library timestamps + content
             hashes will land in Phase B's library-integration pass. -->
        <div class="wp-medit__title-block">
          <!-- Title row holds the name (editable for fixed_values,
               read-only for snapshot kinds) PLUS the kind chip
               (V3, mockup v5 line 1039) — chip is the canonical
               "this kind" cue across the row, picker, and editor.
               Reuses the same `.wp-kind-chip` styling defined in
               ContextWidget. -->
          <div class="wp-medit__title-row">
            <input
              v-if="draft.type === 'fixed_values'"
              v-model="draft.meta.name"
              class="wp-medit__name-input"
              placeholder="module name"
              spellcheck="false"
            />
            <span v-else class="wp-medit__name-readonly">
              {{ draft.meta.name || draft.type }}
            </span>
            <span
              class="wp-kind-chip"
              :class="`wp-kind-chip--${kindChipModifier(draft.type)}`"
            >{{ KIND_TITLE[draft.type] ?? draft.type }}</span>
          </div>

          <div v-if="KIND_SUBTITLE[draft.type]" class="wp-medit__sub">
            {{ KIND_SUBTITLE[draft.type] }}
          </div>
        </div>

        <button type="button" class="wp-medit__close" aria-label="Close" @click="cancel">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </header>

      <ModalTabStrip
        v-model="activeTab"
        :has-instance-tab="hasInstanceTab"
        :instance-modified="instanceModified"
      />

      <div class="wp-medit__body">
        <!-- Library tab — existing kind-body editors. -->
        <template v-if="activeTab === 'library'">
          <component
            :is="kindBody"
            v-if="kindBody"
            :module="draft"
            :upstream-vars="upstreamVars"
            :sibling-vars="siblingVars"
            :sibling-modules="siblingModules"
            :last-used-seed-reader="lastUsedSeedReader"
            @update="onUpdate"
          />
          <section v-else class="wp-medit__section">
            <label class="wp-medit__section-label">SNAPSHOT</label>
            <p class="wp-medit__hint-line">
              <strong>{{ draft.type }}</strong> kind has no library editor yet.
              Edit the library row in the SPA to change behaviour.
            </p>
          </section>
        </template>
        <!-- Instance tab — per-kind override editors. -->
        <template v-else>
          <component
            :is="instanceBody"
            v-if="instanceBody"
            :module="draft"
            :sibling-modules="siblingModules"
            @update="onUpdate"
          />
        </template>
      </div>

      <footer class="wp-medit__foot">
        <!-- Library tab footer: round-trip actions (Open in SPA / Reset / Save). -->
        <template v-if="activeTab === 'library'">
          <LibraryRoundTripActions
            :module="draft"
            :is-library-tracked="isLibraryTracked"
            :is-drifted="isDrifted"
            @reset-from-library="onResetFromLibrary"
            @saved-to-library="() => {}"
          />
        </template>
        <!-- Instance tab footer: clear-all-overrides shortcut. -->
        <template v-else>
          <button
            v-if="instanceModified"
            type="button"
            class="wp-medit__btn"
            data-test="clear-all-overrides"
            @click="onClearAllOverrides"
          >
            <i class="pi pi-replay" aria-hidden="true"></i>
            Clear all overrides
          </button>
          <span v-else></span>
        </template>
        <span class="wp-medit__hint">Esc to cancel · Ctrl+Enter to save</span>
        <div class="wp-medit__buttons">
          <button type="button" class="wp-medit__btn" @click="cancel">Cancel</button>
          <button type="button" class="wp-medit__btn wp-medit__btn--primary" @click="save">Save</button>
        </div>
      </footer>
    </div>
  </ModalShell>

  <!-- Themed confirm dialog — replaces window.confirm() for any
       prompt the modal raises (reset overrides, reset to library,
       save to library). Single-instance: only one prompt at a time. -->
  <ConfirmDialog
    :visible="confirmDialog !== null"
    :title="confirmDialog?.title ?? ''"
    :body="confirmDialog?.body ?? ''"
    :confirm-label="confirmDialog?.confirmLabel ?? 'Confirm'"
    :cancel-label="confirmDialog?.cancelLabel ?? 'Cancel'"
    :variant="confirmDialog?.variant ?? 'default'"
    @confirm="onConfirmDialogConfirm"
    @cancel="onConfirmDialogCancel"
  />
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-medit, .wp-medit * { box-sizing: border-box; }
.wp-medit {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  /* Width bumped from 540px to 820px after Instance tab landed —
   * sections like option-weights tables, constraint matrix grids, and
   * disabled-rules lists all benefit from more horizontal room without
   * forcing horizontal scroll inside the body. Clamps to 100% on
   * narrow viewports via the max-width below. */
  width: 820px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
}

.wp-medit__head {
  display: flex;
  /* Top-align so the kind icon tracks the name line, not the
   * vertical center of the (taller) name + subtitle stack. */
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-brand-gradient);
  position: relative;
}
.wp-medit__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.wp-medit__head > * { position: relative; z-index: 1; }
.wp-medit__head-icon {
  font-size: 14px;
  color: var(--wp-text2);
  flex-shrink: 0;
  /* Nudge down so the icon visually centers with the 13px name
   * line rather than sitting flush with its top edge. */
  padding-top: 4px;
}
/* Kind-specific colors mirror the kind-borders on ContextWidget rows so
 * the modal header reads the same kind-identity at a glance. */
.wp-medit__head-icon.type-wildcard    { color: var(--wp-kind-wildcard); }
.wp-medit__head-icon.type-fixed_values { color: var(--wp-kind-fixed, var(--wp-rose)); }
.wp-medit__head-icon.type-combine     { color: var(--wp-kind-combine); }
.wp-medit__head-icon.type-derivation  { color: var(--wp-kind-derivation); }
.wp-medit__head-icon.type-constraint  { color: var(--wp-kind-constraint); }
.wp-medit__head-icon.type-pipeline    { color: var(--wp-kind-pipeline); }
.wp-medit__name-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px;
  min-width: 0;
}
.wp-medit__name-input:focus { outline: none; border-color: var(--wp-accent); }
/* V2 — title block stacks the name row over the kind subtitle so
 * the modal header reads as a real two-line title (mockup v5 lines
 * 1039-1040). Flexes to fill the space between the kind icon on
 * the left and the close button on the right. */
.wp-medit__title-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-medit__sub {
  font: 11px/1.35 var(--wp-font-sans, sans-serif);
  color: var(--wp-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Tiny top margin pulls the subtitle off the name baseline so
   * the two lines don't read as one wrapped sentence. */
  margin-top: 2px;
}

.wp-medit__close {
  background: none;
  border: none;
  color: var(--wp-text3);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 6px;
}
.wp-medit__close:hover { color: var(--wp-text); }

.wp-medit__body {
  padding: 12px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}
.wp-medit__section { display: flex; flex-direction: column; gap: 6px; }
.wp-medit__section-label {
  font-size: 9px;
  font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3);
  letter-spacing: 0.08em;
  font-weight: 600;
}
.wp-medit__hint-line {
  font-size: 11px;
  color: var(--wp-text3);
  margin: 0 0 2px;
}

/* V3 — name + kind chip share a flex row inside the title block.
 * Name takes only its content width (no flex grow) so the chip
 * sits FLUSH next to the name instead of being shoved to the far
 * right of the row by a flex-fill name span. The title-block's
 * own `flex: 1` already carves out the right-hand space for the
 * close button, so nothing here needs to push it. */
.wp-medit__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* Read-only name header for snapshot kinds (non-fixed_values). */
.wp-medit__name-readonly {
  flex: 0 1 auto;
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 13px;
  font-weight: 600;
  padding: 4px 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wp-medit__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-top: 1px solid var(--wp-border);
  gap: 12px;
}
.wp-medit__hint {
  font-size: 10px;
  color: var(--wp-text3);
  font-family: var(--wp-font-mono, monospace);
}
.wp-medit__buttons { display: flex; gap: 8px; }
.wp-medit__btn {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  padding: 5px 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.wp-medit__btn:hover { border-color: var(--wp-border2); }
.wp-medit__btn--primary {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
  color: #fff;
  font-weight: 600;
}
.wp-medit__btn--primary:hover { background: var(--wp-accent2); border-color: var(--wp-accent2); }
</style>
