import { describe, it, expect } from "vitest";
import {
  communityPostExists,
  fetchCommunityPostDetail,
  downloadCommunityVersion,
} from "./community-posts";

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

/** A fetch stub that reports a specific HTTP status (with `ok` derived). */
function statusFetch(status: number): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

describe("community-posts", () => {
  it("fetchCommunityPostDetail returns dependency edges (slug + module_id)", async () => {
    const detail = await fetchCommunityPostDetail("author/pair", jsonFetch({
      data: { slug: "author/pair", latest_version_number: 2,
        dependencies: [{ slug: "author/subject", module_id: "aabb0001", name: "Subject" }] },
    }));
    expect(detail.dependencies).toEqual([{ slug: "author/subject", module_id: "aabb0001", name: "Subject" }]);
    expect(detail.latest_version_number).toBe(2);
  });

  it("downloadCommunityVersion returns the payload envelope", async () => {
    const dl = await downloadCommunityVersion("author/subject", jsonFetch({
      data: { payload_json: { id: "aabb0001", type: "wildcard", name: "Subject", payload: {} }, version_number: 1 },
    }));
    expect(dl.payload).toEqual({ id: "aabb0001", type: "wildcard", name: "Subject", payload: {} });
    expect(dl.version_number).toBe(1);
  });

  it("throws on a non-ok response", async () => {
    await expect(fetchCommunityPostDetail("nope", jsonFetch({}, false))).rejects.toThrow();
  });

  it("fetchCommunityPostDetail's thrown error carries the numeric HTTP status", async () => {
    await expect(
      fetchCommunityPostDetail("gone", statusFetch(410)),
    ).rejects.toMatchObject({ status: 410 });
  });
});

describe("communityPostExists", () => {
  it("returns true for a 200 (post exists)", async () => {
    expect(await communityPostExists("author/pair", statusFetch(200))).toBe(true);
  });

  it("returns false for a 404 (definitely not found)", async () => {
    expect(await communityPostExists("author/pair", statusFetch(404))).toBe(false);
  });

  it("returns false for a 410 (gone — definitely not found)", async () => {
    expect(await communityPostExists("author/pair", statusFetch(410))).toBe(false);
  });

  it("returns true for a 500 (transient — DON'T reclassify a real dep on a server blip)", async () => {
    expect(await communityPostExists("author/pair", statusFetch(500))).toBe(true);
  });

  it("returns true on a network error (thrown fetch, no status — transient)", async () => {
    const throwingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await communityPostExists("author/pair", throwingFetch)).toBe(true);
  });
});
