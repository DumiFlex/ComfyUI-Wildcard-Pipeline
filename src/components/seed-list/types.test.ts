import { describe, it, expect } from "vitest";
import {
  emptySeedListConfig,
  parseSeedListConfig,
  serializeSeedListConfig,
  type SeedListConfig,
} from "./types";

describe("parseSeedListConfig", () => {
  it("returns defaults for empty input", () => {
    expect(parseSeedListConfig("")).toEqual(emptySeedListConfig());
    expect(parseSeedListConfig(null)).toEqual(emptySeedListConfig());
    expect(parseSeedListConfig(undefined)).toEqual(emptySeedListConfig());
  });

  it("returns defaults for malformed JSON", () => {
    expect(parseSeedListConfig("not json")).toEqual(emptySeedListConfig());
  });

  it("returns defaults for non-object JSON", () => {
    expect(parseSeedListConfig("[1,2,3]")).toEqual(emptySeedListConfig());
    expect(parseSeedListConfig('"a string"')).toEqual(emptySeedListConfig());
  });

  it("honors valid config with all three override fields", () => {
    const cfg: SeedListConfig = {
      strategy: "sequential",
      override_seed: true,
      override_count: true,
      override_strategy: true,
      seed_locks: {},
    };
    expect(parseSeedListConfig(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("honors independent override fields (count on, strategy off)", () => {
    const cfg: SeedListConfig = {
      strategy: "hash_index",
      override_seed: false,
      override_count: true,
      override_strategy: false,
      seed_locks: {},
    };
    expect(parseSeedListConfig(JSON.stringify(cfg))).toEqual(cfg);
  });

  it("falls back to default strategy on unknown value", () => {
    const got = parseSeedListConfig('{"strategy":"wat","override_seed":true}');
    expect(got.strategy).toBe("hash_index");
    expect(got.override_seed).toBe(true);
  });

  it("ignores non-bool override values, falling back to defaults", () => {
    const got = parseSeedListConfig(
      '{"override_seed":"yes","override_count":1,"override_strategy":null}',
    );
    expect(got.override_seed).toBe(false);
    expect(got.override_count).toBe(false);
    expect(got.override_strategy).toBe(false);
  });

  it("backfills missing fields with defaults", () => {
    const got = parseSeedListConfig('{"strategy":"prime_stride"}');
    expect(got).toEqual({
      strategy: "prime_stride",
      override_seed: false,
      override_count: false,
      override_strategy: false,
      seed_locks: {},
    });
  });

  it("legacy: mirrors `override_config` to both new fields", () => {
    // Workflow saved before the split — only carries override_config.
    const got = parseSeedListConfig('{"override_config":true}');
    expect(got.override_count).toBe(true);
    expect(got.override_strategy).toBe(true);
  });

  it("legacy: new fields win over `override_config` when both present", () => {
    // Mixed shape (post-split saved on top of pre-split state).
    const got = parseSeedListConfig(
      '{"override_config":true,"override_count":false,"override_strategy":true}',
    );
    expect(got.override_count).toBe(false);
    expect(got.override_strategy).toBe(true);
  });

  it("round-trips via serialize", () => {
    const cfg: SeedListConfig = {
      strategy: "prime_stride",
      override_seed: false,
      override_count: true,
      override_strategy: false,
      seed_locks: {},
    };
    const round = parseSeedListConfig(serializeSeedListConfig(cfg));
    expect(round).toEqual(cfg);
  });
});

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
