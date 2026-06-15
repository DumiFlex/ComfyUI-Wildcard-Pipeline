/**
 * Pinia store — the guided-publish gate (Feature B3).
 *
 * Both publish entry points (CommunityRowActions's per-row Publish + the
 * Export tab's "Publish to community") route through `requestPublish` instead
 * of calling `publishToCommunity` directly. The gate computes the module's
 * UNMET dependency rows (referenced wildcards that are in the library but not
 * yet on the community — `unmetDependencyRows`):
 *   - none unmet  → publish straight through, as before (no dialog).
 *   - some unmet  → stash the pending module + the unmet rows + the caller's
 *                   router/catalog, and flip `open` so the single host
 *                   (AppLayout's UnmetDepsDialog) shows the gating checklist.
 *
 * There is NO persistent queue. Each dialog action is an independent publish:
 *   - `publishDep(row)`  builds that wildcard's publishable + publishes it
 *                        (navigates to the embed — closes the dialog).
 *   - `publishAnyway()`  publishes the pending module despite the unmet warning.
 *   - `cancel()`         closes, no-op.
 * Re-initiating the module publish later re-runs `requestPublish`, which
 * re-computes unmet against the live catalog — a just-published dep (now
 * carrying a slug) drops off, so the user iterates until unmet is empty and
 * the module publishes directly.
 *
 * Holding the router + catalog from the request lets the dialog actions
 * re-enter `publishToCommunity` with the same context the entry point had,
 * without the host re-plumbing them.
 */

import { ref } from "vue";
import { defineStore } from "pinia";
import type { Router } from "vue-router";
import type { BundleRow, ModuleRow } from "../api/types";
import {
  bundleChildExternalUnmetRows,
  bundleUnmetDependencyRows,
  unmetDependencyRows,
  type ReferencingModule,
} from "./dependencies";
import {
  buildBundlePublishable,
  buildModulePublishable,
  publishToCommunity,
  type PublishablePayload,
} from "./single-row-publish";

/**
 * Extract the `{id, type, payload}` `ReferencingModule` the dependency
 * detector reads from a publishable's engine-row payload. Mirrors the
 * extraction in `publishToCommunity` — the engine row carries `id`/`type` at
 * the top level with the type-specific content nested under `payload.payload`.
 * Bundles (no `type`, `children` instead of `payload`) yield a typeless
 * module whose `listReferencedUuids` resolves to [] → never gated as a MODULE;
 * their inner-bundle deps are detected separately via `bundleUnmetDependencyRows`.
 */
function toReferencingModule(pub: PublishablePayload): ReferencingModule {
  const inner = pub.payload as {
    id?: unknown;
    type?: unknown;
    payload?: Record<string, unknown>;
  };
  return {
    id: typeof inner.id === "string" ? inner.id : "",
    type: inner.type as ReferencingModule["type"],
    payload: inner.payload ?? {},
  };
}

/** A publishable's engine-row `children` array iff it's a bundle (no `type`,
 *  `children` instead of `payload.payload`). Empty array for modules. The
 *  inner-bundle refs among these are the bundle's publish dependencies. */
function bundleChildrenOf(pub: PublishablePayload): Array<{ id?: unknown; type?: unknown }> {
  const children = (pub.payload as { children?: unknown }).children;
  return Array.isArray(children) ? (children as Array<{ id?: unknown; type?: unknown }>) : [];
}

export const useGuidedPublishStore = defineStore("guidedPublish", () => {
  const open = ref<boolean>(false);
  /** The module the user is trying to publish — held so `publishAnyway`
   *  can forward it after the gate. */
  const pendingModule = ref<PublishablePayload | null>(null);
  /** The in-library, unpublished dependency rows the dialog lists. A module
   *  publish yields wildcard `ModuleRow`s; a bundle publish yields inner-bundle
   *  `BundleRow`s — the dialog renders either by id/name/(kind icon). */
  const unmetRows = ref<Array<ModuleRow | BundleRow>>([]);

  // Router + catalog captured at request time so the dialog actions can
  // re-enter publishToCommunity with the originating context. Held as plain
  // closure vars (NOT refs) — they aren't UI-reactive, and wrapping a Router
  // in a ref makes Vue recursively unwrap its `currentRoute` ShallowRef,
  // which breaks the Router type on read-back.
  let pendingRouter: Router | null = null;
  let pendingCatalog: ModuleRow[] = [];
  // The bundle catalog captured at request time. Inner-bundle deps resolve
  // against this (not the module catalog), and the re-entry into
  // publishToCommunity forwards it so a published inner bundle becomes a
  // recorded dep edge in the hash.
  let pendingBundleCatalog: BundleRow[] = [];

  /** Reset all gate state (after publish/cancel). */
  function reset(): void {
    open.value = false;
    pendingModule.value = null;
    unmetRows.value = [];
    pendingRouter = null;
    pendingCatalog = [];
    pendingBundleCatalog = [];
  }

  /**
   * Gate seam. Compute the publishable's unmet deps — a MODULE's referenced
   * wildcards against `cat` (the module catalog), OR a BUNDLE's inner-bundle
   * children against `bundleCat` (the bundle catalog). Publish directly when
   * there are none, otherwise open the dialog with the pending publishable +
   * unmet rows. `bundleCat` defaults to `[]` so module-only callers can omit it.
   */
  function requestPublish(
    pub: PublishablePayload,
    r: Router,
    cat: ModuleRow[],
    bundleCat: BundleRow[] = [],
  ): void {
    const children = bundleChildrenOf(pub);
    // A bundle gates on TWO disjoint dep sources: its inner-bundle refs
    // (resolved against the bundle catalog) AND its children's own external
    // module refs — a constraint child's source/target or a wildcard/derivation
    // child's nested `@{}` pointing OUTSIDE the bundle's closure (resolved
    // against the module catalog, `bundleChildExternalUnmetRows`). A module
    // gates on its own wildcard refs. The dialog renders ModuleRow | BundleRow.
    const unmet =
      children.length > 0
        ? [
            ...bundleUnmetDependencyRows(children, bundleCat),
            ...bundleChildExternalUnmetRows(
              children as Array<Record<string, unknown>>,
              bundleCat,
              cat,
            ),
          ]
        : unmetDependencyRows(toReferencingModule(pub), cat);
    if (unmet.length === 0) {
      publishToCommunity(pub, r, cat, bundleCat);
      return;
    }
    pendingModule.value = pub;
    unmetRows.value = unmet;
    pendingRouter = r;
    pendingCatalog = cat;
    pendingBundleCatalog = bundleCat;
    open.value = true;
  }

  /** Publish ONE unmet dependency via the normal flow (navigates → closes).
   *  Both kinds navigate to publish THAT dependency, exactly like the per-row
   *  Publish in `CommunityRowActions` does — the `type` discriminator picks the
   *  builder. A module dep builds via `buildModulePublishable` (with the pending
   *  catalog, so a constraint dep gets its axis names backfilled); an inner-bundle
   *  dep (a `BundleRow`, no `type`) builds via `buildBundlePublishable` (BR-A2b).
   *  A bundle catalog row carries its `children` populated (the list endpoint
   *  returns them — engine `_row_to_bundle`), so the bundle publishable builds
   *  directly from the row, no fetch. */
  function publishDep(row: ModuleRow | BundleRow): void {
    if (!pendingRouter) return;
    // A module row carries a `type`; a BundleRow does not. Build the matching
    // publishable, then publish through the same path. The `as BundleRow` cast
    // mirrors `CommunityRowActions.vue` — `BundleRow` isn't a discriminated
    // union with `ModuleRow` (it has no `type` tag), so the absence-of-`type`
    // check doesn't narrow the union for TS; the cast is the established idiom.
    const isModule = "type" in row && typeof row.type === "string";
    const pub = isModule
      ? // pendingCatalog also feeds the constraint axis-name backfill.
        buildModulePublishable(row as ModuleRow, pendingCatalog)
      : buildBundlePublishable(row as BundleRow);
    publishToCommunity(pub, pendingRouter, pendingCatalog, pendingBundleCatalog);
    reset();
  }

  /** Publish the pending module despite the unmet warning (soft nudge). */
  function publishAnyway(): void {
    const pub = pendingModule.value;
    if (!pendingRouter || !pub) return;
    publishToCommunity(pub, pendingRouter, pendingCatalog, pendingBundleCatalog);
    reset();
  }

  /** Dismiss the gate without publishing. */
  function cancel(): void {
    reset();
  }

  return {
    open,
    pendingModule,
    unmetRows,
    requestPublish,
    publishDep,
    publishAnyway,
    cancel,
  };
});
