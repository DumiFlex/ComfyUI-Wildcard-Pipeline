import { describe, it, expect } from "vitest";
import corpus from "../../tests/fixtures/model-variant-corpus.json";
import {
  DEFAULT_VARIANT_RULES,
  detectVariant,
  loaderFileName,
  modelInfoPreviewModule,
  modelStem,
  parseVariantRules,
  staticModelValues,
} from "./model-info";
import {
  collectUpstreamChain,
  collectUpstreamInjectorBindings,
  collectUpstreamInjectorNegatives,
  collectUpstreamKinds,
  collectUpstreamProducers,
  collectUpstreamResolved,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";

const rulesOf = (t: string | null) => parseVariantRules(t ?? DEFAULT_VARIANT_RULES);

describe("model-info corpus (shared with engine/model_info.py)", () => {
  it("default rules match the engine's", () => {
    expect(DEFAULT_VARIANT_RULES).toBe(corpus.default_rules);
  });
  for (const c of corpus.variants) {
    it(`variant of ${c.name || "(empty)"} = ${c.variant || "(none)"}`, () => {
      expect(detectVariant(c.name, rulesOf(c.rules).rules)).toBe(c.variant);
    });
  }
  for (const c of corpus.problems) {
    it(`reports ${c.count} rule problems`, () => {
      expect(rulesOf(c.rules).problems).toHaveLength(c.count);
    });
  }
  for (const c of corpus.stems) {
    it(`stem of ${c.path || "(empty)"}`, () => {
      expect(modelStem(c.path)).toBe(c.stem);
    });
  }
});

/** Loader(1) → LoRA(2) → ModelInfo(3) → Context(4). */
function graph(opts: { ckpt?: string; info?: Record<string, string>; noModel?: boolean } = {}) {
  const nodes: LiteNodeLike[] = [];
  const g = {
    _nodes: nodes,
    links: {
      10: { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      11: { id: 11, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 1 },
      12: { id: 12, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 0 },
    },
    getNodeById: (id: number) => nodes.find((n) => n.id === id) ?? null,
  } as unknown as LiteGraphLike;
  const loader: LiteNodeLike = {
    id: 1, type: "CheckpointLoaderSimple", graph: g,
    widgets: [{ name: "ckpt_name", value: opts.ckpt ?? "SDXL/ponyDiffusionV6XL.safetensors" }],
    outputs: [{ name: "MODEL", links: [10], type: "MODEL" }],
  };
  const lora: LiteNodeLike = {
    id: 2, type: "LoraLoader", graph: g,
    inputs: [{ name: "model", link: 10 }],
    widgets: [{ name: "lora_name", value: "detail.safetensors" }],
    outputs: [{ name: "MODEL", links: [11], type: "MODEL" }],
  };
  const info: LiteNodeLike = {
    id: 3, type: "WP_ModelInfo", graph: g,
    inputs: [{ name: "upstream", link: null }, { name: "model", link: opts.noModel ? null : 11 }],
    outputs: [{ name: "context", links: [12], type: "PIPELINE_CONTEXT" }],
    widgets: Object.entries({ model_name: "", family_override: "", variant_override: "", ...opts.info })
      .map(([name, value]) => ({ name, value })),
  };
  const ctx: LiteNodeLike = {
    id: 4, type: "WP_Context", graph: g,
    inputs: [{ name: "upstream", link: 12 }],
    outputs: [{ name: "context", links: [], type: "PIPELINE_CONTEXT" }],
    widgets: [{ name: "wp_modules", value: JSON.stringify({ version: 1, modules: [] }) }],
  };
  nodes.push(loader, lora, info, ctx);
  return { g, info, ctx };
}

describe("model-info on the canvas", () => {
  it("reads the checkpoint name through a LoRA loader", () => {
    const { g, info } = graph();
    expect(loaderFileName(info, g)).toBe("SDXL/ponyDiffusionV6XL.safetensors");
    expect(staticModelValues(info)).toEqual({
      model_family: "$model_family",
      model_variant: "pony",
      model_name: "ponyDiffusionV6XL",
    });
  });

  it("typed name and overrides win", () => {
    const { info } = graph({
      info: { model_name: "waiIllustrious.safetensors", family_override: "sdxl" },
    });
    expect(staticModelValues(info)).toEqual({
      model_family: "sdxl", model_variant: "illustrious", model_name: "waiIllustrious",
    });
    const { info: forced } = graph({ info: { variant_override: "noobai" } });
    expect(staticModelValues(forced).model_variant).toBe("noobai");
  });

  it("no model wired: placeholders, and the preview module leaves them out", () => {
    const { info } = graph({ noModel: true });
    expect(staticModelValues(info)).toEqual({
      model_family: "$model_family", model_variant: "$model_variant", model_name: "$model_name",
    });
    expect(modelInfoPreviewModule(info).entries).toEqual([]);
  });

  it("walkers see the three variables downstream", () => {
    const { g, ctx } = graph();
    const producers = collectUpstreamProducers(g, ctx);
    expect(producers.model_variant.kind).toBe("model");
    expect(producers.model_variant.nodeLabel).toBe("Model Info");
    expect(collectUpstreamKinds(g, ctx).model_family).toBe("model");
    expect(collectUpstreamInjectorBindings(g, ctx).sort())
      .toEqual(["model_family", "model_name", "model_variant"]);
    expect(collectUpstreamInjectorNegatives(g, ctx)).toEqual({
      model_family: null, model_variant: null, model_name: null,
    });
    const resolved = collectUpstreamResolved(g, ctx);
    expect(resolved.model_variant).toBe("pony");
    expect(resolved.model_name).toBe("ponyDiffusionV6XL");
  });

  it("the preview chain carries a model step only when asked", () => {
    const { g, ctx } = graph({ info: { family_override: "sdxl" } });
    expect(collectUpstreamChain(g, ctx)).toEqual([]);
    const steps = collectUpstreamChain(g, ctx, { modelSteps: true });
    expect(steps).toHaveLength(1);
    expect((steps[0][0] as { entries: unknown[] }).entries).toEqual([
      { variable_name: "model_family", value: "sdxl" },
      { variable_name: "model_variant", value: "pony" },
      { variable_name: "model_name", value: "ponyDiffusionV6XL" },
    ]);
  });

  it("the memo notices a checkpoint switch on the loader", () => {
    const { g, ctx } = graph();
    expect(collectUpstreamResolved(g, ctx).model_variant).toBe("pony");
    const loader = g.getNodeById(1)!;
    loader.widgets![0].value = "illustriousXL.safetensors";
    expect(collectUpstreamResolved(g, ctx).model_variant).toBe("illustrious");
  });
});
