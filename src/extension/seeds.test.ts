import { describe, expect, it } from "vitest";
import corpus from "../../tests/fixtures/seeds-corpus.json";
import {
  nextMode,
  withLastSeed,
  withMode,
  frameSeed,
  namedSeed,
  normalizeOuts,
  parseSeedsConfig,
  planOutputs,
  rerollRandom,
  rowSeed,
  seedFromLabel,
  seedFromRow,
  seedProblems,
  seedRows,
  uniqueName,
  withLock,
  formatSeed,
  type SeedRow,
  type SeedsConfig,
} from "./seeds";

const row = (over: Partial<SeedRow> = {}): SeedRow => ({
  id: "00000001", kind: "seed", name: "Direction", mode: "follow", value: 0,
  per_frame: "new", pin: false, out: 0, ...over,
});

describe("seed maths matches the engine", () => {
  it("named seeds", () => {
    for (const c of corpus.named) expect(namedSeed(c.base, c.name)).toBe(c.seed);
  });
  it("frame seeds", () => {
    for (const c of corpus.frames) expect(frameSeed(c.base, c.index)).toBe(c.seed);
  });
});

describe("rowSeed", () => {
  it("frame 0 is the base, locks win, same keeps the base", () => {
    const r = row({ mode: "fixed", value: 1000, locks: { "2": 77 } });
    expect(rowSeed(r, 0, 0)).toBe(1000);
    expect(rowSeed(r, 0, 1)).toBe(frameSeed(1000, 1));
    expect(rowSeed(r, 0, 2)).toBe(77);
    expect(rowSeed(row({ mode: "fixed", value: 5, per_frame: "same" }), 0, 3)).toBe(5);
    expect(rowSeed(row(), 42, 0)).toBe(namedSeed(42, "Direction"));
  });
  it("withLock adds and clears", () => {
    const locked = withLock(row(), 1, 9);
    expect(locked.locks).toEqual({ "1": 9 });
    expect(withLock(locked, 1, null).locks).toBeUndefined();
  });
});

describe("parseSeedsConfig", () => {
  it("never throws and drops junk", () => {
    for (const raw of [null, "", "{", "[]", 5, { rows: "x" }]) expect(parseSeedsConfig(raw).rows).toEqual([]);
    const cfg = parseSeedsConfig({ rows: [
      { id: "a", kind: "label", name: "Contexts" },
      { id: "b", kind: "seed", name: "Act", mode: "nope", value: "12", locks: { "1": 5, x: 3 }, pin: true, out: 2 },
      { id: "b", kind: "weird" },
      "junk",
    ] });
    expect(cfg.rows).toHaveLength(2);
    const act = seedRows(cfg)[0];
    expect(act).toMatchObject({ mode: "follow", value: 12, locks: { "1": 5 }, pin: true, out: 2, per_frame: "new" });
  });
});

describe("outputs", () => {
  const cfg = (rows: SeedRow[]): SeedsConfig => ({ version: 1, rows });
  it("normalizeOuts packs pins into 1..N", () => {
    const n = normalizeOuts(cfg([row({ id: "a", pin: true, out: 5 }), row({ id: "b", pin: true, out: 9 }), row({ id: "c", out: 3 })]));
    expect(seedRows(n).map((r) => r.out)).toEqual([1, 2, 0]);
  });
  it("planOutputs removes and adds", () => {
    const prev = normalizeOuts(cfg([row({ id: "a", pin: true, out: 1 }), row({ id: "b", pin: true, out: 2 })]));
    const next = cfg([row({ id: "a", pin: false, out: 1 }), row({ id: "b", pin: true, out: 2 }), row({ id: "c", pin: true })]);
    const plan = planOutputs(prev, next);
    expect(plan.remove).toEqual([1]);
    expect(plan.add).toBe(1);
    expect(seedRows(plan.config).map((r) => r.out)).toEqual([0, 1, 2]);
  });
});

describe("helpers", () => {
  it("rerolls only random rows", () => {
    const c: SeedsConfig = { version: 1, rows: [row({ id: "a", mode: "random", value: 1 }), row({ id: "b", mode: "fixed", value: 2 })] };
    expect(seedRows(rerollRandom(c, () => 7)).map((r) => r.value)).toEqual([7, 2]);
  });
  it("names, problems, labels", () => {
    const c: SeedsConfig = { version: 1, rows: [row({ id: "a", name: "Seed" }), row({ id: "b", name: " seed " }), row({ id: "c", name: "" })] };
    expect(uniqueName(c)).toBe("Seed 2");
    const p = seedProblems(c);
    expect(p.get("b")).toMatch(/same name/);
    expect(p.get("c")).toMatch(/No name/);
    expect(seedFromLabel("row:Act")).toBe("Seeds › Act");
    expect(seedFromLabel(undefined)).toBe("Auto");
    expect(seedFromRow("loop")).toBeNull();
    expect(formatSeed(731402118)).toBe("731 402 118");
  });

  it("cycles modes and keeps the seed when a row stops following", () => {
    expect([nextMode("follow"), nextMode("random"), nextMode("fixed")]).toEqual(["random", "fixed", "follow"]);
    const r = { id: "a", kind: "seed", name: "Hero", mode: "follow", value: 1, per_frame: "new", pin: false, out: 0 } as const;
    expect(withMode(r, "random", 8)).toMatchObject({ mode: "random", value: namedSeed(8, "Hero") });
    expect(withMode({ ...r, mode: "fixed" }, "follow", 8)).toMatchObject({ mode: "follow", value: 1 });
    expect(withLastSeed(r, 55)).toMatchObject({ mode: "fixed", value: 55 });
  });

  it("keeps base_from_loop only as true", () => {
    expect(parseSeedsConfig({ rows: [], base_from_loop: true }).base_from_loop).toBe(true);
    expect("base_from_loop" in parseSeedsConfig({ rows: [], base_from_loop: false })).toBe(false);
  });
});
