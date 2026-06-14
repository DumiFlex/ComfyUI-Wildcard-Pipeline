import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Router } from "vue-router";
import type { ModuleRow } from "../../api/types";
import type { PublishablePayload } from "../single-row-publish";

/**
 * B3 — guided-publish gate seam. The store wraps the publish entry so a
 * module with UNMET dependency wildcards (in-library, unpublished) opens the
 * UnmetDepsDialog instead of navigating straight to the embed; a module with
 * no unmet deps publishes directly as today. Both publish entry points
 * (CommunityRowActions, ExportTab) route through `requestPublish`.
 *
 * `publishToCommunity` + `buildModulePublishable` are mocked — we assert the
 * gate's BRANCHING + which payload each dialog action forwards, not the
 * navigation itself (covered by single-row-publish.test.ts).
 */
const publishToCommunity = vi.fn();
const buildModulePublishable = vi.fn();

vi.mock("../single-row-publish", () => ({
  publishToCommunity: (...args: unknown[]) => publishToCommunity(...args),
  buildModulePublishable: (...args: unknown[]) => buildModulePublishable(...args),
}));

import { useGuidedPublishStore } from "../guided-publish-store";

/** Router stub — only identity matters; the gate forwards it verbatim. */
function routerStub(): Router {
  return { push: vi.fn() } as unknown as Router;
}

/** A publishable whose engine-row `payload` carries the `{id, type, payload}`
 *  shape the gate extracts to detect references. */
function pub(
  inner: { id: string; type: string; payload?: Record<string, unknown> },
  name = "Module",
): PublishablePayload {
  return {
    payload: { id: inner.id, type: inner.type, payload: inner.payload ?? {} },
    name,
    description: "",
    content_rating: "safe",
    tags: [],
    community_post_slug: null,
  };
}

/** Catalog row carrying id/name/slug — what `unmetDependencyRows` reads. */
function catRow(parts: {
  id: string;
  name: string;
  community_post_slug?: string | null;
}): ModuleRow {
  return parts as unknown as ModuleRow;
}

describe("useGuidedPublishStore.requestPublish (gate seam)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    publishToCommunity.mockReset();
    buildModulePublishable.mockReset();
  });

  it("publishes DIRECTLY (no dialog) when there are no unmet deps", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // Constraint references a PUBLISHED wildcard → no unmet deps.
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "hair" })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    store.requestPublish(modulePub, router, catalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(publishToCommunity).toHaveBeenCalledWith(modulePub, router, catalog);
    expect(store.open).toBe(false);
  });

  it("opens the dialog (no direct publish) when there ARE unmet deps", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // Constraint references an UNPUBLISHED in-library wildcard → unmet.
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    store.requestPublish(modulePub, router, catalog);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    expect(store.unmetRows.map((r) => r.id)).toEqual(["aaaa1111"]);
    // Pinia proxies state, so assert structural equality (not identity).
    expect(store.pendingModule).toEqual(modulePub);
  });

  it("bundles publish directly (no refs, never gated)", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const bundlePub: PublishablePayload = {
      payload: { id: "bbbb1111", name: "Bundle", children: [{ id: "aaaa1111", type: "wildcard" }] },
      name: "Bundle",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };

    store.requestPublish(bundlePub, router, catalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });
});

describe("useGuidedPublishStore dialog actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    publishToCommunity.mockReset();
    buildModulePublishable.mockReset();
  });

  it("publishDep builds the dep row's publishable and publishes THAT dep", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const depRow = catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null });
    const catalog = [depRow];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });
    const depPub = pub({ id: "aaaa1111", type: "wildcard" }, "Hair");
    buildModulePublishable.mockReturnValue(depPub);

    store.requestPublish(modulePub, router, catalog); // opens the dialog
    store.publishDep(depRow);

    expect(buildModulePublishable).toHaveBeenCalledWith(depRow);
    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(publishToCommunity).toHaveBeenCalledWith(depPub, router, catalog);
    // Navigation closes the dialog.
    expect(store.open).toBe(false);
  });

  it("publishAnyway publishes the pending MODULE (not a dep)", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    store.requestPublish(modulePub, router, catalog);
    store.publishAnyway();

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(publishToCommunity).toHaveBeenCalledWith(modulePub, router, catalog);
    expect(store.open).toBe(false);
  });

  it("cancel closes the dialog without publishing", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    store.requestPublish(modulePub, router, catalog);
    store.cancel();

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(false);
  });
});
