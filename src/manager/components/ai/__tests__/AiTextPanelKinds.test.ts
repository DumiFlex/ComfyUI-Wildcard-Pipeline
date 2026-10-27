import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiTextPanel from "../AiTextPanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { changedLines } from "../../../utils/ai-rule-text";
import type { AiConfig, AiTextDraftResult, DerivationRule } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384,
  model_size: "auto", model_size_auto: "small", key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), draftText: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

beforeEach(() => {
  setActivePinia(createPinia());
  _resetAiConfigForTests();
  vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
  vi.mocked(api.ai.draftText).mockReset();
});

async function ask(kind: "fixed_values" | "combine" | "template", item: object, res: AiTextDraftResult) {
  vi.mocked(api.ai.draftText).mockResolvedValue(res);
  const w = mount(AiTextPanel, { props: { kind, item: item as never } });
  await flushPromises();
  await w.get('[data-test="ai-instruction"]').setValue("go");
  await w.get('[data-test="ai-run"]').trigger("click");
  await flushPromises();
  return w;
}

describe("AiTextPanel per kind (bench #1, #3)", () => {
  it("fixed values: one row per value, and only the ticked ones are used", async () => {
    const item = { name: "Anime", payload: { values: [
      { id: "v1", name: "quality", value: "masterpiece" },
      { id: "v2", name: "style", value: "anime", negative: "3d" },
    ] } };
    const w = await ask("fixed_values", item, {
      payload: { values: [] }, preview: [], warnings: [], model: "m", answer: {},
      rows: [
        { id: "v2", name: "style", value: "90s retro anime", negative: "3d, photo", status: "changed",
          before: { value: "anime", negative: "3d" } },
        { id: "v9", name: "medium", value: "cel shading", negative: "", status: "new" },
      ],
    });
    const rows = w.findAll('[data-test="ai-fixed-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Changed");
    expect(rows[0].find(".wp-ai-fv__old").text()).toBe("anime");
    expect(rows[0].find(".wp-ai-fv__cell--neg").text()).toContain("3d, photo");
    expect(rows[1].text()).toContain("New");
    expect(w.get('[data-test="ai-apply"]').text()).toBe("Use 2 values");
    // Untick the new value: only the change is used, quality stays.
    await rows[1].get("button[role=checkbox]").trigger("click");
    expect(w.get('[data-test="ai-apply"]').text()).toBe("Use 1 value");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("use")?.[0]?.[0]).toEqual({ values: [
      { id: "v1", name: "quality", value: "masterpiece" },
      { id: "v2", name: "style", value: "90s retro anime", negative: "3d, photo" },
    ] });
  });

  it("combine: old text struck, reads marked, examples, negative on its own", async () => {
    const w = await ask("combine", { name: "Look", payload: { output_var: "look", template: "$hair $eyes" } }, {
      payload: { output_var: "look", template: "$hair, $eyes, $outfit", negative: "blurry" },
      preview: [], warnings: [], model: "m", answer: {},
      samples: ["red hair, blue eyes, a cloak"],
      before: { template: "$hair $eyes", negative: "" },
    });
    const prompt = w.get('[data-test="ai-text-prompt"]');
    expect(prompt.get(".wp-ai-txt__old").text()).toBe("$hair $eyes");
    const chips = prompt.findAll(".wp-ai-txt__chip");
    expect(chips.map((c) => [c.text(), c.attributes("data-new")])).toEqual([
      ["$hair", "false"], ["$eyes", "false"], ["$outfit", "true"],
    ]);
    expect(w.get('[data-test="ai-text-samples"]').text()).toContain("red hair, blue eyes, a cloak");
    // Keep the old negative: untick it.
    await w.get(`[data-test="ai-text-negative"] button[role=checkbox]`).trigger("click");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("use")?.[0]?.[0]).toEqual({
      output_var: "look", template: "$hair, $eyes, $outfit", negative: "",
    });
  });

  it("template: an unchanged negative has no tick box", async () => {
    const w = await ask("template", { name: "T", template_string: "$a", negative_template: "$negatives" }, {
      payload: { template_string: "portrait of $a", negative_template: "$negatives" },
      preview: [], warnings: ["Took out $iteration: loop and model variables are for rules"],
      model: "m", answer: {}, before: { template: "$a", negative: "$negatives" },
    });
    expect(w.get('[data-test="ai-text-negative"]').text()).toContain("unchanged");
    expect(w.find('[data-test="ai-text-negative"] button[role=checkbox]').exists()).toBe(false);
    expect(w.get('[data-test="ai-text-warning"]').text()).toContain("$iteration");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("use")?.[0]?.[0]).toEqual({
      template_string: "portrait of $a", negative_template: "$negatives",
    });
  });
});

describe("changedLines", () => {
  it("marks the branches a changed rule adds", () => {
    const act = (v: string) => ({ target_var: "title", mode: "replace" as const, value: v });
    const old = {
      id: "r1", branches: [{ condition: { var: "class", op: "equals", value: "mage" }, action: act("Archmage") }],
      else: { action: act("Adventurer") },
    } as unknown as DerivationRule;
    const next = {
      ...old,
      branches: [...old.branches, { condition: { var: "class", op: "equals", value: "rogue" }, action: act("Shadowblade") }],
    } as unknown as DerivationRule;
    expect(changedLines(old, next)).toEqual([false, true, false]);
    expect(changedLines(undefined, next)).toEqual([true, true, true]);
  });
});
