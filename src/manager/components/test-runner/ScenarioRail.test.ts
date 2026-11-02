import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ScenarioRail from "./ScenarioRail.vue";

const base = { scenarios: [], activeId: null, quickRunName: null, rerun: null };

describe("ScenarioRail loading", () => {
  it("draws skeleton lines, not 'No saved scenarios yet', while loading", () => {
    const w = mount(ScenarioRail, { props: { ...base, loading: true } });
    expect(w.find('[data-test="scenario-skeleton"]').exists()).toBe(true);
    expect(w.text()).not.toContain("No saved scenarios yet");
  });

  it("says there are none once loaded empty", () => {
    const w = mount(ScenarioRail, { props: { ...base, loading: false } });
    expect(w.find('[data-test="scenario-skeleton"]').exists()).toBe(false);
    expect(w.text()).toContain("No saved scenarios yet");
  });
});
