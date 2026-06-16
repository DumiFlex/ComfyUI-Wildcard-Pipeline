import { describe, it, expect } from "vitest";
import { collectTransitiveDeps } from "./transitive-deps";

// fetchDeps stub: a static graph of slug -> dependency slugs.
function graphFetcher(graph: Record<string, string[]>) {
  return async (slug: string): Promise<string[]> => graph[slug] ?? [];
}

describe("collectTransitiveDeps", () => {
  it("walks a linear chain, roots-first, deduped", async () => {
    const { slugs, capped } = await collectTransitiveDeps(
      ["a/root"],
      graphFetcher({ "a/root": ["a/mid"], "a/mid": ["a/leaf"], "a/leaf": [] }),
    );
    expect(capped).toBe(false);
    expect(new Set(slugs)).toEqual(new Set(["a/root", "a/mid", "a/leaf"]));
  });

  it("dedupes a diamond (two paths to one dep)", async () => {
    const { slugs } = await collectTransitiveDeps(
      ["a/top"],
      graphFetcher({ "a/top": ["a/l", "a/r"], "a/l": ["a/base"], "a/r": ["a/base"], "a/base": [] }),
    );
    expect(slugs.filter((s) => s === "a/base")).toHaveLength(1);
    expect(new Set(slugs)).toEqual(new Set(["a/top", "a/l", "a/r", "a/base"]));
  });

  it("is cycle-safe (a->b->a)", async () => {
    const { slugs } = await collectTransitiveDeps(
      ["a/x"],
      graphFetcher({ "a/x": ["a/y"], "a/y": ["a/x"] }),
    );
    expect(new Set(slugs)).toEqual(new Set(["a/x", "a/y"]));
  });

  it("caps at maxPosts and flags capped", async () => {
    const graph: Record<string, string[]> = {};
    for (let i = 0; i < 10; i++) graph[`a/${i}`] = [`a/${i + 1}`];
    const { slugs, capped } = await collectTransitiveDeps(
      ["a/0"],
      graphFetcher(graph),
      { maxPosts: 3 },
    );
    expect(capped).toBe(true);
    expect(slugs).toHaveLength(3);
  });

  it("handles multiple roots", async () => {
    const { slugs } = await collectTransitiveDeps(
      ["a/p", "a/q"],
      graphFetcher({ "a/p": ["a/shared"], "a/q": ["a/shared"], "a/shared": [] }),
    );
    expect(new Set(slugs)).toEqual(new Set(["a/p", "a/q", "a/shared"]));
  });
});
