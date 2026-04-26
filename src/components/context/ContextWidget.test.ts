import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import ContextWidget from "./ContextWidget.vue";

afterEach(() => {
  // Modals teleport to body — strip leftover overlays between tests.
  document.body.innerHTML = "";
});

const moduleJson = (vars: Array<{ name: string; value: string }>): string =>
  JSON.stringify({
    version: 1,
    modules: [
      {
        id: "m1",
        type: "fixed_values",
        enabled: true,
        meta: { name: "test mod", description: "", tags: [] },
        entries: vars.map((v) => ({ variable_name: v.name, value: v.value })),
      },
    ],
  });

describe("ContextWidget.vue", () => {
  it("renders an empty state when no modules", () => {
    const wrapper = mount(ContextWidget, {
      props: { nodeId: 1, initialJson: '{"version":1,"modules":[]}', upstreamVars: [], onChange: () => {} },
    });
    // Empty hero shows the brand title + the "Add your first module" CTA.
    expect(wrapper.text()).toContain("Wildcard Pipeline");
    expect(wrapper.text()).toContain("Add your first module");
  });

  it("opens picker, picks fixed_values, emits new JSON via onChange", async () => {
    let last = "";
    const wrapper = mount(ContextWidget, {
      attachTo: document.body,
      props: { nodeId: 2, initialJson: '{"version":1,"modules":[]}', upstreamVars: [], onChange: (v: string) => { last = v; } },
    });
    await wrapper.find('[data-testid="open-picker"]').trigger("click");
    const pick = document.querySelector<HTMLButtonElement>('[data-testid="pick-fixed_values"]');
    expect(pick).not.toBeNull();
    pick!.click();
    await wrapper.vm.$nextTick();
    expect(last).toMatch(/"type":"fixed_values"/);
  });

  it("renders a summary line per module — first 2 vars + '+N more' for the rest", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 3,
        initialJson: moduleJson([
          { name: "style", value: "noir" },
          { name: "subject", value: "fox" },
          { name: "mood", value: "calm" },
          { name: "light", value: "soft" },
        ]),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const summary = wrapper.find(".wp-summary");
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toBe("$style, $subject, +2 more");
  });

  it("module name renders read-only as text (not an input)", () => {
    const wrapper = mount(ContextWidget, {
      props: { nodeId: 4, initialJson: moduleJson([]), upstreamVars: [], onChange: () => {} },
    });
    expect(wrapper.find("input.wp-module-name").exists()).toBe(false);
    expect(wrapper.find(".wp-module-name").text()).toBe("test mod");
  });

  it("summary line is read-only — not a button, no click handler", () => {
    const wrapper = mount(ContextWidget, {
      props: {
        nodeId: 5,
        initialJson: moduleJson([{ name: "style", value: "noir" }]),
        upstreamVars: [],
        onChange: () => {},
      },
    });
    const summary = wrapper.find(".wp-summary");
    expect(summary.exists()).toBe(true);
    // Read-only div, not a button — edit access is via right-click → Edit
    // or Enter on the focused card.
    expect(summary.element.tagName).toBe("DIV");
  });
});
