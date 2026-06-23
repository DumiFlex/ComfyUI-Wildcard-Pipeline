import { describe, it, expect } from "vitest";
import { parseSeedListConfig, serializeSeedListConfig, emptySeedListConfig } from "./types";

describe("SeedListConfig seed_locks", () => {
  it("defaults seed_locks to {}", () => {
    expect(emptySeedListConfig().seed_locks).toEqual({});
  });
  it("parses seed_locks", () => {
    expect(parseSeedListConfig(JSON.stringify({ seed_locks: { "1": 999 } })).seed_locks).toEqual({ "1": 999 });
  });
  it("drops non-numeric lock values", () => {
    expect(parseSeedListConfig(JSON.stringify({ seed_locks: { "1": "x", "2": 5 } })).seed_locks).toEqual({ "2": 5 });
  });
  it("round-trips through serialize", () => {
    const cfg = { ...emptySeedListConfig(), seed_locks: { "0": 7 } };
    expect(parseSeedListConfig(serializeSeedListConfig(cfg)).seed_locks).toEqual({ "0": 7 });
  });
});
