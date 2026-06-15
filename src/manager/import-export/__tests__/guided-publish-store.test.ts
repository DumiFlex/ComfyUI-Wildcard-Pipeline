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

/**
 * The gate now VERIFIES each auto-detected "published" dep's slug against the
 * community before treating it as met (a dep whose community post was DELETED
 * still carries a local `community_post_slug`, so without this check it would
 * bypass the gate and dead-end at the publish form). `communityPostExists` is
 * mocked per-test: default true (slug live), overridden to false for the stale
 * case. The default mock returns true so the existing pre-verify tests (which
 * reference only PUBLISHED-and-live or unpublished deps) keep their behavior.
 */
const communityPostExists = vi.fn((..._args: unknown[]): Promise<boolean> => Promise.resolve(true));
vi.mock("../../community/community-posts", () => ({
  communityPostExists: (...args: unknown[]) => communityPostExists(...args),
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
    // Default: every published dep's slug verifies as live. Stale-case tests
    // override this with a per-slug false.
    communityPostExists.mockReset();
    communityPostExists.mockResolvedValue(true);
  });

  it("publishes DIRECTLY (no dialog) when there are no unmet deps", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // Constraint references a PUBLISHED wildcard → no unmet deps. Its slug
    // verifies as live (default mock), so the gate proceeds as before.
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "hair" })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    await store.requestPublish(modulePub, router, catalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    // The 4th arg is the bundle catalog (BR-A2), defaulting to [] for modules.
    expect(publishToCommunity).toHaveBeenCalledWith(modulePub, router, catalog, []);
    expect(store.open).toBe(false);
  });

  it("opens the dialog (no direct publish) when there ARE unmet deps", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // Constraint references an UNPUBLISHED in-library wildcard → unmet.
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    await store.requestPublish(modulePub, router, catalog);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    expect(store.unmetRows.map((r) => r.id)).toEqual(["aaaa1111"]);
    // Pinia proxies state, so assert structural equality (not identity).
    expect(store.pendingModule).toEqual(modulePub);
  });

  it("bundles publish directly when their children carry no inner-bundle refs", async () => {
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

    await store.requestPublish(bundlePub, router, catalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });

  it("opens the dialog for a bundle with an UNPUBLISHED inner-bundle child", async () => {
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

    await store.requestPublish(bundlePub, router, [], bundleCatalog);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    expect(store.unmetRows.map((r) => r.id)).toEqual(["bd001abc"]);
    expect(store.pendingModule).toEqual(bundlePub);
  });

  it("opens the dialog for a bundle whose child constraint has an EXTERNAL unpublished target", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // The external target wildcard lives in the MODULE catalog, unpublished —
    // it's NOT a child of the bundle and NOT inside any inner bundle, so the
    // child constraint's `target_wildcard_id` is an external module dependency.
    const catalog = [catRow({ id: "ext99999", name: "External WC", community_post_slug: null })];
    const bundlePub: PublishablePayload = {
      payload: {
        id: "bbbb1111",
        name: "Outer",
        children: [
          { id: "wc001abc", type: "wildcard", payload: {} },
          {
            id: "cn001abc",
            type: "constraint",
            payload: { source_wildcard_id: "wc001abc", target_wildcard_id: "ext99999" },
          },
        ],
      },
      name: "Outer",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };

    // Module catalog (3rd arg) carries the external ref; no inner bundles.
    await store.requestPublish(bundlePub, router, catalog, []);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    // The external module dep surfaces in the gate (alongside any inner-bundle deps).
    expect(store.unmetRows.map((r) => r.id)).toEqual(["ext99999"]);
  });

  it("does NOT gate a bundle whose child constraint target is a sibling module child", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // The constraint's target is a sibling wildcard child → satisfied (ships) →
    // not an external dep. No inner-bundle deps either → publish straight through.
    const bundlePub: PublishablePayload = {
      payload: {
        id: "bbbb1111",
        name: "Outer",
        children: [
          { id: "wc001abc", type: "wildcard", payload: {} },
          {
            id: "cn001abc",
            type: "constraint",
            payload: { source_wildcard_id: "wc001abc", target_wildcard_id: "wc001abc" },
          },
        ],
      },
      name: "Outer",
      description: "",
      content_rating: "safe",
      tags: [],
      community_post_slug: null,
    };

    await store.requestPublish(bundlePub, router, [], []);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });

  it("publishes a bundle directly when its inner-bundle child is PUBLISHED", async () => {
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

    await store.requestPublish(bundlePub, router, [], bundleCatalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });

  // ---------- Stale "published" dep verification ----------
  //
  // A dep classified "published" purely from its local `community_post_slug`
  // can be a phantom: the community post was DELETED, so the slug no longer
  // resolves. The gate VERIFIES each detected published slug; a missing one
  // (404/410) is RECLASSIFIED as unmet so it shows in the same dialog with a
  // Publish button. A 5xx/network blip does NOT reclassify (transient).

  it("opens the dialog when a module's ONLY 'published' dep slug is now MISSING (deleted post)", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // The wildcard CARRIES a slug locally (looks published), so the pre-verify
    // unmet set is empty — without the verify, the module would publish straight
    // through and dead-end at the publish form.
    const catalog = [
      catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "author/hair" }),
    ];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });
    // The community no longer has that slug (post deleted) → 404 → not exists.
    communityPostExists.mockResolvedValue(false);

    await store.requestPublish(modulePub, router, catalog);

    // The gate did NOT publish directly (it would have, pre-verify) — instead it
    // opened the dialog with the stale dep's LOCAL row so the user can Publish it.
    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    expect(store.unmetRows.map((r) => r.id)).toEqual(["aaaa1111"]);
    // It verified the detected published slug against the community.
    expect(communityPostExists).toHaveBeenCalledWith("author/hair");
  });

  it("publishes directly when the 'published' dep slug still EXISTS (not reclassified)", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [
      catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "author/hair" }),
    ];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });
    // Slug verifies live (default true, set explicit for clarity).
    communityPostExists.mockResolvedValue(true);

    await store.requestPublish(modulePub, router, catalog);

    expect(communityPostExists).toHaveBeenCalledWith("author/hair");
    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });

  it("reclassifies a bundle's stale inner-bundle dep (missing slug) into the dialog", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // Inner bundle looks published locally (carries a slug) but its community
    // post is gone.
    const bundleCatalog = [
      bundleCatRow({ id: "bd001abc", name: "Inner Bundle", community_post_slug: "author/inner" }),
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
    communityPostExists.mockResolvedValue(false);

    await store.requestPublish(bundlePub, router, [], bundleCatalog);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    // The stale inner-bundle row surfaces so the user re-publishes it.
    expect(store.unmetRows.map((r) => r.id)).toEqual(["bd001abc"]);
    expect(communityPostExists).toHaveBeenCalledWith("author/inner");
  });

  it("does NOT reclassify a 'published' dep on a transient verify failure (5xx)", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [
      catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "author/hair" }),
    ];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });
    // communityPostExists returns true on a 5xx/network blip (its own contract),
    // so the gate must NOT reclassify and publishes straight through.
    communityPostExists.mockResolvedValue(true);

    await store.requestPublish(modulePub, router, catalog);

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    expect(store.open).toBe(false);
  });

  it("merges a stale published dep with a genuinely unmet dep (no duplicates)", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    // aaaa1111: published-looking but stale. bbbb2222: plainly unpublished.
    const catalog = [
      catRow({ id: "aaaa1111", name: "Hair", community_post_slug: "author/hair" }),
      catRow({ id: "bbbb2222", name: "Eyes", community_post_slug: null }),
    ];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: "bbbb2222" },
    });
    communityPostExists.mockResolvedValue(false); // author/hair is gone

    await store.requestPublish(modulePub, router, catalog);

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(true);
    // Both rows show; the base-unmet bbbb2222 first, then the reclassified stale
    // aaaa1111 — deduped by id (no row appears twice).
    expect([...store.unmetRows.map((r) => r.id)].sort()).toEqual(["aaaa1111", "bbbb2222"]);
  });
});

describe("useGuidedPublishStore dialog actions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    publishToCommunity.mockReset();
    buildModulePublishable.mockReset();
    buildBundlePublishable.mockReset();
    communityPostExists.mockReset();
    communityPostExists.mockResolvedValue(true);
  });

  it("publishDep builds the dep row's publishable and publishes THAT dep", async () => {
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

    await store.requestPublish(modulePub, router, catalog); // opens the dialog
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

  it("publishDep navigates to publish an inner-bundle dep (no `type`; BR-A2b)", async () => {
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

    await store.requestPublish(bundlePub, router, [], bundleCatalog); // opens the dialog
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

  it("publishAnyway publishes the pending MODULE (not a dep)", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    await store.requestPublish(modulePub, router, catalog);
    store.publishAnyway();

    expect(publishToCommunity).toHaveBeenCalledTimes(1);
    // The 4th arg is the captured bundle catalog (BR-A2); [] in the module case.
    expect(publishToCommunity).toHaveBeenCalledWith(modulePub, router, catalog, []);
    expect(store.open).toBe(false);
  });

  it("cancel closes the dialog without publishing", async () => {
    const store = useGuidedPublishStore();
    const router = routerStub();
    const catalog = [catRow({ id: "aaaa1111", name: "Hair", community_post_slug: null })];
    const modulePub = pub({
      id: "cccc1111",
      type: "constraint",
      payload: { source_wildcard_id: "aaaa1111" },
    });

    await store.requestPublish(modulePub, router, catalog);
    store.cancel();

    expect(publishToCommunity).not.toHaveBeenCalled();
    expect(store.open).toBe(false);
  });
});
