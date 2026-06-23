import { describe, it, expect } from "vitest";
import corpus from "../../../../tests/fixtures/seed-derive-corpus.json";
import { deriveLoopSeeds, applySeedLocks } from "../seed-derive";

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
