import { describe, it, expect } from "vitest";
import { parseContextLoopConfig, serializeContextLoopConfig, emptyContextLoopConfig } from "./types";

describe("ContextLoopConfig seed_locks", () => {
  it("defaults seed_locks to {}", () => {
    expect(emptyContextLoopConfig().seed_locks).toEqual({});
  });
  it("parses seed_locks", () => {
    expect(parseContextLoopConfig(JSON.stringify({ seed_locks: { "1": 999 } })).seed_locks).toEqual({ "1": 999 });
  });
  it("drops non-numeric lock values", () => {
    expect(parseContextLoopConfig(JSON.stringify({ seed_locks: { "1": "x", "2": 5 } })).seed_locks).toEqual({ "2": 5 });
  });
  it("round-trips through serialize", () => {
    const cfg = { ...emptyContextLoopConfig(), seed_locks: { "0": 7 } };
    expect(parseContextLoopConfig(serializeContextLoopConfig(cfg)).seed_locks).toEqual({ "0": 7 });
  });
});
