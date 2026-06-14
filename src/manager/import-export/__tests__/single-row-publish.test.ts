import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Router } from "vue-router";
import { publishToCommunity, type PublishablePayload } from "../single-row-publish";
import type { ModuleRow } from "../../api/types";

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
): PublishablePayload {
  const inner: Record<string, unknown> = { matrix: {}, exceptions: [] };
  if (sourceId !== null) inner.source_wildcard_id = sourceId;
  if (targetId !== null) inner.target_wildcard_id = targetId;
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
