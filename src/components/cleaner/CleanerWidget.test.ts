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
    clipTokenCount: null,
    clipTokenLimit: 77,
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

  it("renders CLIP token bar when clipTokenCount is provided", () => {
    const w = mount(CleanerWidget, {
      props: makeProps({}, { clipTokenCount: 58 }),
    });
    expect(w.find('[data-test="cleaner-clip-bar"]').exists()).toBe(true);
  });

  it("hides CLIP token bar when clipTokenCount is null", () => {
    const w = mount(CleanerWidget, { props: makeProps() });
    expect(w.find('[data-test="cleaner-clip-bar"]').exists()).toBe(false);
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
