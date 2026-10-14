import { afterEach, describe, expect, it } from "vitest";
import { collectCanvasVars, type LiteGraphLike, type LiteNodeLike } from "./graph";
import { answerCanvasFacts } from "./canvas-facts";
import { CANVAS_FACTS_CHANNEL } from "./canvas-facts-channel";
import { _resetAiContextForTests, askCanvas } from "../manager/utils/ai-context";

function graph(nodes: LiteNodeLike[]): LiteGraphLike {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return { _nodes: nodes, links: {}, getNodeById: (id) => byId[id] ?? null } as LiteGraphLike;
}

const NODES: LiteNodeLike[] = [
  {
    id: 1, type: "WP_ContextInjector", widgets: [{
      name: "wp_rows",
      value: JSON.stringify({ version: 1, rows: [
        { binding: "style_lora", enabled: true, kind: "socket", slot_label: "LoRA trigger" },
        { binding: "scene", enabled: true, kind: "general" },
        { binding: "off", enabled: false },
        { binding: "__hidden", enabled: true },
      ] }),
    }],
  },
  {
    id: 2, type: "WP_ContextLoop", widgets: [
      { name: "wp_context_loop_config", value: JSON.stringify({ iteration_var_name: "page" }) },
      { name: "count", value: 6 },
    ],
  },
  { id: 3, type: "WP_ModelInfo", widgets: [] },
  { id: 4, type: "WP_ContextInjector", mode: 4, widgets: [{
    name: "wp_rows", value: JSON.stringify({ version: 1, rows: [{ binding: "bypassed", enabled: true }] }),
  }] },
];

describe("canvas facts for the AI", () => {
  afterEach(() => _resetAiContextForTests());

  it("lists the run-time variables the canvas sets", () => {
    expect(collectCanvasVars(graph(NODES))).toEqual([
      { name: "style_lora", source: "injector", about: "from LoRA trigger" },
      { name: "scene", source: "injector", about: "a template row" },
      { name: "page", source: "loop", about: "frame number 1 to N, 6 frames" },
      { name: "page_total", source: "loop", about: "number of frames, 6 frames" },
      { name: "model_family", source: "model", about: "" },
      { name: "model_variant", source: "model", about: "" },
      { name: "model_name", source: "model", about: "" },
    ]);
  });

  it("an open canvas tab answers the manager's ask", async () => {
    const stop = answerCanvasFacts(() => graph(NODES));
    const vars = await askCanvas(50);
    expect(vars?.map((v) => v.name)).toContain("style_lora");
    stop();
  });

  it("no canvas tab: nothing comes back", async () => {
    const other = new BroadcastChannel(CANVAS_FACTS_CHANNEL);
    expect(await askCanvas(20)).toBeUndefined();
    other.close();
  });
});
