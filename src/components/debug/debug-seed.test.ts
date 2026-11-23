import { describe, expect, it } from "vitest";
import { runSeed } from "./debug-seed";

const seedsRow = (row: string, value: number, detail: Record<string, unknown> = {}) => ({
  node: "WP_Seeds", binding: row, type: "seed", value: String(value), detail: { row, mode: "follow", frame: 0, ...detail },
});

describe("runSeed", () => {
  it("shows the Loop's seed when the Contexts run on it", () => {
    const rs = runSeed({
      __wp_loop_seed__: { seed: 555, frame0: 500, base: 42 },
      __wp_nodes__: [
        { node_id: "3", seed: 555, from: "loop" },
        { node_id: "4", seed: 555, from: "loop" },
      ],
      __wp_node_seed__: 555,
    });
    expect(rs).toMatchObject({ value: "42", kind: "loop", label: "loop seed", others: 0 });
    expect(rs.hint).toContain("All 2 Contexts");
    expect(rs.hint).toContain("this frame: 555");
  });

  it("shows the Seeds base seed when most Contexts read rows that follow it", () => {
    const rs = runSeed({
      __wp_trace__: [seedsRow("Face", 11, { base: 900 }), seedsRow("Hands", 12, { base: 900 })],
      __wp_nodes__: [
        { node_id: "3", seed: 11, from: "row:Face" },
        { node_id: "4", seed: 12, from: "row:hands" },
        { node_id: "5", seed: 77, from: "own" },
      ],
    });
    expect(rs).toMatchObject({ value: "900", kind: "seeds", label: "seeds base", others: 1 });
    expect(rs.nodes.map((n) => n.source)).toEqual(["Seeds · Face", "Seeds · Hands", "own"]);
  });

  it("traces a Seeds row whose base came from the Loop back to the Loop", () => {
    const rs = runSeed({
      __wp_loop_seed__: { seed: 1, frame0: 1, base: 8 },
      __wp_trace__: [seedsRow("Face", 11, { base: 8, base_from_loop: true })],
      __wp_nodes__: [{ node_id: "3", seed: 11, from: "row:Face" }, { node_id: "4", seed: 9, from: "loop" }],
    });
    expect(rs).toMatchObject({ value: "8", kind: "loop", others: 0 });
  });

  it("names a Random or Fixed Seeds row by its own seed", () => {
    const rs = runSeed({
      __wp_trace__: [seedsRow("Face", 31, { mode: "fixed", base: 900 })],
      __wp_nodes__: [{ node_id: "3", seed: 31, from: "row:Face" }],
    });
    expect(rs).toMatchObject({ value: "31", kind: "row", label: "seed · Face", others: 0 });
  });

  it("falls back to the last Context, and to the node seed without Contexts", () => {
    const own = runSeed({ __wp_nodes__: [{ node_id: "3", seed: 1, from: "own" }, { node_id: "4", seed: 2, from: "own" }] });
    expect(own).toMatchObject({ value: "2", kind: "own", label: "seed", others: 1 });
    expect(runSeed({ __wp_node_seed__: 9 })).toMatchObject({ value: "9", nodes: [], others: 0 });
    // A snapshot from before sources were recorded names none.
    expect(runSeed({ __wp_nodes__: [{ node_id: "3", seed: 1 }] }).nodes[0]?.source).toBe("");
  });
});
