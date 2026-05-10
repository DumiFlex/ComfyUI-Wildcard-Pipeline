import { describe, it, expect } from "vitest";
import { remapBundleUuids, type ChildSnapshot } from "./uuid-remap";

describe("remapBundleUuids — id regeneration", () => {
  it("regenerates every child id to a fresh 12-char hex", () => {
    const children: ChildSnapshot[] = [
      { id: "aaaa1111", type: "wildcard" },
      { id: "bbbb2222", type: "constraint" },
    ];
    const result = remapBundleUuids(children);
    expect(result.children).toHaveLength(2);
    expect(result.children[0].id).not.toBe("aaaa1111");
    expect(result.children[1].id).not.toBe("bbbb2222");
    expect(result.children[0].id).toMatch(/^[0-9a-f]{12}$/);
    expect(result.children[1].id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("remap table maps every old id to its fresh id", () => {
    const children: ChildSnapshot[] = [
      { id: "aaaa1111", type: "wildcard" },
      { id: "bbbb2222", type: "constraint" },
    ];
    const result = remapBundleUuids(children);
    expect(result.remap.aaaa1111).toBe(result.children[0].id);
    expect(result.remap.bbbb2222).toBe(result.children[1].id);
    expect(Object.keys(result.remap)).toHaveLength(2);
  });

  it("does not mutate input children", () => {
    const children: ChildSnapshot[] = [
      { id: "aaaa1111", type: "wildcard", payload: { var_binding: "x" } },
    ];
    const snapshot = JSON.parse(JSON.stringify(children));
    remapBundleUuids(children);
    expect(children).toEqual(snapshot);
  });
});

describe("remapBundleUuids — @{uuid} text refs", () => {
  it("rewrites @{uuid} in nested payload string values when uuid is in remap", () => {
    const children: ChildSnapshot[] = [
      {
        id: "aaaa1111",
        type: "wildcard",
        payload: { options: [{ value: "see @{bbbb2222} here" }] },
      },
      { id: "bbbb2222", type: "wildcard" },
    ];
    const result = remapBundleUuids(children);
    const newBbbb = result.remap.bbbb2222;
    const opt = (result.children[0].payload as Record<string, unknown>).options as Array<{ value: string }>;
    expect(opt[0].value).toBe(`see @{${newBbbb}} here`);
  });

  it("rewrites multiple @{uuid} refs in the same string", () => {
    const children: ChildSnapshot[] = [
      {
        id: "aaaa1111",
        type: "combine",
        payload: { template: "$a @{bbbb2222} $b @{cccc3333} $c" },
      },
      { id: "bbbb2222", type: "wildcard" },
      { id: "cccc3333", type: "wildcard" },
    ];
    const result = remapBundleUuids(children);
    const tpl = (result.children[0].payload as Record<string, string>).template;
    expect(tpl).toBe(`$a @{${result.remap.bbbb2222}} $b @{${result.remap.cccc3333}} $c`);
  });

  it("leaves @{uuid} refs to non-bundle uuids untouched", () => {
    const children: ChildSnapshot[] = [
      {
        id: "aaaa1111",
        type: "wildcard",
        payload: { options: [{ value: "see @{xxxx9999} here" }] },
      },
    ];
    const result = remapBundleUuids(children);
    const opt = (result.children[0].payload as Record<string, unknown>).options as Array<{ value: string }>;
    expect(opt[0].value).toBe("see @{xxxx9999} here");
  });
});

describe("remapBundleUuids — constraint refs", () => {
  it("rewrites source_wildcard_id + target_wildcard_id when both are in bundle", () => {
    const children: ChildSnapshot[] = [
      { id: "aabbcc11", type: "wildcard" },
      { id: "ddeeff22", type: "wildcard" },
      {
        id: "11223344",
        type: "constraint",
        payload: {
          source_wildcard_id: "aabbcc11",
          target_wildcard_id: "ddeeff22",
          matrix: {},
        },
      },
    ];
    const result = remapBundleUuids(children);
    const con = result.children[2].payload as Record<string, string>;
    expect(con.source_wildcard_id).toBe(result.remap.aabbcc11);
    expect(con.target_wildcard_id).toBe(result.remap.ddeeff22);
  });

  it("leaves source/target unchanged when they reference modules outside the bundle", () => {
    const children: ChildSnapshot[] = [
      {
        id: "11223344",
        type: "constraint",
        payload: {
          source_wildcard_id: "99887766",
          target_wildcard_id: "55443322",
          matrix: {},
        },
      },
    ];
    const result = remapBundleUuids(children);
    const con = result.children[0].payload as Record<string, string>;
    expect(con.source_wildcard_id).toBe("99887766");
    expect(con.target_wildcard_id).toBe("55443322");
  });
});

describe("remapBundleUuids — instance fields", () => {
  it("rewrites uuid-valued instance fields too", () => {
    const children: ChildSnapshot[] = [
      { id: "aabbcc11", type: "wildcard" },
      {
        id: "11223344",
        type: "constraint",
        instance: {
          // Bare-string uuid reference — gets rewritten via remap
          // table lookup (full-string match).
          pinned_source: "aabbcc11",
          // Text containing `@{uuid}` — gets rewritten via the
          // embedded-ref regex pass.
          tooltip: "Pins to @{aabbcc11}",
        },
      },
    ];
    const result = remapBundleUuids(children);
    const inst = result.children[1].instance as Record<string, string>;
    expect(inst.pinned_source).toBe(result.remap.aabbcc11);
    expect(inst.tooltip).toBe(`Pins to @{${result.remap.aabbcc11}}`);
  });
});

describe("remapBundleUuids — edge cases", () => {
  it("handles empty children list", () => {
    const result = remapBundleUuids([]);
    expect(result.children).toEqual([]);
    expect(result.remap).toEqual({});
  });

  it("handles children with no payload or instance", () => {
    const children: ChildSnapshot[] = [
      { id: "aaaa1111", type: "wildcard" },
    ];
    const result = remapBundleUuids(children);
    expect(result.children[0].payload).toBeUndefined();
    expect(result.children[0].instance).toBeUndefined();
    expect(result.children[0].id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("recurses into arrays of arrays of objects", () => {
    const children: ChildSnapshot[] = [
      { id: "abcdef01", type: "x" },
      {
        id: "abcdef02",
        type: "wildcard",
        payload: {
          deeply: [[{ ref: "abcdef01", text: "see @{abcdef01}" }]],
        },
      },
    ];
    const result = remapBundleUuids(children);
    const newId = result.remap.abcdef01;
    const deeply = (result.children[1].payload as Record<string, unknown>).deeply as Array<Array<{ ref: string; text: string }>>;
    expect(deeply[0][0].ref).toBe(newId);
    expect(deeply[0][0].text).toBe(`see @{${newId}}`);
  });
});
