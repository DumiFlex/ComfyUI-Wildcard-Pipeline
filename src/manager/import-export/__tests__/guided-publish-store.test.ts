import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Router } from "vue-router";
import type { BundleRow, ModuleRow } from "../../api/types";
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
const buildBundlePublishable = vi.fn();

vi.mock("../single-row-publish", () => ({
  publishToCommunity: (...args: unknown[]) => publishToCommunity(...args),
  buildModulePublishable: (...args: unknown[]) => buildModulePublishable(...args),
  buildBundlePublishable: (...args: unknown[]) => buildBundlePublishable(...args),
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

/** Bundle-catalog row — `bundleUnmetDependencyRows` reads the same id/name/slug
 *  off a BundleRow. The 4th `requestPublish` arg is typed `BundleRow[]`. */
function bundleCatRow(parts: {
  id: string;
  name: string;
  community_post_slug?: string | null;
}): BundleRow {
  return parts as unknown as BundleRow;
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
    // The 4th arg is the bundle catalog (BR-A2), defaulting to [] for modules.
    expect(publishToCommunity).toHaveBeenCalledWith(modulePub, router, catalog, []);
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

  it("bundles publish directly when their children carry no inner-bundle refs", () => {
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

  it("opens the dialog for a bundle with an UNPUBLISHED inner-bundle child", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // Inner bundles live in the BUNDLE catalog (4th arg), not the module catalog.
    const bundleCatalog = [
      bundleCatRow({ id: "bd001abc", name: "Inner Bundle", community_post_slug: null }),
    ];
    const bundlePub: PublishablePayload = {
      payload: {
        id: "bbbb1111",
        name: "Outer",
        children: [
          { id: "wc001abc", type: "wildcard" },
          { id: "bd001abc", type: "bundle", name: "Inner Bundle" },
        ],
      },
      name: "Outer",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };

    store.requestPublish(bundlePub, router, [], bundleCatalog);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    expect(store.unmetRows.map((r) => r.id)).toEqual(["bd001abc"]);
    expect(store.pendingModule).toEqual(bundlePub);
  });

  it("publishes a bundle directly when its inner-bundle child is PUBLISHED", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const bundleCatalog = [
      bundleCatRow({ id: "bd001abc", name: "Inner Bundle", community_post_slug: "inner-bundle" }),
    ];
    const bundlePub: PublishablePayload = {
      payload: {
        id: "bbbb1111",
        name: "Outer",
        children: [{ id: "bd001abc", type: "bundle", name: "Inner Bundle" }],
      },
      name: "Outer",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };

    store.requestPublish(bundlePub, router, [], bundleCatalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });
});

describe("useGuidedPublishStore dialog actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    publishToCommunity.mockReset();
    buildModulePublishable.mockReset();
    buildBundlePublishable.mockReset();
  });

  it("publishDep builds the dep row's publishable and publishes THAT dep", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // A real module dep row always carries `type` — that's how publishDep tells
    // a module dep (publishable here) from an inner-bundle dep (no `type`).
    const depRow = { id: "aaaa1111", type: "wildcard", name: "Hair", community_post_slug: null } as unknown as ModuleRow;
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

    // The dep's publishable is built WITH the pending catalog too, so a dep
    // that's itself a constraint gets its axis names backfilled on publish.
    expect(buildModulePublishable).toHaveBeenCalledWith(depRow, catalog);
    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    // The 4th arg is the captured bundle catalog (BR-A2); [] for a module dep.
    expect(publishToCommunity).toHaveBeenCalledWith(depPub, router, catalog, []);
    // Navigation closes the dialog.
    expect(store.open).toBe(false);
  });

  it("publishDep navigates to publish an inner-bundle dep (no `type`; BR-A2b)", () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // A bundle catalog row carries populated `children` (the list endpoint
    // returns them, see engine `_row_to_bundle`), so buildBundlePublishable
    // can build it directly from the row — no fetch needed.
    const bundleDepRow = {
      id: "bd001abc",
      name: "Inner Bundle",
      community_post_slug: null,
      children: [{ id: "wc999abc", type: "wildcard", meta: { name: "Hair" } }],
    } as unknown as BundleRow;
    const bundleCatalog = [bundleDepRow];
    const bundlePub: PublishablePayload = {
      payload: {
        id: "bbbb1111",
        name: "Outer",
        children: [{ id: "bd001abc", type: "bundle", name: "Inner Bundle" }],
      },
      name: "Outer",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };
    // The publishable buildBundlePublishable returns for the dep: a payload
    // carrying `children` and NO `type` (the bundle shape).
    const depPub: PublishablePayload = {
      payload: { id: "bd001abc", name: "Inner Bundle", children: bundleDepRow.children },
      name: "Inner Bundle",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };
    buildBundlePublishable.mockReturnValue(depPub);

    store.requestPublish(bundlePub, router, [], bundleCatalog); // opens the dialog
    store.publishDep(bundleDepRow);

    // A bundle dep navigates to publish THAT bundle, exactly like a module dep.
    expect(buildModulePublishable).not.toHaveBeenCalled();
    expect(buildBundlePublishable).toHaveBeenCalledWith(bundleDepRow);
    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    // The bundle catalog (4th arg) is forwarded so a published inner bundle
    // becomes a recorded dep edge in the hash.
    expect(publishToCommunity).toHaveBeenCalledWith(depPub, router, [], bundleCatalog);
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
    // The 4th arg is the captured bundle catalog (BR-A2); [] in the module case.
    expect(publishToCommunity).toHaveBeenCalledWith(modulePub, router, catalog, []);
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
