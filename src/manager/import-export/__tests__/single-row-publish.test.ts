import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import { publishToCommunity, type PublishablePayload } from "../single-row-publish";
import type { BundleRow, ModuleRow } from "../../api/types";

/**
 * B2b — `publishToCommunity` auto-detects the published module's dependency
 * wildcards (via `listReferencedUuids` + `resolveDependencies`) and injects
 * two extra hash params the embed hydrates from:
 *   - `dependencies` = base64(JSON [{slug, optional:false}]) — published deps.
 *   - `unmet_deps`   = base64(JSON [name]) — unpublished refs to warn about.
 * Both only when non-empty. These tests pin the EXACT param names + encoding.
 */

/** Decode a base64 hash-param value back to text. Mirror of the encoder
 *  (`textToB64` in single-row-publish.ts) + the community `b64ToText`. */
function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Read one param out of the current `window.location.hash`. */
function hashParam(name: string): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get(name);
}

/** Read a base64 hash param + JSON-decode it. Throws (failing the test) if
 *  the param is absent, so callers don't need a non-null assertion. */
function decodeHashParam(name: string): unknown {
  const raw = hashParam(name);
  if (raw === null) throw new Error(`hash param ${name} is absent`);
  return JSON.parse(b64ToText(raw));
}

/** A `Router` stub whose `.push()` resolves so the `.then(...)` that sets
 *  the hash runs. Only `push` is exercised by `publishToCommunity`. */
function routerStub(): Router {
  return { push: vi.fn().mockResolvedValue(undefined) } as unknown as Router;
}

/** Minimal catalog row — `resolveDependencies` reads only id/name/slug. */
function catalogRow(parts: { id: string; name: string; community_post_slug?: string | null }): ModuleRow {
  return parts as unknown as ModuleRow;
}

/**
 * A valid engine-row constraint payload (passes strict v2 validation inside
 * `buildPublishBody`) referencing `source`/`target` wildcard ids. Mirrors
 * the `constraintRow` fixture in publish-stamping.test.ts. Null ids are
 * OMITTED (the v2 validator types them `z.string().optional()` — `null` is
 * rejected, absence is fine) → the "references nothing" case.
 */
function constraintPub(
  sourceId: string | null,
  targetId: string | null,
  targetSelect?: Record<string, unknown>,
): PublishablePayload {
  const inner: Record<string, unknown> = { matrix: {}, exceptions: [] };
  if (sourceId !== null) inner.source_wildcard_id = sourceId;
  if (targetId !== null) inner.target_wildcard_id = targetId;
  if (targetSelect !== undefined) inner.target_select = targetSelect;
  const payload: Record<string, unknown> = {
    id: "cn-001abc",
    type: "constraint",
    name: "mood-constraint",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: inner,
  };
  return {
    payload,
    name: "mood-constraint",
    description: "",
    content_rating: "safe",
    tags: [],
    community_post_slug: null,
  };
}

describe("publishToCommunity — dependency hash injection", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("injects dependencies + unmet_deps for a constraint with a published source and an unpublished target", async () => {
    const catalog = [
      catalogRow({ id: "wc-aaa", name: "Source WC", community_post_slug: "source-wc" }),
      catalogRow({ id: "wc-bbb", name: "Target WC", community_post_slug: null }),
    ];
    publishToCommunity(constraintPub("wc-aaa", "wc-bbb"), routerStub(), catalog);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("dependencies")).not.toBeNull();
    expect(hashParam("unmet_deps")).not.toBeNull();
    expect(decodeHashParam("dependencies")).toEqual([{ slug: "source-wc", optional: false }]);
    expect(decodeHashParam("unmet_deps")).toEqual(["Target WC"]);
  });

  it("omits both params when the module references nothing", async () => {
    const catalog = [catalogRow({ id: "wc-aaa", name: "Source WC", community_post_slug: "source-wc" })];
    publishToCommunity(constraintPub(null, null), routerStub(), catalog);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("dependencies")).toBeNull();
    expect(hashParam("unmet_deps")).toBeNull();
    // The pre-existing params are still present (unchanged behavior).
    expect(hashParam("payload")).not.toBeNull();
    expect(hashParam("name")).toBe("mood-constraint");
  });

  it("emits only unmet_deps when every ref is unpublished", async () => {
    const catalog = [
      catalogRow({ id: "wc-aaa", name: "Source WC", community_post_slug: null }),
      catalogRow({ id: "wc-bbb", name: "Target WC", community_post_slug: null }),
    ];
    publishToCommunity(constraintPub("wc-aaa", "wc-bbb"), routerStub(), catalog);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("dependencies")).toBeNull();
    expect(decodeHashParam("unmet_deps")).toEqual(["Source WC", "Target WC"]);
  });
});

/**
 * BR-A2 — a bundle's INNER-BUNDLE children are dependencies too. They resolve
 * against the BUNDLE catalog (4th arg), mirroring how a constraint's wildcard
 * refs resolve against the module catalog: a published inner bundle → a
 * recorded `dependencies` edge; an unpublished one → an `unmet_deps` warning.
 */
/** Bundle-catalog row — `bundleChildBundleRefs` + `resolveDependencies` read
 *  id/name/slug off a BundleRow. The 4th `publishToCommunity` arg is `BundleRow[]`. */
function bundleCatalogRow(parts: { id: string; name: string; community_post_slug?: string | null }): BundleRow {
  return parts as unknown as BundleRow;
}

function bundlePub(innerBundleIds: string[]): PublishablePayload {
  const payload: Record<string, unknown> = {
    id: "bd-outer1",
    name: "outer-bundle",
    description: "",
    color: null,
    category_id: null,
    tags: [],
    is_favorite: false,
    children: [
      // A leaf widget child (NOT a dependency) + the inner-bundle refs.
      { id: "wc-leaf1", type: "wildcard", meta: { name: "leaf" }, payload: {} },
      ...innerBundleIds.map((id) => ({ id, type: "bundle", name: id, color: null })),
    ],
  };
  return {
    payload,
    name: "outer-bundle",
    description: "",
    content_rating: "safe",
    tags: [],
    community_post_slug: null,
  };
}

describe("publishToCommunity — inner-bundle dependency hash injection (BR-A2)", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("records a published inner bundle as a dependency edge", async () => {
    const bundleCatalog = [
      bundleCatalogRow({ id: "bd-inner1", name: "Inner Bundle", community_post_slug: "inner-bundle" }),
    ];
    // 3rd arg (module catalog) empty — inner-bundle refs use the 4th arg.
    publishToCommunity(bundlePub(["bd-inner1"]), routerStub(), [], bundleCatalog);
    await Promise.resolve();
    await Promise.resolve();

    expect(decodeHashParam("dependencies")).toEqual([{ slug: "inner-bundle", optional: false }]);
    expect(hashParam("unmet_deps")).toBeNull();
  });

  it("warns about an unpublished inner bundle via unmet_deps", async () => {
    const bundleCatalog = [
      bundleCatalogRow({ id: "bd-inner1", name: "Inner Bundle", community_post_slug: null }),
    ];
    publishToCommunity(bundlePub(["bd-inner1"]), routerStub(), [], bundleCatalog);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("dependencies")).toBeNull();
    expect(decodeHashParam("unmet_deps")).toEqual(["Inner Bundle"]);
  });

  it("omits both params for a bundle with no inner-bundle children", async () => {
    publishToCommunity(bundlePub([]), routerStub(), [], []);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("dependencies")).toBeNull();
    expect(hashParam("unmet_deps")).toBeNull();
    expect(hashParam("payload")).not.toBeNull();
  });
});

/**
 * The embed forwards the content-derived `schema_version` into the publish
 * POST so the server stamps the real version instead of grace-defaulting to 1
 * (which rejects a v2+ payload). `schemaVersionForPayload` resolves to 2 for a
 * plain CURRENT payload (no range text, default reach) and 4 when a constraint
 * carries a non-default `target_select` reach selector. These pin that the
 * built hash carries the stamp as a plain string.
 */
describe("publishToCommunity — schema_version hash stamp", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("stamps schema_version 2 for a plain CURRENT publishable", async () => {
    publishToCommunity(constraintPub("wc-aaa", "wc-bbb"), routerStub(), []);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("schema_version")).toBe("2");
  });

  it("stamps schema_version 4 for a constraint with a non-default target_select reach", async () => {
    const reach = { mode: "pick", picks: ["target-a"] };
    publishToCommunity(constraintPub("wc-aaa", "wc-bbb", reach), routerStub(), []);
    await Promise.resolve();
    await Promise.resolve();

    expect(hashParam("schema_version")).toBe("4");
  });
});
