import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiDerivationPanel from "../AiDerivationPanel.vue";
import AiConstraintPanel from "../AiConstraintPanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { ruleLines } from "../../../utils/ai-rule-text";
import type { AiConfig, DerivationRule } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "qwen3.6:27b", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small",
  key_set: false, key_from_env: false, keys_saved: [],
  presets: {
    ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" },
  },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), draftDerivation: vi.fn(), draftConstraint: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const RULE: DerivationRule = {
  id: "r_ai0001",
  branches: [
    {
      condition: { match: "all", conditions: [
        { var: "class", op: "equals", value: "mage" },
        { var: "weapon", op: "is_set", value: "" },
      ] },
      action: { target_var: "title", mode: "replace", value: "Archmage" },
      extra_actions: [{ target_var: "title", mode: "negative", value: "armor" }],
    },
  ],
  else: { action: { target_var: "title", mode: "append", value: ", adventurer" } },
};

function lastPending(w: { emitted: (e: string) => unknown[][] | undefined }): unknown {
  const all = w.emitted("update:pending") ?? [];
  return all[all.length - 1]?.[0];
}

describe("ruleLines", () => {
  it("reads a rule in plain words", () => {
    expect(ruleLines(RULE)).toEqual([
      {
        lead: "IF",
        when: '$class equals "mage" AND $weapon is set',
        then: ['set $title to "Archmage"', 'add "armor" to $title\'s negative'],
      },
      { lead: "ELSE", when: "", then: ['add ", adventurer" after $title'] },
    ]);
  });
});

describe("AiDerivationPanel", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.draftDerivation).mockReset();
  });

  it("sends the current rules and adds the ticked ones", async () => {
    const second = { ...RULE, id: "r_ai0002" };
    vi.mocked(api.ai.draftDerivation).mockResolvedValue({
      rules: [
        { rule: RULE, summary: "Mages get a title", warnings: ["nothing in your library sets $weapon"] },
        { rule: second, summary: "Second", warnings: [] },
      ],
      skipped: [], model: "qwen3.6:27b", answer: {},
    });
    const existing: DerivationRule[] = [{ ...RULE, id: "old" }];
    const w = mount(AiDerivationPanel, { props: { name: "Titles", rules: existing } });
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("mages get a title");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(api.ai.draftDerivation).toHaveBeenCalledWith(
      {
        instruction: "mages get a title",
        derivation: { name: "Titles", description: "", tags: [], rules: existing },
      },
      expect.any(AbortSignal),
    );
    expect(w.findAll('[data-test="ai-rule"]')).toHaveLength(2);
    expect(w.get('[data-test="ai-rule-warning"]').text()).toContain("$weapon");
    expect(w.text()).toContain('set $title to "Archmage"');
    expect(lastPending(w)).toBe(true);
    await w.findAll('[data-test="ai-rule"] [role="checkbox"]')[1].trigger("click");
    expect(w.get('[data-test="ai-apply"]').text()).toBe("Add 1 rule");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("add")?.[0]).toEqual([[RULE]]);
    expect(lastPending(w)).toBe(false);
  });

  it("explains an empty answer", async () => {
    vi.mocked(api.ai.draftDerivation).mockResolvedValue({
      rules: [], skipped: [{ text: "x", reason: "bad" }], model: "m", answer: {},
    });
    const w = mount(AiDerivationPanel, { props: { name: "", rules: [] } });
    await w.get('[data-test="ai-instruction"]').setValue("anything");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-error"]').text()).toContain("couldn't be used");
  });
});

describe("AiConstraintPanel", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.draftConstraint).mockReset();
  });

  it("lists cells and exceptions and applies the ticked ones", async () => {
    const cell = {
      source_tag: "magic", target_tag: "blade", cell: { mode: "exclude" as const, factor: 0 },
      reason: "no swords", replaces: true,
    };
    const exc = {
      exception: { source: "mage", target: "oak staff", mode: "boost" as const, factor: 3,
                   source_id: "a", target_id: "b" },
      reason: "", from: "mage → #staff", replaces: false,
    };
    const exc2 = { ...exc, exception: { ...exc.exception, target: "crystal staff" } };
    vi.mocked(api.ai.draftConstraint).mockResolvedValue({
      cells: [cell], exceptions: [exc, exc2], skipped: [], model: "m", answer: {},
    });
    const w = mount(AiConstraintPanel, { props: {
      sourceWildcardId: "src", targetWildcardId: "tgt", sourceName: "Class", targetName: "Weapon",
      matrix: {}, exceptions: [],
    } });
    expect(w.get('[data-test="ai-scope"]').text()).toBe("Class → Weapon");
    await w.get('[data-test="ai-instruction"]').setValue("mages never use swords");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.draftConstraint).mock.calls[0][0].constraint.source_wildcard_id).toBe("src");
    expect(w.get('[data-test="ai-cn-cell"]').text()).toContain("Exclude");
    expect(w.get('[data-test="ai-cn-cell"]').text()).toContain("replaces");
    expect(w.findAll('[data-test="ai-cn-exception"]')[0].text()).toContain("Boost ×3");
    await w.findAll('[data-test="ai-cn-exception"] [role="checkbox"]')[1].trigger("click");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("apply")?.[0]).toEqual([[cell], [exc]]);
  });
});

describe("follow-ups", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.draftDerivation).mockReset();
  });

  const answer = (summary: string) => ({
    rules: [
      { rule: { ...RULE, id: `r_${summary}` }, summary, warnings: [] },
      { rule: { ...RULE, id: `r_${summary}2` }, summary: `${summary} 2`, warnings: [] },
    ],
    skipped: [], model: "m", answer: { raw: summary },
  });

  it("refines with the conversation, flips between answers and starts over", async () => {
    const draft = vi.mocked(api.ai.draftDerivation);
    draft.mockResolvedValueOnce(answer("first")).mockResolvedValueOnce(answer("second"));
    const w = mount(AiDerivationPanel, { props: { name: "Titles", rules: [] } });
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("mages get a title");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].history).toBeUndefined();
    // The box is now a follow-up box; the first request is listed above it.
    expect((w.get('[data-test="ai-instruction"]').element as HTMLTextAreaElement).value).toBe("");
    expect(w.findAll('[data-test="ai-asked"]').map((x) => x.text())).toEqual(["mages get a title"]);
    expect(w.get('[data-test="ai-refine"]').attributes("disabled")).toBeDefined();
    await w.findAll('[data-test="ai-rule"] [role="checkbox"]')[1].trigger("click");
    await w.get('[data-test="ai-instruction"]').setValue("shorter titles");
    await w.get('[data-test="ai-refine"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[1][0]).toMatchObject({
      instruction: "shorter titles",
      history: [{
        instruction: "mages get a title", answer: { raw: "first" },
        note: "they kept first. They unticked first 2",
      }],
    });
    expect(w.findAll('[data-test="ai-asked"]').map((x) => x.text()))
      .toEqual(["mages get a title", "shorter titles"]);
    expect(w.text()).toContain("second 2");
    // Clicking the first step shows its answer; the refine stays listed.
    await w.findAll('[data-test="ai-asked"]')[0].trigger("click");
    expect(w.text()).toContain("first 2");
    expect(w.findAll('[data-test="ai-step"]').map((x) => x.attributes("data-after"))).toEqual(["false", "true"]);
    await w.get('[data-test="ai-restart"]').trigger("click");
    expect(w.find('[data-test="ai-rules-results"]').exists()).toBe(false);
    expect((w.get('[data-test="ai-instruction"]').element as HTMLTextAreaElement).value)
      .toBe("mages get a title");
  });

  it("Try again re-asks the shown answer's request with its history", async () => {
    const draft = vi.mocked(api.ai.draftDerivation);
    draft.mockResolvedValue(answer("x"));
    const w = mount(AiDerivationPanel, { props: { name: "Titles", rules: [] } });
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("go");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    await w.get('[data-test="ai-retry"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[1][0].instruction).toBe("go");
    expect(draft.mock.calls[1][0].history).toBeUndefined();
    // The try goes on the step's own switcher, not a new step.
    expect(w.findAll('[data-test="ai-step"]')).toHaveLength(1);
    expect(w.get('[data-test="ai-try-nav"]').text()).toContain("try 2 of 2");
    await w.get('[data-test="ai-try-prev"]').trigger("click");
    expect(w.get('[data-test="ai-try-nav"]').text()).toContain("try 1 of 2");
    // Adding ends the conversation.
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.find('[data-test="ai-thread"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-run"]').exists()).toBe(true);
  });
});
