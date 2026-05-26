import { describe, it, expect } from "vitest";
import {
  emptyContextLoopConfig,
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
    };
    const round = parseContextLoopConfig(serializeContextLoopConfig(cfg));
    expect(round).toEqual(cfg);
  });
});
