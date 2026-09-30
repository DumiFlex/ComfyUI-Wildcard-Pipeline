import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import CleanerWidget from "./CleanerWidget.vue";
import { emptyCleanerConfig, type CleanerNodeConfig } from "./types";

function makeProps(overrides: Partial<CleanerNodeConfig> = {}, extra: object = {}) {
  return {
    modelValue: { ...emptyCleanerConfig(), ...overrides },
    lastRunReport: null,
    wordCount: 0,
    charCount: 0,
    ...extra,
  };
}

describe("CleanerWidget", () => {
  it("renders mode toggle + intensity segment + 8 rule rows", () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    expect(w.find('[data-test="cleaner-mode-tags"]').exists()).toBe(true);
    expect(w.find('[data-test="cleaner-mode-text"]').exists()).toBe(true);
    expect(w.find('[data-test="cleaner-intensity-gentle"]').exists()).toBe(true);
    expect(w.find('[data-test="cleaner-intensity-balanced"]').exists()).toBe(true);
    expect(w.find('[data-test="cleaner-intensity-aggressive"]').exists()).toBe(true);
    expect(w.findAll('[data-test^="cleaner-rule-"]:not([data-test$="-stat"])')).toHaveLength(5);
  });

  it("CUSTOM badge marked visible when modified", () => {
    const w = mount(CleanerWidget, { props: makeProps({ rules_override: { fuzzy_dedupe: true } }) });
    const badge = w.find('[data-test="cleaner-custom-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).not.toContain("is-hidden");
  });

  it("CUSTOM badge marked hidden in pristine state", () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    const badge = w.find('[data-test="cleaner-custom-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).toContain("is-hidden");
  });

  it("clicking an intensity emits update:modelValue with new intensity", async () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    await w.find('[data-test="cleaner-intensity-aggressive"]').trigger("click");
    const emits = w.emitted("update:modelValue");
    expect(emits).toBeTruthy();
    expect((emits?.[0]?.[0] as CleanerNodeConfig).intensity).toBe("aggressive");
  });

  it("clicking a rule row toggles rules_override", async () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    await w.find('[data-test="cleaner-rule-dedupe_exact"]').trigger("click");
    const emits = w.emitted("update:modelValue");
    expect((emits?.[0]?.[0] as CleanerNodeConfig).rules_override.dedupe_exact).toBe(false);
  });

  it("renders last-run stats next to active rules", () => {
    const w = mount(CleanerWidget, {
      props: makeProps({}, {
        lastRunReport: { whitespace: { fixed: 3 }, dedupe_exact: { dropped: ["foo"] } },
        wordCount: 42, charCount: 187,
      }),
    });
    expect(w.find('[data-test="cleaner-rule-whitespace-stat"]').text()).toContain("3");
    expect(w.find('[data-test="cleaner-rule-dedupe_exact-stat"]').text()).toContain("1");
  });

  it("blocklist button shows entry count when populated", () => {
    const w = mount(CleanerWidget, {
      props: makeProps({ blocklist: { kind: "list", entries: ["a", "b", "c"] } }),
    });
    expect(w.find('[data-test="cleaner-blocklist-btn"]').text()).toContain("3");
  });

  it("clicking blocklist button emits open-blocklist", async () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    await w.find('[data-test="cleaner-blocklist-btn"]').trigger("click");
    expect(w.emitted("open-blocklist")).toBeTruthy();
  });

});

describe("CleanerWidget — neg column (send-to-negative)", () => {
  function lastEmit(w: ReturnType<typeof mount>): CleanerNodeConfig {
    const emits = w.emitted("update:modelValue") ?? [];
    return emits[emits.length - 1][0] as CleanerNodeConfig;
  }

  it("neg toggles default from the preset: fuzzy dedupe + blocklist off", () => {
    const w = mount(CleanerWidget, {
      props: makeProps({ intensity: "aggressive", blocklist: { kind: "list", entries: ["x"] } }),
    });
    const on = (rid: string) => w.find(`[data-test="cleaner-neg-rule-${rid}"]`).classes().includes("is-on");
    expect(on("whitespace")).toBe(true);
    expect(on("dedupe_exact")).toBe(true);
    expect(on("fuzzy_dedupe")).toBe(false);
    expect(on("blocklist")).toBe(false);
    // The prompt column still has both on under aggressive + entries.
    expect(w.find('[data-test="cleaner-rule-fuzzy_dedupe"]').classes()).toContain("is-on");
  });

  it("a neg toggle stores negative_rules_override only when it differs, and marks CUSTOM", async () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    await w.find('[data-test="cleaner-neg-rule-fuzzy_dedupe"]').trigger("click");
    const next = lastEmit(w);
    expect(next.negative_rules_override).toEqual({ fuzzy_dedupe: true });
    expect(next.rules_override).toEqual({});

    const custom = mount(CleanerWidget, { props: makeProps({ negative_rules_override: { fuzzy_dedupe: true } }) });
    expect(custom.find('[data-test="cleaner-custom-badge"]').classes()).not.toContain("is-hidden");
    // Toggling back to the default drops the key entirely.
    await custom.find('[data-test="cleaner-neg-rule-fuzzy_dedupe"]').trigger("click");
    expect(lastEmit(custom)).not.toHaveProperty("negative_rules_override");
  });

  it("a preset prunes neg overrides that match its default", async () => {
    const w = mount(CleanerWidget, {
      props: makeProps({ intensity: "gentle", negative_rules_override: { dedupe_exact: true } }),
    });
    await w.find('[data-test="cleaner-intensity-balanced"]').trigger("click");
    const next = lastEmit(w);
    expect(next.intensity).toBe("balanced");
    expect(next).not.toHaveProperty("negative_rules_override");
  });

  it("drop-overlap row is off by default and stored only when on", async () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    const btn = w.find('[data-test="cleaner-drop-overlap"]');
    expect(btn.classes()).not.toContain("is-on");
    await btn.trigger("click");
    expect(lastEmit(w).drop_prompt_overlap).toBe(true);
    const on = mount(CleanerWidget, { props: makeProps({ drop_prompt_overlap: true }) });
    await on.find('[data-test="cleaner-drop-overlap"]').trigger("click");
    expect(lastEmit(on)).not.toHaveProperty("drop_prompt_overlap");
  });

  it("last run shows a negative line and the counter a negative count", () => {
    const w = mount(CleanerWidget, {
      props: makeProps({}, {
        lastRunReport: { dedupe_exact: { dropped: ["a", "b"] }, blocklist: { dropped: ["c"] } },
        wordCount: 42,
        charCount: 187,
        negativeReport: {
          dedupe_exact: { dropped: ["x", "y", "z"] },
          prompt_overlap: { tags: ["red"], dropped: false },
        },
        negativeWordCount: 11,
      }),
    });
    expect(w.find('[data-test="cleaner-neg-count"]').text()).toBe("negative 11");
    expect(w.find('[data-test="cleaner-last-run"]').text()).toContain("prompt: 2 duplicates, 1 blocklisted");
    expect(w.find('[data-test="cleaner-last-run-neg"]').text()).toBe(
      'negative: 3 duplicates · 1 tag also in prompt: "red"',
    );
  });

  it("no negative report = no last-run block and no negative count", () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    expect(w.find('[data-test="cleaner-last-run"]').exists()).toBe(false);
    expect(w.find('[data-test="cleaner-neg-count"]').exists()).toBe(false);
  });
});
