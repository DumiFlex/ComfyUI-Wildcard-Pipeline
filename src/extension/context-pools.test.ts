import { describe, it, expect } from "vitest";
import { buildContextPools, resolvePoolFor } from "./context-pools";

const wildcard = (id: string, opts: Array<string[]>, name = "") => ({
  id,
  type: "wildcard",
  meta: { name },
  payload: {
    options: opts.map((sub_categories, i) => ({ id: `o${i}`, value: `v${i}`, sub_categories })),
  },
});

describe("buildContextPools", () => {
  it("indexes wildcard modules by uuid with their per-option tags", () => {
    const pools = buildContextPools([wildcard("aaaa1111", [["test"], []], "Pose pool")]);
    expect(pools.get("aaaa1111")).toEqual({
      uuid: "aaaa1111",
      name: "Pose pool",
      tagSets: [["test"], []],
    });
  });

  it("ignores non-wildcard modules — nothing else has an option pool", () => {
    const pools = buildContextPools([
      { id: "bbbb2222", type: "derivation", payload: { rules: [] } },
      { id: "cccc3333", type: "constraint", payload: {} },
    ]);
    expect(pools.size).toBe(0);
  });

  it("KEEPS a disabled module — disabling stops it binding its own $var, it does "
     + "not remove the pool the engine still resolves nested refs against", () => {
    const row = { ...wildcard("aaaa1111", [["test"]]), enabled: false };
    expect(buildContextPools([row]).has("aaaa1111")).toBe(true);
  });

  it("keeps the FIRST entry when a uuid is picked twice, matching the catalog build", () => {
    const pools = buildContextPools([
      wildcard("aaaa1111", [["first"]], "First"),
      wildcard("aaaa1111", [["second"], ["second"]], "Second"),
    ]);
    expect(pools.get("aaaa1111")?.name).toBe("First");
    expect(pools.get("aaaa1111")?.tagSets).toEqual([["first"]]);
  });

  it("tolerates malformed rows rather than throwing on a corrupt widget value", () => {
    const pools = buildContextPools([
      null, "nonsense", {}, { type: "wildcard" }, { id: "x", type: "wildcard" },
    ] as unknown[]);
    expect(pools.get("x")).toEqual({ uuid: "x", name: "", tagSets: [] });
  });
});

describe("resolvePoolFor", () => {
  const libSets = [["test"], [], []];

  it("prefers the context pool — the engine reads the node's frozen snapshot first", () => {
    const pools = buildContextPools([wildcard("aaaa1111", [[], []], "Local")]);
    const got = resolvePoolFor("aaaa1111", pools, libSets);
    expect(got?.source).toBe("context");
    expect(got?.tagSets).toEqual([[], []]);
    expect(got?.name).toBe("Local");
  });

  it("reports the library's total when the two disagree, so the card can explain it", () => {
    const pools = buildContextPools([wildcard("aaaa1111", [[], []])]);
    expect(resolvePoolFor("aaaa1111", pools, libSets)?.otherTotal).toBe(3);
  });

  it("stays quiet when the two agree — the loser is only mentioned to explain a gap", () => {
    const pools = buildContextPools([wildcard("aaaa1111", [["test"], [], []])]);
    expect(resolvePoolFor("aaaa1111", pools, libSets)?.otherTotal).toBeUndefined();
  });

  it("falls back to the library when the uuid is NOT in the node", () => {
    const got = resolvePoolFor("zzzz9999", buildContextPools([]), libSets);
    expect(got?.source).toBe("library");
    expect(got?.tagSets).toEqual(libSets);
  });

  it("uses the library when no Context node is an ancestor at all (SPA)", () => {
    expect(resolvePoolFor("aaaa1111", undefined, libSets)?.source).toBe("library");
  });

  it("returns null when neither pool exists", () => {
    expect(resolvePoolFor("aaaa1111", buildContextPools([]), undefined)).toBeNull();
  });

  it("still reports the context pool when the library row is unknown", () => {
    const pools = buildContextPools([wildcard("aaaa1111", [["test"]])]);
    const got = resolvePoolFor("aaaa1111", pools, undefined);
    expect(got?.source).toBe("context");
    expect(got?.otherTotal).toBeUndefined();
  });
});
