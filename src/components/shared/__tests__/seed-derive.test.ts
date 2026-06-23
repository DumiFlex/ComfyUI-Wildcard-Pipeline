import { describe, it, expect } from "vitest";
import corpus from "../../../../tests/fixtures/seed-derive-corpus.json";
import { deriveLoopSeeds, applySeedLocks, parseSeedLocks } from "../seed-derive";

describe("seed-derive (Py≡TS parity)", () => {
  it("matches the engine corpus for every (base, count, strategy)", () => {
    for (const c of corpus.derive) {
      expect(deriveLoopSeeds(c.base, c.count, c.strategy as never)).toEqual(c.derived);
    }
  });
  it("applySeedLocks matches the engine", () => {
    const a = corpus.applyLocks;
    const locks: Record<number, number> = {};
    for (const [k, v] of Object.entries(a.locks)) locks[Number(k)] = v as number;
    expect(applySeedLocks(a.derived, locks)).toEqual(a.locked);
  });
});

describe("parseSeedLocks (Paste — inverse of the modal copy format)", () => {
  it("parses #N: seed lines into a 0-based lock map", () => {
    expect(parseSeedLocks("#1: 42\n#2: 43\n#3: 44")).toEqual({ "0": 42, "1": 43, "2": 44 });
  });
  it("ignores blank, malformed, and #0 lines; tolerates stray whitespace", () => {
    expect(parseSeedLocks("\n#2: 7\ngarbage\n  #4 : 9 \n#0: 5\n#: x")).toEqual({ "1": 7, "3": 9 });
  });
  it("returns an empty map when nothing parses", () => {
    expect(parseSeedLocks("nope\n123\nfoo: bar")).toEqual({});
  });
  it("masks values to 50 bits — negatives normalize like the engine", () => {
    expect(parseSeedLocks("#1: -1")).toEqual({ "0": (2 ** 50) - 1 });
  });
});
