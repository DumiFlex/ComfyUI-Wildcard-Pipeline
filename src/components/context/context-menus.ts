import { ref } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";
import type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuItem,
} from "../../kit/ContextMenu.vue";
import { kindIcon } from "../shared/kind-icons";
import { KIND_TITLE } from "./editors/_shell";
import { currentFrame } from "../context-loop/frame-cursor";
import { bundleSnapshotModified } from "./bundles/bundle-fingerprint";
import { isHeld, isHoldable, isModified, kindChipModifier } from "./module-state";
import {
  isBundleLibraryDrifted,
  isBundleMissingFromLibrary,
  isDrifted,
  isMissingFromLibrary,
} from "./library-status";
import type { WidgetState } from "./widget-state";

/** What the two right-click menus call. The widget passes its op
 *  factories' results straight through (extra members are ignored). */
export interface ContextMenuActions {
  openEditModal(idx: number): void;
  toggleHold(idx: number): void;
  refreshOne(idx: number): Promise<void>;
  openPushToLibrary(idx: number): void;
  resetChildToBundleSnapshot(idx: number): Promise<void>;
  toggleEnabled(idx: number): void;
  toggleCollapsed(idx: number): void;
  duplicateModule(idx: number): void;
  wrapIntoNewBundle(idx: number): Promise<void>;
  moveToEdge(idx: number, edge: "top" | "bottom"): void;
  removeModule(idx: number): void;
  openBundleEditModal(uid: string): void;
  toggleBundleCollapsed(uid: string): void;
  toggleBundleEnabled(uid: string, enabled: boolean): void;
  resetBundleToLibrary(uid: string): Promise<void>;
  openPushBundleToLibrary(uid: string): void;
  duplicateBundle(uid: string): Promise<void>;
  detachBundle(uid: string): void;
  removeBundle(uid: string): void;
}

/**
 * The canvas's right-click menus — one for a module row, one for a bundle
 * frame. Each builds its item list from the row/bundle's current state
 * (hold, drift, missing, modified, bundle membership) and opens the shared
 * `ContextMenu` through the `ctxMenu` state, clamped to the viewport.
 */
export function useContextMenus(state: WidgetState, actions: ContextMenuActions) {
  const { value } = state;
  const {
    openEditModal, toggleHold, refreshOne, openPushToLibrary,
    resetChildToBundleSnapshot, toggleEnabled, toggleCollapsed, duplicateModule,
    wrapIntoNewBundle, moveToEdge, removeModule,
    openBundleEditModal, toggleBundleCollapsed, toggleBundleEnabled,
    resetBundleToLibrary, openPushBundleToLibrary, duplicateBundle,
    detachBundle, removeBundle,
  } = actions;

  const ctxMenu = ref<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuEntry[];
    header?: ContextMenuHeader;
  }>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
  });

  /** Bundle right-click menu. Mirrors module ctxmenu pattern — sets
   *  ctxMenu state with bundle-scoped items. The shared ContextMenu
   *  component handles positioning + dismiss. */
  function openBundleContextMenu(ev: MouseEvent, uid: string): void {
    const target = (value.value.bundles ?? []).find((b) => b._uid === uid);
    if (!target) return;
    const estW = 240;
    const estH = 220;
    const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
    const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
    const items: ContextMenuEntry[] = [
      {
        label: "Edit bundle…",
        icon: "pi-pencil",
        subtitle: "Display name, color, lock + hide cascades",
        onSelect: () => openBundleEditModal(uid),
        divider: true,
      },
      {
        label: target.collapsed ? "Expand bundle" : "Collapse bundle",
        icon: target.collapsed ? "pi-caret-down" : "pi-caret-right",
        onSelect: () => toggleBundleCollapsed(uid),
      },
      {
        label: target.enabled ? "Disable bundle" : "Enable bundle",
        icon: target.enabled ? "pi-eye-slash" : "pi-eye",
        subtitle: "Cascades to all children",
        onSelect: () => toggleBundleEnabled(uid, !target.enabled),
        divider: true,
      },
      // The two library actions accent themselves to match the bundle's CURRENT
      // state, so the menu points at the recovery for the badge the user just
      // saw. Only one lights up: the states are ranked, since a bundle can be
      // several at once and two competing accents would say nothing.
      //   missing  → Push (re-link or add) — nothing to reset FROM
      //   drifted  → Reset (pull the library's newer version)
      //   modified → Push (save your local edits up)
      (() => {
        const drifted = !isBundleMissingFromLibrary(target)
          && isBundleLibraryDrifted(target);
        return {
          label: "Reset to library snapshot",
          icon: "pi-refresh",
          subtitle: drifted
            ? "Library changed since insert — pull the newer version"
            : "Replace children with frozen library state",
          accent: drifted,
          onSelect: () => { void resetBundleToLibrary(uid); },
        };
      })(),
      (() => {
        const bundleMissing = isBundleMissingFromLibrary(target);
        const modified = !bundleMissing
          && !isBundleLibraryDrifted(target)
          && bundleSnapshotModified(target, value.value.modules);
        let subtitle = "Rename, retag, overwrite library entry";
        if (bundleMissing) subtitle = "Not linked to a library entry — re-link or add";
        else if (modified) subtitle = "Local edits since insert — save them to the library";
        return {
          label: "Push to library…",
          icon: "pi-cloud-upload",
          subtitle,
          accent: bundleMissing || modified,
          onSelect: () => openPushBundleToLibrary(uid),
          divider: true,
        };
      })(),
      {
        label: "Duplicate bundle",
        icon: "pi-clone",
        subtitle: "Insert another instance below",
        onSelect: () => { void duplicateBundle(uid); },
      },
      {
        label: "Detach",
        icon: "pi-link",
        subtitle: "Frame removed, children stay",
        onSelect: () => detachBundle(uid),
        divider: true,
      },
      {
        label: "Remove bundle + children",
        icon: "pi-trash",
        danger: true,
        onSelect: () => removeBundle(uid),
      },
    ];
    ctxMenu.value = {
      visible: true,
      x: Math.max(8, x),
      y: Math.max(8, y),
      items,
      header: {
        icon: "pi-box",
        label: `Bundle · ${target.name ?? "bundle"}`,
        iconColor: target.color || undefined,
      },
    };
  }

  function openContextMenu(ev: MouseEvent, m: ModuleEntry, idx: number) {
    // Phase B: caller passes the row's array index (from v-for) so we
    // operate on the specific sibling rather than the first findIndex
    // match — siblings share `m.id`.
    const list = value.value.modules;
    const i = idx;
    const estW = 180;
    const estH = 220;
    const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
    const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
    // Build the items list dynamically — "Save to library" only shows
    // when the module is missing from the live library AND has a
    // payload to save (inline-created fixed_values without a payload
    // are intentionally excluded; they're already authoritative on the
    // workflow side).
    const items: ContextMenuItem[] = [
      { label: "Edit", icon: "pi-pencil", onSelect: () => openEditModal(idx) },
    ];
    // Quick Hold toggle — kept at the top so it's a 2-click reach
    // (right-click → Hold) instead of opening the editor and digging into
    // Runtime. Only for kinds that honor seed_scope. Hold is base-level;
    // when a loop edit-frame is active it applies to every frame, so we
    // surface it disabled with a hint rather than silently writing it.
    if (isHoldable(m)) {
      const held = isHeld(m);
      const frameActive = currentFrame.value != null;
      items.push({
        label: held ? "Release hold" : "Hold across run",
        icon: "pi-link",
        disabled: frameActive,
        subtitle: frameActive
          ? "Applies to every frame — switch to base to change"
          : held
            ? undefined
            : "Freeze this value for the whole batch",
        onSelect: () => toggleHold(idx),
      });
    }
    // Refresh + Save are mutually exclusive in normal use (a module is
    // either drifted OR missing OR clean), so hiding the inactive entry
    // beats greying it — matches Save's existing conditional-push pattern
    // and keeps the menu shorter.
    if (isDrifted(m)) {
      items.push({
        label: "Refresh from library",
        icon: "pi-refresh",
        // Accented + explained: drift is the state where the menu HAS the fix
        // for the badge the user just saw, so it should say so.
        subtitle: "Library changed since insert — pull the newer version",
        accent: true,
        onSelect: () => { void refreshOne(idx); },
        divider: true,
      });
    }
    // "Push to library" is now always present for any row that has a
    // payload. The unified PushToLibraryModal owns the explicit fork-vs-
    // update choice + the meta editing surface, replacing the older
    // implicit logic that only surfaced when the row was missing from
    // the live library. Inline-created rows still qualify — the modal
    // greys out the "Update existing" button when payload_hash is empty.
    if (!!m.payload) {
      const missing = isMissingFromLibrary(m);
      // Local overrides with no drift → pushing is what the user probably wants.
      // Ranked below `missing` so only one library action ever accents.
      const modified = !missing && !isDrifted(m) && isModified(m);
      let subtitle: string | undefined;
      if (missing) subtitle = "Not linked to a library entry — re-link or add";
      else if (modified) subtitle = "Local edits since insert — save them to the library";
      items.push({
        label: "Push to library…",
        icon: "pi-cloud-upload",
        subtitle,
        accent: missing || modified,
        onSelect: () => openPushToLibrary(idx),
        divider: true,
      });
    }
    // Bundle children get an extra "Reset to bundle snapshot" item that
    // restores THIS row from the parent bundle's frozen library blob.
    // Distinct from "Refresh from library" (which pulls the current
    // library version of the underlying module).
    if ((m as ModuleEntry & { bundle_origin?: string }).bundle_origin) {
      items.push({
        label: "Reset to bundle snapshot",
        icon: "pi-history",
        subtitle: "Restore frozen state from bundle",
        onSelect: () => { void resetChildToBundleSnapshot(idx); },
        divider: true,
      });
    }
    items.push(
      { label: m.enabled ? "Disable" : "Enable", icon: m.enabled ? "pi-eye-slash" : "pi-eye", onSelect: () => toggleEnabled(idx) },
      { label: m.collapsed ? "Expand" : "Collapse", icon: m.collapsed ? "pi-caret-down" : "pi-caret-right", onSelect: () => toggleCollapsed(idx) },
      { label: "Duplicate", icon: "pi-clone", onSelect: () => duplicateModule(idx), divider: true },
    );
    // Wrap-into-new-bundle — only for unbundled rows.
    if (!(m as ModuleEntry & { bundle_origin?: string }).bundle_origin) {
      items.push({
        label: "Wrap into new bundle…",
        icon: "pi-box",
        subtitle: "Create a library bundle from this row",
        onSelect: () => { void wrapIntoNewBundle(idx); },
        divider: true,
      });
    }
    items.push(
      { label: "Move to top", icon: "pi-angle-double-up", disabled: i === 0, onSelect: () => moveToEdge(idx, "top") },
      { label: "Move to bottom", icon: "pi-angle-double-down", disabled: i === list.length - 1, onSelect: () => moveToEdge(idx, "bottom") },
      { label: "Remove", icon: "pi-trash", danger: true, divider: true, onSelect: () => removeModule(idx) },
    );
    ctxMenu.value = {
      visible: true, x: Math.max(8, x), y: Math.max(8, y), items,
      // Scope header — kind icon + "Kind · Name" label. Mirrors the
      // bundle ctxmenu's header so every right-click reads as "you are
      // operating on THIS specific entity". `kindIcon` returns
      // "pi pi-X" (two-class); ContextMenu's template prepends "pi"
      // already, so we strip the leading word to avoid double-prefix.
      header: {
        icon: kindIcon(m.type).split(" ").pop() ?? "pi-circle",
        label: `${KIND_TITLE[m.type] ?? m.type} · ${m.meta.name || "(unnamed)"}`,
        iconColor: `var(--wp-kind-${kindChipModifier(m.type)})`,
      },
    };
  }

  return { ctxMenu, openContextMenu, openBundleContextMenu };
}
