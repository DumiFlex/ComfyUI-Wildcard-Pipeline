<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import type { ModuleEntry, ModuleEntryKind } from "../../widgets/_shared";
import { type ResolvedValue } from "../../widgets/richTokenize";
import {
  INSTANCE_FIELDS_PER_KIND,
  type InstanceFieldKey,
} from "./editors/_shell";
import { setLibraryHash } from "./drift-store";
import { pushToast } from "../shared/toast-store";
import ConfirmDialog from "../shared/ConfirmDialog.vue";
import PushToLibraryModal from "./PushToLibraryModal.vue";
import WildcardInstanceModal from "./editors/wildcard/WildcardInstanceModal.vue";
import FixedValuesInstanceModal from "./editors/fixed-values/FixedValuesInstanceModal.vue";
import CombineInstanceModal from "./editors/combine/CombineInstanceModal.vue";
import DerivationInstanceModal from "./editors/derivation/DerivationInstanceModal.vue";
import ConstraintInstanceModal from "./editors/constraint/ConstraintInstanceModal.vue";
import type { ChainModule, PairingBadge } from "../../extension/constraint-pairs";


const props = defineProps<{
  visible: boolean;
  module: ModuleEntry | null;
  /** Variable names defined upstream — used for autocomplete + validity checks. */
  upstreamVars?: string[];
  /** Resolved upstream `$name → value` map. Combine modal uses this
   *  to render a live preview pane with vars substituted. */
  upstreamResolved?: Record<string, ResolvedValue>;
  /** Variable names defined by OTHER modules in the same node. */
  siblingVars?: string[];
  /** Other modules in the same WP_Context node — used by the constraint
   *  preview to resolve source/target uuids back to var-binding names.
   *  May include the module being edited; lookups by uuid skip self. */
  siblingModules?: ModuleEntry[];
  /** Flattened cross-node module chain (upstream + own + downstream
   *  WP_Context nodes). Forwarded to the constraint modal so it can
   *  resolve a source/target wildcard that lives in another Context
   *  node, not just `siblingModules` (same-node only). */
  chainModules?: ChainModule[];
  /** Per-option pair badges for the currently-edited wildcard when it
   *  acts as a constraint carrier (target reached via nested `@{uuid}`).
   *  Keyed by option id. Empty for non-wildcard or non-carrier rows. */
  viaOptionPairs?: Map<string, PairingBadge[]>;
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

watch(() => props.visible, (v) => {
  if (v && props.module) {
    draft.value = JSON.parse(JSON.stringify(props.module));
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
 * "Reset overrides" — clears the kind-specific override fields only.
 * Identity (name + variable_binding) has its own per-field reset
 * buttons in the Identity section, so the footer sweep deliberately
 * leaves them alone. Runtime (lock, internal) is also preserved
 * across all v2 kinds — runtime is orthogonal to the rule/pool/value
 * overrides users typically reach for "Reset" to clear.
 *
 *   identity → KEPT (per-field reset owns this)
 *   kind-specific → CLEARED per the registry below
 *   runtime → KEPT (locked_seed, internal)
 *   _ui → KEPT (under-prefix scratch)
 *
 * Registry replaces the prior wildcard-only `WILDCARD_RESET_FIELDS`
 * + the all-or-nothing `isWildcard` branch. All v2 kinds now follow
 * the wildcard pattern. Constraint stays "everything cleared" since
 * it's still on v1 and doesn't separate runtime from overrides.
 */
const RESET_FIELDS_PER_KIND: Record<ModuleEntryKind, readonly InstanceFieldKey[]> = {
  wildcard: [
    "enabled_options", "option_weights", "category_filter", "exclude_null",
    "pick_min", "pick_max", "pick_separator",
  ],
  fixed_values: ["values_overrides", "enabled_options"],
  combine: ["template_override", "variable_binding"],
  derivation: [
    "disabled_rule_ids",
    "disabled_branch_keys",
    "action_value_overrides",
    "condition_value_overrides",
    "rule_order_override",
  ],
  constraint: [
    "disabled_exception_keys",
    "disabled_matrix_cells",
    "cell_mode_overrides",
    "cell_factor_overrides",
    "exception_mode_overrides",
    "exception_factor_overrides",
    "extra_exceptions",
  ],
};

function onClearAllOverrides(): void {
  if (!draft.value) return;
  const moduleName = draft.value.meta?.name || "this module";
  const body =
    `Override fields on "${moduleName}" will be cleared. Identity ` +
    "(name, binding) and runtime (lock, hide) are preserved — use the " +
    "per-field reset buttons for those.";
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
  const fields = RESET_FIELDS_PER_KIND[draft.value.type];

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

/** Unified save-to-library entry point.
 *
 * Replaces the five `onXxxSaveToLibraryClick` flows that lived here
 * before — each had its own confirm dialog + per-kind PUT handler and
 * each silently dropped meta because the server route ignored it. The
 * canonical surface is now `PushToLibraryModal.vue`, which owns name/
 * description/tags edits, bundle-propagation toggle, and the explicit
 * fork-vs-update choice.
 *
 * The five kind-specific modals continue to emit `save-to-library`; we
 * just hand the draft to one shared modal instead of branching on type
 * here. */
const pushToLibraryOpen = ref<boolean>(false);

function onSaveToLibraryClick(): void {
  if (!draft.value) return;
  pushToLibraryOpen.value = true;
}

interface PushSaveResult {
  mode: "update" | "fork" | "reattach";
  id: string;
  payload_hash: string;
  bundles_updated: string[];
  name: string;
  origId: string;
}

function onPushToLibrarySaved(result: PushSaveResult): void {
  if (!draft.value) {
    pushToLibraryOpen.value = false;
    return;
  }
  setLibraryHash(result.id, result.payload_hash);
  if (result.mode === "fork" || result.mode === "reattach") {
    // Fork: the new entry replaces the draft's identity; `_originalId`
    // lets saveEditedModule swap the row by old id during the next
    // save(). Reattach: same wiring — the dead uuid gets swapped for
    // the new one so MISSING clears.
    (draft.value as ModuleEntry & { _originalId?: string })._originalId = draft.value.id;
    draft.value.id = result.id;
    draft.value.payload_hash = result.payload_hash;
    draft.value.meta = {
      ...(draft.value.meta ?? {}),
      name: result.name,
      library_name: result.name,
    };
    pushToast(
      result.mode === "reattach"
        ? `Re-attached "${result.name}" to library`
        : `Saved as new library entry "${result.name}"`,
      { severity: "success" },
    );
    save();
  } else {
    // Update path — same uuid, refreshed hash. Stamp library_name too
    // so per-field "reset to library default" stops offering to revert
    // to the pre-save name once it's no longer the library default.
    draft.value.payload_hash = result.payload_hash;
    draft.value.meta = {
      ...(draft.value.meta ?? {}),
      name: result.name,
      library_name: result.name,
    };
    const bundlesNote =
      result.bundles_updated.length > 0
        ? ` · ${result.bundles_updated.length} bundle${result.bundles_updated.length === 1 ? "" : "s"} synced`
        : "";
    pushToast(`Saved to library${bundlesNote}`, { severity: "success" });
  }
  pushToLibraryOpen.value = false;
}

function onPushToLibraryClose(): void {
  pushToLibraryOpen.value = false;
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
      :is-modified="instanceModified"
      :upstream-vars="upstreamVars"
      :sibling-vars="siblingVars"
      :via-option-pairs="viaOptionPairs"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @save-to-library="onSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

    <!-- v2 fixed-values branch — single-pane tailored modal. -->
    <FixedValuesInstanceModal
      v-else-if="draft && draft.type === 'fixed_values'"
      :module="draft"
      :is-modified="instanceModified"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @save-to-library="onSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

    <!-- v2 combine branch — single-pane tailored modal. Library-defining
         edits stay in SPA; modal exposes only runtime + per-instance
         overrides (template_override, locked_seed, hide-from-prompt). -->
    <CombineInstanceModal
      v-else-if="draft && draft.type === 'combine'"
      :module="draft"
      :is-modified="instanceModified"
      :upstream-vars="upstreamVars"
      :upstream-resolved="upstreamResolved"
      :sibling-vars="siblingVars"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @save-to-library="onSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

    <!-- v2 derivation branch — single-pane tailored modal. Library
         (rule conditions / branches / actions) stays in SPA; modal
         exposes only display-name override + per-rule disable
         toggles via instance.disabled_rule_ids. upstream/sibling vars
         feed the rule override fields' `$var` autocomplete; the `@{}`
         nested-ref source is the LIBRARY (fetched inside the modal), so
         sibling/chain MODULES are intentionally NOT forwarded here. -->
    <DerivationInstanceModal
      v-else-if="draft && draft.type === 'derivation'"
      :module="draft"
      :is-modified="instanceModified"
      :upstream-vars="upstreamVars"
      :sibling-vars="siblingVars"
      :via-option-pairs="viaOptionPairs"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @save-to-library="onSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

    <!-- v2 constraint branch — single-pane tailored modal. Library
         (matrix shape, source/target wildcard pair, exception authoring)
         stays in SPA; modal exposes only display-name + per-cell + per-
         exception overrides + extras. NO Runtime section (constraint
         produces no $vars + engine doesn't read locked_seed for it). -->
    <ConstraintInstanceModal
      v-else-if="draft && draft.type === 'constraint'"
      :module="draft"
      :is-modified="instanceModified"
      :sibling-modules="siblingModules"
      :chain-modules="chainModules"
      @update="onUpdate"
      @save="save"
      @cancel="cancel"
      @save-to-library="onSaveToLibraryClick"
      @clear-all-overrides="onClearAllOverrides"
    />

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

  <!-- Unified save-to-library surface. Replaces the five per-kind
       confirm flows that lived in onXxxSaveToLibraryClick — see the
       handlers above for the migration commentary. -->
  <PushToLibraryModal
    :open="pushToLibraryOpen"
    :draft="draft"
    @close="onPushToLibraryClose"
    @saved="onPushToLibrarySaved"
  />
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
/* All styling now lives in the per-kind v2 modal components
 * (WildcardInstanceModal, FixedValuesInstanceModal, etc.). The
 * `.wp-medit` chrome was the v1 tabbed shell — removed alongside
 * the v1 dispatch in the 2026-05-10 cleanup. */
</style>

