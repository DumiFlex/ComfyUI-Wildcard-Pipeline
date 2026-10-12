import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiDescribePanel from "../AiDescribePanel.vue";
import ConstraintPreview from "../../ConstraintPreview.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60,
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), describe: vi.fn() } },
  ApiError: class ApiError extends Error {},
}));

describe("AiDescribePanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.describe).mockReset();
  });

  it("asks without a hint and applies the description and ticked tags", async () => {
    vi.mocked(api.ai.describe).mockResolvedValue({
      description: "Fantasy classes for portraits.",
      tags: [
        { tag: "rpg", new: false, has: true },
        { tag: "portrait", new: false, has: false },
        { tag: "anime", new: true, has: false },
      ],
      model: "m",
    });
    const payload = vi.fn(() => ({ options: [{ value: "mage" }] }));
    const w = mount(AiDescribePanel, { props: {
      kind: "wildcard", name: "Class", description: "", tags: ["rpg"], payload,
    } });
    expect(w.get('[data-test="ai-run"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(api.ai.describe).toHaveBeenCalledWith({
      kind: "wildcard", name: "Class", description: "", tags: ["rpg"],
      payload: { options: [{ value: "mage" }] },
    }, expect.any(AbortSignal));
    expect(w.get('[data-test="ai-desc-description"]').text()).toContain("Fantasy classes");
    const chips = w.findAll('[data-test="ai-desc-tag"]');
    expect(chips.map((c) => c.text())).toEqual(["portrait", "anime"]);
    await chips[1].trigger("click");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("apply")?.[0]).toEqual([
      { description: "Fantasy classes for portraits.", addTags: ["portrait"] },
    ]);
  });
});

describe("ConstraintPreview", () => {
  it("shows chances and marks what changed", () => {
    const w = mount(ConstraintPreview, { props: {
      source: { options: [{ value: "mage", sub_categories: ["magic"] }] },
      target: { options: [{ value: "staff", sub_categories: ["staff"] }, { value: "sword", sub_categories: ["blade"] }] },
      matrix: { magic: { blade: { mode: "exclude", factor: 0 } } },
      exceptions: [],
      before: { matrix: {}, exceptions: [] },
    } });
    const cells = w.findAll(".wp-cn-preview__cell");
    expect(cells.map((c) => c.text())).toEqual(["100%", "–"]);
    expect(cells[0].attributes("data-delta")).toBe("up");
    expect(cells[1].attributes("data-delta")).toBe("down");
    expect(cells[1].attributes("title")).toContain("was 50%");
    expect(w.text()).toContain("1 row");
  });
});
