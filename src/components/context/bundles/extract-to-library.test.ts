import { describe, it, expect } from "vitest";
import { extractBundleChildren, type ExtractableChild } from "./extract-to-library";

// Deterministic id minter for tests: a1→n1, etc., in call order.
function seqMinter(): () => string {
  let i = 0;
  return () => `new${++i}`;
}

const wc = (id: string, value: string): ExtractableChild => ({
  id, type: "wildcard", meta: { name: `wc-${id}` },
  payload: { options: [{ id: "o1", value }] },
});

describe("extractBundleChildren", () => {
  it("mints fresh ids and remaps an intra-bundle constraint's source/target", () => {
    const children: ExtractableChild[] = [
      wc("aaaa1111", "plain"),
      wc("bbbb2222", "plain"),
      { id: "cccc3333", type: "constraint", meta: { name: "pair" },
        payload: { source_wildcard_id: "aaaa1111", target_wildcard_id: "bbbb2222", matrix: {}, exceptions: [] } },
    ];
    const { modules, remap, skipped } = extractBundleChildren(children, seqMinter());
    expect(skipped).toBe(0);
    expect(modules).toHaveLength(3);
    expect(remap).toEqual({ aaaa1111: "new1", bbbb2222: "new2", cccc3333: "new3" });
    const con = modules.find((m) => m.type === "constraint")!;
    expect(con.id).toBe("new3");
    expect(con.payload.source_wildcard_id).toBe("new1");
    expect(con.payload.target_wildcard_id).toBe("new2");
    expect(con.name).toBe("pair");
  });

  it("remaps a nested @{} ref pointing at a sibling child", () => {
    const children: ExtractableChild[] = [
      wc("aaaa1111", "plain"),
      wc("bbbb2222", "see @{aaaa1111} here"),
    ];
    const { modules } = extractBundleChildren(children, seqMinter());
    const b = modules.find((m) => m.name === "wc-bbbb2222")!;
    expect(b.payload.options).toEqual([{ id: "o1", value: "see @{new1} here" }]);
  });

  it("leaves refs pointing OUTSIDE the bundle verbatim", () => {
    const children: ExtractableChild[] = [
      { id: "cccc3333", type: "constraint", meta: { name: "pair" },
        payload: { source_wildcard_id: "zzzz9999", target_wildcard_id: "zzzz9999", matrix: {}, exceptions: [] } },
    ];
    const { modules } = extractBundleChildren(children, seqMinter());
    expect(modules[0].payload.source_wildcard_id).toBe("zzzz9999");
  });

  it("skips bundle-typed children (counts them) and extracts only leaf modules", () => {
    const children: ExtractableChild[] = [
      wc("aaaa1111", "plain"),
      { id: "dddd4444", type: "bundle", meta: { name: "nested" }, payload: {} },
    ];
    const { modules, skipped } = extractBundleChildren(children, seqMinter());
    expect(skipped).toBe(1);
    expect(modules).toHaveLength(1);
    expect(modules[0].type).toBe("wildcard");
  });

  it("carries name from meta.name, falling back to the id", () => {
    const children: ExtractableChild[] = [
      { id: "aaaa1111", type: "wildcard", payload: { options: [] } },
    ];
    const { modules } = extractBundleChildren(children, seqMinter());
    expect(modules[0].name).toBe("aaaa1111");
  });
});
