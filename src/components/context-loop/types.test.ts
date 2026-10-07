import { describe, it, expect } from "vitest";
import {
  emptyContextLoopConfig,
  emptySweepConfig,
  keepFramesWithin,
  remapSweepFrames,
  parseContextLoopConfig,
  serializeContextLoopConfig,
  type ContextLoopConfig,
} from "./types";

describe("parseContextLoopConfig", () => {
  it("returns defaults for empty input", () => {
    expect(parseContextLoopConfig("")).toEqual(emptyContextLoopConfig());
    expect(parseContextLoopConfig(null)).toEqual(emptyContextLoopConfig());
    expect(parseContextLoopConfig(undefined)).toEqual(emptyContextLoopConfig());
  });

  it("returns defaults for malformed JSON", () => {
    expect(parseContextLoopConfig("not json")).toEqual(emptyContextLoopConfig());
  });

  it("returns defaults for non-object JSON", () => {
    expect(parseContextLoopConfig("[1,2,3]")).toEqual(emptyContextLoopConfig());
    expect(parseContextLoopConfig('"a string"')).toEqual(emptyContextLoopConfig());
  });

  it("honors valid config", () => {
    const cfg: ContextLoopConfig = {
      strategy: "sequential",
      override_seed: true,
      iteration_var_name: "idx",
      bypass: true,
      iteration_internal: false,
      total_internal: false,
      seed_locks: {},
      bypass_frames: [],
      sweep: emptySweepConfig(),
    };
    expect(parseContextLoopConfig(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("honors internal flag fields", () => {
    const cfg: ContextLoopConfig = {
      strategy: "hash_index",
      override_seed: false,
      iteration_var_name: "iteration",
      bypass: false,
      iteration_internal: true,
      total_internal: true,
      seed_locks: {},
      bypass_frames: [],
      sweep: emptySweepConfig(),
    };
    expect(parseContextLoopConfig(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("falls back to default strategy on unknown value", () => {
    const got = parseContextLoopConfig('{"strategy":"wat","override_seed":true}');
    expect(got.strategy).toBe("hash_index");
    expect(got.override_seed).toBe(true);
  });

  it("ignores blank iteration_var_name", () => {
    const got = parseContextLoopConfig('{"iteration_var_name":"   "}');
    expect(got.iteration_var_name).toBe("iteration");
  });

  it("round-trips via serialize", () => {
    const cfg: ContextLoopConfig = {
      strategy: "prime_stride",
      override_seed: false,
      iteration_var_name: "loop",
      bypass: true,
      iteration_internal: false,
      total_internal: true,
      seed_locks: {},
      bypass_frames: [],
      sweep: emptySweepConfig(),
    };
    const round = parseContextLoopConfig(serializeContextLoopConfig(cfg));
    expect(round).toEqual(cfg);
  });
});

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

describe("bypass_frames parse", () => {
  it("defaults to empty", () => {
    expect(emptyContextLoopConfig().bypass_frames).toEqual([]);
    expect(parseContextLoopConfig("{}").bypass_frames).toEqual([]);
  });
  it("dedups + sorts, keeps out-of-range, drops junk + negatives", () => {
    expect(parseContextLoopConfig('{"bypass_frames":[3,1,3,0]}').bypass_frames).toEqual([0, 1, 3]);
    expect(parseContextLoopConfig('{"bypass_frames":[2,-1,"x",2,999]}').bypass_frames).toEqual([2, 999]);
  });
  it("drops coercible non-numbers, not coerce them (Python parity)", () => {
    // true/"3"/null would coerce to 1/3/0 under Number() — must be dropped.
    expect(parseContextLoopConfig('{"bypass_frames":[true,"3",null,2]}').bypass_frames).toEqual([2]);
  });
  it("malformed collapses to empty", () => {
    expect(parseContextLoopConfig('{"bypass_frames":"nope"}').bypass_frames).toEqual([]);
    expect(parseContextLoopConfig("not json").bypass_frames).toEqual([]);
  });
});

describe("frame locks follow count and sweep edits", () => {
  const base = () => ({ ...emptyContextLoopConfig(), seed_locks: { "1": 11, "4": 44 }, bypass_frames: [2, 5] });
  const sweep = (opts: string[][], limit = 64) => ({
    enabled: true, limit, hold_others: true,
    axes: opts.map((ids, i) => ({ uid: `u${i}`, option_ids: ids })),
  });

  it("lowering the count drops locks and bypasses past it", () => {
    const cfg = base();
    expect(keepFramesWithin(cfg, 3)).toMatchObject({ seed_locks: { "1": 11 }, bypass_frames: [2] });
    expect(keepFramesWithin(cfg, 9)).toBe(cfg);
  });

  it("a sweep edit moves locks with their combination and drops gone ones", () => {
    // a×(x,y): frames ax, ay, bx, by. Lock "by" (3), bypass "ay" (1).
    const prev = { ...emptyContextLoopConfig(), sweep: sweep([["a", "b"], ["x", "y"]]), seed_locks: { "3": 7 }, bypass_frames: [1] };
    // Add option z: ax ay az bx by bz -> "by" is now 4, "ay" stays 1.
    const added = remapSweepFrames(prev, { ...prev, sweep: sweep([["a", "b"], ["x", "y", "z"]]) }, 1);
    expect(added).toMatchObject({ seed_locks: { "4": 7 }, bypass_frames: [1] });
    // Drop y: ax bx -> both gone.
    const dropped = remapSweepFrames(prev, { ...prev, sweep: sweep([["a", "b"], ["x"]]) }, 1);
    expect(dropped).toMatchObject({ seed_locks: {}, bypass_frames: [] });
  });

  it("turning the sweep off keeps only frames within the count", () => {
    const prev = { ...emptyContextLoopConfig(), sweep: sweep([["a", "b"], ["x", "y"]]), seed_locks: { "3": 7, "0": 1 }, bypass_frames: [1] };
    const off = remapSweepFrames(prev, { ...prev, sweep: { ...prev.sweep, enabled: false } }, 2);
    expect(off).toMatchObject({ seed_locks: { "0": 1 }, bypass_frames: [1] });
  });
});
