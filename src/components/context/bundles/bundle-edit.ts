import { computed, ref } from "vue";
import { api } from "../../../manager/api/client";
import type { BundleInstance } from "../../../widgets/_shared";
import type { WidgetState } from "../widget-state";

/** Live actions the bundle edit modal's runtime / library buttons reach. */
export interface BundleEditActions {
  toggleBundleLock: (uid: string) => void;
  toggleBundleInternal: (uid: string) => void;
  openPushBundleToLibrary: (uid: string) => void;
  resetBundleToLibrary: (uid: string) => Promise<void>;
}

/**
 * State + handlers behind the canvas's BundleInstanceModal ("Edit
 * bundle…"): a draft of the bundle's identity fields, the library
 * defaults for the per-field reset, and the save / cancel / cascade
 * passthroughs.
 */
export function useBundleEdit(state: WidgetState, actions: BundleEditActions) {
  const { value } = state;
  const { toggleBundleLock, toggleBundleInternal, openPushBundleToLibrary, resetBundleToLibrary } = actions;

  /** Bundle edit modal — analogous to `editingIdx` but keyed on the
   *  per-Context `_uid` of the bundle instance (bundles don't sit in
   *  `value.modules`, they have their own list). `bundleDraft` is the
   *  deep-cloned snapshot the user edits — cancel discards it, save
   *  writes back into `value.bundles[i]`. `bundleLibraryDefaults`
   *  caches the freshly-fetched library entry's name/color so the
   *  IdentitySection can show per-field "reset to library default"
   *  buttons. Null while the fetch is in flight or when the library
   *  entry is missing (deleted upstream). */
  const editingBundleUid = ref<string | null>(null);
  const bundleDraft = ref<BundleInstance | null>(null);
  const bundleLibraryDefaults = ref<{ name: string; color: string | null } | null>(null);

  /** Live BundleInstance the modal is editing — resolved from
   *  `editingBundleUid` against the latest `value.bundles` list so
   *  cascading toggles fired during the modal session reflect into
   *  the master `lockState` / `internalState` props immediately. */
  const editingBundleEntry = computed<BundleInstance | null>(() => {
    const uid = editingBundleUid.value;
    if (!uid) return null;
    return (value.value.bundles ?? []).find((b) => b._uid === uid) ?? null;
  });

  /**
   * Open the BundleInstanceModal for `uid`. Snapshots the live
   * BundleInstance into `bundleDraft` so the user's typing in
   * IdentitySection doesn't commit until Save. Kicks off a one-shot
   * library fetch in parallel so the "reset to library default" per-
   * field buttons can light up once the canonical name/color land.
   *
   * Lock / Hide master toggles deliberately bypass the draft — they
   * cascade onto live children, so buffering them through the modal
   * would diverge from the canvas state. Same handlers
   * `BundleHeader` uses.
   */
  function openBundleEditModal(uid: string): void {
    const target = (value.value.bundles ?? []).find((b) => b._uid === uid);
    if (!target) return;
    editingBundleUid.value = uid;
    bundleDraft.value = JSON.parse(JSON.stringify(target));
    bundleLibraryDefaults.value = null;
    // Fire-and-forget: when the fetch lands, IdentitySection's per-
    // field reset surfaces. Modal stays usable in the interim — user
    // can edit name/color even before the library entry resolves.
    void (async () => {
      try {
        const entry = await api.bundles.get(target.library_id);
        // Modal may have closed mid-fetch; bail if so.
        if (editingBundleUid.value !== uid) return;
        bundleLibraryDefaults.value = {
          name: entry.name,
          color: entry.color ?? null,
        };
      } catch {
        // Library entry deleted / network error — leave defaults null
        // so the per-field reset buttons stay hidden, but the user
        // can still edit name/color directly. No toast: this isn't
        // an error from the user's perspective.
      }
    })();
  }

  function onBundleEditUpdate(patch: Partial<BundleInstance>): void {
    if (!bundleDraft.value) return;
    bundleDraft.value = { ...bundleDraft.value, ...patch };
  }

  function saveBundleEdit(): void {
    const uid = editingBundleUid.value;
    const draft = bundleDraft.value;
    if (!uid || !draft) {
      editingBundleUid.value = null;
      bundleDraft.value = null;
      return;
    }
    const bundles = value.value.bundles ?? [];
    const idx = bundles.findIndex((b) => b._uid === uid);
    if (idx < 0) {
      editingBundleUid.value = null;
      bundleDraft.value = null;
      return;
    }
    // Only identity fields flow through the draft — preserve every
    // other field (range, hash, fingerprint, …) from the live bundle
    // so cascading toggles that fired during the modal session aren't
    // overwritten.
    const live = bundles[idx];
    const next: BundleInstance = {
      ...live,
      name: draft.name,
      color: draft.color ?? null,
    };
    const nextBundles = [...bundles];
    nextBundles[idx] = next;
    value.value = { ...value.value, bundles: nextBundles };
    editingBundleUid.value = null;
    bundleDraft.value = null;
    bundleLibraryDefaults.value = null;
  }

  function cancelBundleEdit(): void {
    editingBundleUid.value = null;
    bundleDraft.value = null;
    bundleLibraryDefaults.value = null;
  }

  /** Wrap the existing ctx-level toggle so the modal's runtime
   *  buttons trigger the same cascade as the BundleHeader / ctxmenu.
   *  Live mutation — no draft involvement. */
  function onBundleEditToggleLock(): void {
    const uid = editingBundleUid.value;
    if (!uid) return;
    toggleBundleLock(uid);
  }

  function onBundleEditToggleInternal(): void {
    const uid = editingBundleUid.value;
    if (!uid) return;
    toggleBundleInternal(uid);
  }

  function onBundleEditSaveToLibrary(): void {
    const uid = editingBundleUid.value;
    if (!uid) return;
    // Commit the draft FIRST so the user's pending name / color edits
    // land on the live BundleInstance, then open the push-to-library
    // modal for explicit Update / Save as new selection.
    saveBundleEdit();
    openPushBundleToLibrary(uid);
  }

  function onBundleEditResetToLibrary(): void {
    const uid = editingBundleUid.value;
    if (!uid) return;
    cancelBundleEdit();
    void resetBundleToLibrary(uid);
  }

  return {
    bundleDraft,
    bundleLibraryDefaults,
    editingBundleEntry,
    openBundleEditModal,
    onBundleEditUpdate,
    saveBundleEdit,
    cancelBundleEdit,
    onBundleEditToggleLock,
    onBundleEditToggleInternal,
    onBundleEditSaveToLibrary,
    onBundleEditResetToLibrary,
  };
}
