import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";
import { useReturnTo } from "../../composables/useReturnTo";

async function inHarness(query: Record<string, unknown>, fallback: string): Promise<string> {
  let resolved = "";
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/edit", component: { template: "<div />" } },
      { path: "/:p+", component: { template: "<div />" } },
    ],
  });
  await router.push({ path: "/edit", query: query as Record<string, string> });
  await router.isReady();
  const Harness = defineComponent({
    setup() {
      const { resolveReturnTo } = useReturnTo();
      resolved = resolveReturnTo(fallback);
      return () => h("div");
    },
  });
  mount(Harness, { global: { plugins: [router] } });
  return resolved;
}

describe("useReturnTo", () => {
  it("returns fallback when query absent", async () => {
    expect(await inHarness({}, "/wildcards")).toBe("/wildcards");
  });
  it("returns fallback for empty returnTo", async () => {
    expect(await inHarness({ returnTo: "" }, "/wildcards")).toBe("/wildcards");
  });
  it("returns fallback for non-string returnTo (array value)", async () => {
    // Vue Router serializes array values when query param appears multiple times.
    expect(await inHarness({ returnTo: ["/a", "/b"] }, "/wildcards")).toBe("/wildcards");
  });
  it("rejects protocol-relative URLs (//evil.com)", async () => {
    expect(await inHarness({ returnTo: "//evil.com/x" }, "/wildcards")).toBe("/wildcards");
  });
  it("rejects unknown paths", async () => {
    expect(await inHarness({ returnTo: "/unknown" }, "/wildcards")).toBe("/wildcards");
  });
  it("accepts a known list path", async () => {
    expect(await inHarness({ returnTo: "/wildcards" }, "/wildcards")).toBe("/wildcards");
  });
  it("accepts known list path with query string (URL-encoded)", async () => {
    const r = await inHarness({ returnTo: encodeURIComponent("/wildcards?cat=foo") }, "/wildcards");
    expect(r).toBe("/wildcards?cat=foo");
  });
  it("returns fallback for malformed URI", async () => {
    expect(await inHarness({ returnTo: "%%bad" }, "/wildcards")).toBe("/wildcards");
  });
});
