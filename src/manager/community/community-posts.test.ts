import { describe, it, expect } from "vitest";
import { fetchCommunityPostDetail, downloadCommunityVersion } from "./community-posts";

function jsonFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
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
});
