import { describe, expect, it } from "vitest";
import { computeConstraintDeadEnds, deadEndSourceValues } from "./constraint-dead-ends";
import { computePairingsFull, type ChainModule } from "./constraint-pairs";

const mood = {
  payload: {
    options: [
      { id: "m1", value: "gloomy", sub_categories: ["dark"] },
      { id: "m2", value: "sunny", sub_categories: ["bright"] },
    ],
  },
};

function hair(extra: Record<string, unknown> = {}) {
  return {
    payload: {
      options: [
        { id: "h1", value: "red", sub_categories: ["warm"] },
        { id: "h2", value: "blonde", sub_categories: ["warm"] },
        { id: "h3", value: "black", sub_categories: ["cool"] },
        ...((extra.options as unknown[]) ?? []),
      ],
    },
  };
}

const darkExcludesEverything = {
  matrix: { dark: { warm: { mode: "exclude" }, cool: { mode: "exclude" } } },
  exceptions: [],
};

describe("deadEndSourceValues", () => {
  it("reports the source value that excludes every target option", () => {
    expect(deadEndSourceValues(darkExcludesEverything, mood, hair())).toEqual(["gloomy"]);
  });

  it("stays quiet when one target option survives", () => {
    const c = { matrix: { dark: { warm: { mode: "exclude" } } } };
    expect(deadEndSourceValues(c, mood, hair())).toEqual([]);
  });

  it("stays quiet when the target has a fallback", () => {
    const t = hair({ options: [{ id: "h4", value: "loose hair", sub_categories: ["warm"], fallback: true }] });
    expect(deadEndSourceValues(darkExcludesEverything, mood, t)).toEqual([]);
  });

  it("reports again when the node toggles the fallback off", () => {
    const t = {
      ...hair({ options: [{ id: "h4", value: "loose hair", sub_categories: ["warm"], fallback: true }] }),
      instance: { enabled_options: ["h1", "h2", "h3"] },
    };
    expect(deadEndSourceValues(darkExcludesEverything, mood, t)).toEqual(["gloomy"]);
  });

  it("counts a weight-0 option as dead", () => {
    const c = { matrix: { dark: { warm: { mode: "exclude" } } } };
    const t = { ...hair(), instance: { option_weights: { h3: 0 } } };
    expect(deadEndSourceValues(c, mood, t)).toEqual(["gloomy"]);
  });

  it("handles an Only exception row (allow-list with nothing else live)", () => {
    const c = {
      matrix: {},
      exceptions: [{ source_value: "sunny", target_value: "black", mode: "only" }],
    };
    const t = { ...hair(), instance: { enabled_options: ["h1", "h2"] } };
    expect(deadEndSourceValues(c, mood, t)).toEqual(["sunny"]);
  });

  it("only tests the pinned source option", () => {
    const s = { ...mood, instance: { mode: "pinned", pinned_option_id: "m2" } };
    expect(deadEndSourceValues(darkExcludesEverything, s, hair())).toEqual([]);
  });

  it("skips a pinned target (constraints don't re-weight it)", () => {
    const t = { ...hair(), instance: { mode: "pinned", pinned_option_id: "h1" } };
    expect(deadEndSourceValues(darkExcludesEverything, mood, t)).toEqual([]);
  });

  it("ignores source options a filter removes", () => {
    const s = { ...mood, instance: { category_filter: "bright" } };
    expect(deadEndSourceValues(darkExcludesEverything, s, hair())).toEqual([]);
  });

  it("keeps a source accepts axis lenient: one viable member is enough", () => {
    const src = {
      payload: {
        tag_groups: { tone: ["dark", "bright"] },
        tag_group_kinds: { tone: "accepts" },
        options: [{ id: "m1", value: "moody", sub_categories: ["dark", "bright"] }],
      },
    };
    expect(deadEndSourceValues(darkExcludesEverything, src, hair())).toEqual([]);
  });

  it("is quiet when the target was already empty before the constraint", () => {
    const t = { ...hair(), instance: { enabled_options: [] } };
    expect(deadEndSourceValues(darkExcludesEverything, mood, t)).toEqual([]);
  });
});

describe("computeConstraintDeadEnds", () => {
  function chain(targetInstance: Record<string, unknown> | null = null): ChainModule[] {
    return [
      { id: "aaaa0001", rowKey: "1#src", type: "wildcard", payload: mood.payload },
      {
        id: "cccc0001", rowKey: "1#con", type: "constraint",
        payload: { source_wildcard_id: "aaaa0001", target_wildcard_id: "bbbb0001", ...darkExcludesEverything },
      },
      { id: "bbbb0001", rowKey: "2#tgt", type: "wildcard", payload: hair().payload, instance: targetInstance },
    ];
  }

  it("keys the dead end by the constraint row across nodes", () => {
    const c = chain();
    const out = computeConstraintDeadEnds(c, computePairingsFull(c));
    expect(out.get("1#con")?.sourceValues).toEqual(["gloomy"]);
  });

  it("skips a disabled constraint", () => {
    const c = chain();
    c[1] = { ...c[1], enabled: false };
    expect(computeConstraintDeadEnds(c, computePairingsFull(c)).size).toBe(0);
  });

  it("skips a target the reach doesn't cover", () => {
    const c = chain();
    c[1] = { ...c[1], payload: { ...c[1].payload, target_select: { mode: "pick", picks: [] } } };
    expect(computeConstraintDeadEnds(c, computePairingsFull(c)).size).toBe(0);
  });

  it("follows the target instance's overrides", () => {
    const c = chain({ mode: "pinned", pinned_option_id: "h1" });
    expect(computeConstraintDeadEnds(c, computePairingsFull(c)).size).toBe(0);
  });
});
