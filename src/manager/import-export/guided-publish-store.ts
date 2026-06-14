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
import type { ModuleRow } from "../api/types";
import { unmetDependencyRows, type ReferencingModule } from "./dependencies";
import {
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
 * module whose `listReferencedUuids` resolves to [] → never gated.
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

export const useGuidedPublishStore = defineStore("guidedPublish", () => {
  const open = ref<boolean>(false);
  /** The module the user is trying to publish — held so `publishAnyway`
   *  can forward it after the gate. */
  const pendingModule = ref<PublishablePayload | null>(null);
  /** The in-library, unpublished dependency rows the dialog lists. */
  const unmetRows = ref<ModuleRow[]>([]);

  // Router + catalog captured at request time so the dialog actions can
  // re-enter publishToCommunity with the originating context. Held as plain
  // closure vars (NOT refs) — they aren't UI-reactive, and wrapping a Router
  // in a ref makes Vue recursively unwrap its `currentRoute` ShallowRef,
  // which breaks the Router type on read-back.
  let pendingRouter: Router | null = null;
  let pendingCatalog: ModuleRow[] = [];

  /** Reset all gate state (after publish/cancel). */
  function reset(): void {
    open.value = false;
    pendingModule.value = null;
    unmetRows.value = [];
    pendingRouter = null;
    pendingCatalog = [];
  }

  /**
   * Gate seam. Compute the module's unmet deps; publish directly when there
   * are none, otherwise open the dialog with the pending module + unmet rows.
   */
  function requestPublish(
    pub: PublishablePayload,
    r: Router,
    cat: ModuleRow[],
  ): void {
    const unmet = unmetDependencyRows(toReferencingModule(pub), cat);
    if (unmet.length === 0) {
      publishToCommunity(pub, r, cat);
      return;
    }
    pendingModule.value = pub;
    unmetRows.value = unmet;
    pendingRouter = r;
    pendingCatalog = cat;
    open.value = true;
  }

  /** Publish ONE unmet dependency via the normal flow (navigates → closes). */
  function publishDep(row: ModuleRow): void {
    if (!pendingRouter) return;
    // pendingCatalog also feeds the constraint axis-name backfill.
    publishToCommunity(
      buildModulePublishable(row, pendingCatalog),
      pendingRouter,
      pendingCatalog,
    );
    reset();
  }

  /** Publish the pending module despite the unmet warning (soft nudge). */
  function publishAnyway(): void {
    const pub = pendingModule.value;
    if (!pendingRouter || !pub) return;
    publishToCommunity(pub, pendingRouter, pendingCatalog);
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
