import { describe, it, expect } from "vitest";
import { resolveSeedListPreview } from "./preview";

const local = { base: 5, count: 3, strategy: "sequential" as const };
const loop = { base: 100, count: 8, strategy: "hash_index" as const };
const NONE = { override_seed: false, override_count: false, override_strategy: false };

describe("resolveSeedListPreview", () => {
  it("no loop wired → all local (even if toggles on)", () => {
    expect(resolveSeedListPreview(local, { override_seed: true, override_count: true, override_strategy: true }, null))
      .toEqual({ baseSeed: 5, count: 3, strategy: "sequential" });
  });
  it("no overrides → all local", () => {
    expect(resolveSeedListPreview(local, NONE, loop)).toEqual({ baseSeed: 5, count: 3, strategy: "sequential" });
  });
  it("override_count only → loop count, local base+strategy", () => {
    expect(resolveSeedListPreview(local, { ...NONE, override_count: true }, loop))
      .toEqual({ baseSeed: 5, count: 8, strategy: "sequential" });
  });
  it("all overrides → all loop", () => {
    expect(resolveSeedListPreview(local, { override_seed: true, override_count: true, override_strategy: true }, loop))
      .toEqual({ baseSeed: 100, count: 8, strategy: "hash_index" });
  });
});
