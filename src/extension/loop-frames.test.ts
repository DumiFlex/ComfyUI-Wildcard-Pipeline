import { describe, expect, it } from "vitest";
import {
  collectLoopFrames,
  collectUpstreamChain,
  collectUpstreamKinds,
  collectUpstreamResolved,
  collectUpstreamResolvedAtFrame,
  collectUpstreamVariables,
  collectUpstreamVariablesAnyFrame,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";
import { scanTemplateConflicts } from "./conflicts";
import { missingAssemblerVars } from "./assembler-vars";

/** Loop (1) → Context (2) → Assembler (3), the N05 shape. */
function fixedModule(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: "fixed_values",
    enabled: true,
    meta: { name: id },
    entries: [{ variable_name: name, value: `${name}-text` }],
    ...extra,
  };
}

function build(modules: unknown[], opts: { count?: number; valuesLink?: number | null } = {}) {
  const loop: LiteNodeLike = {
    id: 1,
    type: "WP_ContextLoop",
    inputs: [{ name: "values", link: opts.valuesLink ?? null }],
    outputs: [{ name: "context", links: [100], type: "PIPELINE_CONTEXT" }],
    widgets: [
      { name: "seed", value: 0 },
      { name: "count", value: opts.count ?? 4 },
      { name: "wp_context_loop_config", value: JSON.stringify({ iteration_var_name: "iteration" }) },
    ],
  };
  const ctx: LiteNodeLike = {
    id: 2,
    type: "WP_Context",
    inputs: [{ name: "upstream", link: 100 }],
    outputs: [{ name: "context", links: [200], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify({ version: 1, modules }) }],
  };
  const asm: LiteNodeLike = {
    id: 3,
    type: "WP_PromptAssembler",
    inputs: [{ name: "context", link: 200 }],
    outputs: [],
    widgets: [],
  };
  const nodes: Record<number, LiteNodeLike> = { 1: loop, 2: ctx, 3: asm };
  const g: LiteGraphLike = {
    _nodes: [loop, ctx, asm],
    links: {
      100: { id: 100, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      200: { id: 200, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
    },
    getNodeById: (id) => nodes[id as number] ?? null,
  };
  return { g, loop, ctx, asm };
}

describe("loop frame coverage", () => {
  it("a module off at base and on for frame 4 is set on frame 4 only", () => {
    const { g, asm } = build([
      fixedModule("a", "role"),
      fixedModule("b", "companion", { enabled: false, frame_enabled: { "3": true } }),
    ]);
    const lf = collectLoopFrames(g, asm);
    expect(lf?.count).toBe(4);
    expect(lf?.partial).toEqual({ companion: [3] });
    expect(lf?.anyFrame).toContain("companion");
    // The plain walk reads the base and misses it; any-frame finds it.
    expect(collectUpstreamVariables(g, asm)).not.toContain("companion");
    expect(collectUpstreamVariablesAnyFrame(g, asm)).toContain("companion");
  });

  it("a module on at base and off on frame 3 is set on the other frames", () => {
    const { g, asm } = build([
      fixedModule("b", "companion", { frame_enabled: { "2": false } }),
    ]);
    expect(collectLoopFrames(g, asm)?.partial).toEqual({ companion: [0, 1, 3] });
  });

  it("reads the legacy disabled_frames list", () => {
    const { g, asm } = build([fixedModule("b", "companion", { disabled_frames: [0] })]);
    expect(collectLoopFrames(g, asm)?.partial).toEqual({ companion: [1, 2, 3] });
  });

  it("ignores overrides past the loop's count", () => {
    const { g, asm } = build(
      [fixedModule("b", "companion", { enabled: false, frame_enabled: { "9": true } })],
      { count: 4 },
    );
    const lf = collectLoopFrames(g, asm);
    expect(lf?.partial).toEqual({});
    expect(lf?.anyFrame).not.toContain("companion");
  });

  it("returns null without a loop upstream", () => {
    const { g, asm, ctx } = build([fixedModule("a", "role")]);
    ctx.inputs = [{ name: "upstream", link: null }];
    expect(collectLoopFrames(g, asm)).toBeNull();
    expect(collectUpstreamVariablesAnyFrame(g, asm)).toEqual(collectUpstreamVariables(g, asm));
  });

  it("resolves one frame: its switches, $iteration and $iteration_total", () => {
    const { g, asm } = build([
      fixedModule("b", "companion", { enabled: false, frame_enabled: { "3": true } }),
    ]);
    const f0 = collectUpstreamResolvedAtFrame(g, asm, 0);
    expect(f0.companion).toBeUndefined();
    expect(f0.iteration).toBe("1");
    expect(f0.iteration_total).toBe("4");
    const f3 = collectUpstreamResolvedAtFrame(g, asm, 3);
    expect(f3.companion).toBe("companion-text");
    expect(f3.iteration).toBe("4");
    // Past the end clamps to the last frame.
    expect(collectUpstreamResolvedAtFrame(g, asm, 99).iteration).toBe("4");
  });

  it("frame kinds follow the frame's switches", () => {
    const { g, asm } = build([
      fixedModule("b", "companion", { enabled: false, frame_enabled: { "3": true } }),
    ]);
    expect(collectUpstreamKinds(g, asm).companion).toBeUndefined();
    expect(collectUpstreamKinds(g, asm, 3).companion).toBe("fixed_values");
  });

  it("the preview chain carries the frame's switches to the server", () => {
    const { g, asm } = build([
      fixedModule("b", "companion", { enabled: false, frame_enabled: { "3": true } }),
    ]);
    const at = (frame: number | null) =>
      (collectUpstreamChain(g, asm, { frame })[0][0] as { enabled?: boolean }).enabled;
    expect(at(null)).toBe(false);
    expect(at(0)).toBe(false);
    expect(at(3)).toBe(true);
  });

  it("the Run check and the subgraph badge stay quiet for a some-frames name", () => {
    const { g, asm } = build([
      fixedModule("b", "companion", { enabled: false, frame_enabled: { "3": true } }),
    ]);
    const known = collectUpstreamVariablesAnyFrame(g, asm);
    expect(missingAssemblerVars("$companion $nowhere", "", known)).toEqual(["nowhere"]);
    expect(scanTemplateConflicts("$companion $nowhere", known).map((c) => c.variable)).toEqual(["nowhere"]);
  });

  it("wiring the loop's values input shows $iteration_value (memo keyed on the link)", () => {
    const { g, asm, loop } = build([fixedModule("a", "role")]);
    expect(collectUpstreamResolved(g, asm).iteration_value).toBeUndefined();
    loop.inputs = [{ name: "values", link: 7 }];
    expect(collectUpstreamResolved(g, asm).iteration_value).toBe("");
  });
});
