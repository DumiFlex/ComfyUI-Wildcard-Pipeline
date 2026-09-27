import { describe, expect, it } from "vitest";
import type { ScenarioRunResponse } from "../api/types";
import {
  baselineStatus,
  compareToBaseline,
  makeBaseline,
  parseBaseline,
  trackVars,
  wordDiff,
} from "./baseline";

function run(outputs: string[], extra: Partial<ScenarioRunResponse> = {}, seeds = outputs.map((_, i) => i)): ScenarioRunResponse {
  const counts: Record<string, number> = {};
  for (const o of outputs) counts[o] = (counts[o] ?? 0) + 1;
  return {
    runs: seeds.length, failed: 0, elapsed_ms: 1, seeds: { first: seeds[0], count: seeds.length },
    variables: { scene: { counts, distinct: Object.keys(counts).length, other: 0, internal: false } },
    picks: {}, constraint_hits: {}, warnings: [], samples: [], stack: [], missing: [], pins: {},
    tracked: { seeds, values: { scene: outputs } },
    ...extra,
  };
}

const NOW = new Date("2026-09-27T00:00:00Z");

describe("makeBaseline / parseBaseline", () => {
  it("keeps per-seed outputs, distributions and warnings", () => {
    const r = run(["a red hat", "a blue hat"], {
      warnings: [{ type: "unknown_var", message: "Unknown variable $x", count: 2, seeds: [0, 1] }],
    });
    const b = makeBaseline(r, "scene", { from: 0, count: 2 }, NOW);
    expect(b).toMatchObject({
      version: 1, saved_at: NOW.toISOString(), seeds: [0, 1], outputs: ["a red hat", "a blue hat"],
      output_var: "scene", runs: 2, failed: 0,
      warnings: [{ type: "unknown_var", message: "Unknown variable $x", count: 2 }],
    });
    expect(b.variables.scene.counts).toEqual({ "a red hat": 1, "a blue hat": 1 });
    expect(parseBaseline(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(parseBaseline({ version: 2 })).toBeNull();
    expect(parseBaseline(null)).toBeNull();
  });

  it("trims long distributions into other", () => {
    const outs = Array.from({ length: 60 }, (_, i) => `v${i}`);
    const b = makeBaseline(run(outs), "scene", { from: 0, count: 60 }, NOW);
    expect(Object.keys(b.variables.scene.counts)).toHaveLength(50);
    expect(b.variables.scene.other).toBe(10);
  });
});

describe("trackVars", () => {
  it("tracks the output and the baseline's output once each", () => {
    const b = makeBaseline(run(["x"]), "old", { from: 0, count: 1 }, NOW);
    expect(trackVars("scene", b)).toEqual(["scene", "old"]);
    expect(trackVars("scene", null)).toEqual(["scene"]);
    expect(trackVars(null, null)).toEqual([]);
  });
});

describe("compareToBaseline", () => {
  const base = makeBaseline(run(["a red hat", "a blue hat", "a red hat"]), "scene", { from: 0, count: 3 }, NOW);

  it("reports the same run as unchanged", () => {
    const d = compareToBaseline(base, run(["a red hat", "a blue hat", "a red hat"]));
    expect(d).toMatchObject({ same: true, compared: 3, uncovered: 0, seedsMatch: true, changed: [], variables: [] });
    expect(baselineStatus(d)).toEqual({ same: true, changed: 0, compared: 3 });
  });

  it("lists changed seeds and value changes", () => {
    const d = compareToBaseline(base, run(["a red hat", "a green hat", "a red hat"]));
    expect(d.same).toBe(false);
    expect(d.changed).toEqual([{ seed: 1, before: "a blue hat", after: "a green hat" }]);
    expect(d.variables).toEqual([{
      name: "scene", status: "changed", added: ["a green hat"], removed: ["a blue hat"], shifted: [],
    }]);
  });

  it("reports shifted shares, new and gone variables", () => {
    const b2 = makeBaseline(run(["x", "x", "y", "y"]), "scene", { from: 0, count: 4 }, NOW);
    const now = run(["x", "x", "x", "y"], {
      variables: {
        scene: { counts: { x: 3, y: 1 }, distinct: 2, other: 0, internal: false },
        mood: { counts: { calm: 4 }, distinct: 1, other: 0, internal: false },
      },
    });
    const d = compareToBaseline({ ...b2, variables: { ...b2.variables, gone: { counts: { q: 4 }, distinct: 1, other: 0 } } }, now);
    const byName = Object.fromEntries(d.variables.map((v) => [v.name, v]));
    expect(byName.scene.shifted).toEqual([{ value: "x", before: 50, after: 75 }, { value: "y", before: 50, after: 25 }]);
    expect(byName.mood).toMatchObject({ status: "new", added: ["calm"] });
    expect(byName.gone).toMatchObject({ status: "gone", removed: ["q"] });
  });

  it("doesn't call a value new when the baseline's list was trimmed", () => {
    const trimmed = { ...base, variables: { scene: { counts: { "a red hat": 2 }, distinct: 3, other: 1 } } };
    const d = compareToBaseline(trimmed, run(["a red hat", "a blue hat", "a red hat"]));
    expect(d.variables).toEqual([]);
  });

  it("reports warnings that appeared or went away", () => {
    const w = { type: "unknown_var", message: "Unknown variable $x", count: 3, seeds: [0] };
    const withW = makeBaseline(run(["a", "b", "c"], { warnings: [w] }), "scene", { from: 0, count: 3 }, NOW);
    const d = compareToBaseline(withW, run(["a", "b", "c"], { warnings: [{ ...w, message: "Unknown variable $y" }] }));
    expect(d.warningsAdded).toEqual([{ type: "unknown_var", message: "Unknown variable $y", count: 3 }]);
    expect(d.warningsGone).toEqual([{ type: "unknown_var", message: "Unknown variable $x", count: 3 }]);
  });

  it("compares only shared seeds when the seeds differ", () => {
    const d = compareToBaseline(base, run(["a red hat", "zzz"], {}, [2, 7]));
    expect(d).toMatchObject({ seedsMatch: false, compared: 1, uncovered: 2, changed: [], variables: [], same: false });
  });

  it("treats a seed that is now unset as changed", () => {
    const now = run(["a red hat", "a blue hat", "a red hat"], {
      tracked: { seeds: [0, 1, 2], values: { scene: ["a red hat", "a blue hat", null] } },
    });
    expect(compareToBaseline(base, now).changed).toEqual([{ seed: 2, before: "a red hat", after: null }]);
  });
});

describe("wordDiff", () => {
  it("marks changed words", () => {
    expect(wordDiff("a blue hat, outdoors", "a green hat, outdoors")).toEqual([
      { text: "a ", kind: "same" },
      { text: "blue", kind: "del" },
      { text: "green", kind: "add" },
      { text: " hat, outdoors", kind: "same" },
    ]);
  });
  it("highlights multi-word runs as one span", () => {
    expect(wordDiff("with denim jeans, calm", "with black cargo pants, calm")).toEqual([
      { text: "with ", kind: "same" },
      { text: "denim jeans,", kind: "del" },
      { text: "black cargo pants,", kind: "add" },
      { text: " calm", kind: "same" },
    ]);
  });
  it("handles empty sides and long texts", () => {
    expect(wordDiff("", "new")).toEqual([{ text: "new", kind: "add" }]);
    expect(wordDiff("old", "")).toEqual([{ text: "old", kind: "del" }]);
    expect(wordDiff("a b c", "a b d", 2)).toEqual([{ text: "a b c", kind: "del" }, { text: "a b d", kind: "add" }]);
  });
});
