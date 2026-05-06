import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DebugViewer from "./DebugViewer.vue";

const SAMPLE_SNAPSHOT = JSON.stringify({
  hair_style: "long flowing",
  mood: "joyful",
  __wp_picks__: { abc12345: { value: "long flowing", sub_category: "long" } },
  __wp_constraints__: [{ source: "abc12345", target: "def67890" }],
  __wp_trace__: [{ id: "abc12345", seed: 42 }],
  __wp_warnings__: [{ type: "duplicate_variable", detail: "$hair_style" }],
});

describe("DebugViewer", () => {
  it("renders four tabs: Snapshot, Trace, Picks, Warnings", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const tabs = wrapper.findAll(".wp-dbg-tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].text()).toContain("Snapshot");
    expect(tabs[1].text()).toContain("Trace");
    expect(tabs[2].text()).toContain("Picks");
    expect(tabs[3].text()).toContain("Warnings");
  });

  it("Snapshot tab is active by default", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const active = wrapper.find(".wp-dbg-tab.is-active");
    expect(active.text()).toContain("Snapshot");
  });

  it("clicking a tab makes it active and swaps the body", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.find(".wp-dbg-tab.is-active").text()).toContain("Trace");
  });

  it("Picks tab badge shows the count of __wp_picks__ entries", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const picksTab = wrapper.findAll(".wp-dbg-tab")[2];
    expect(picksTab.text()).toMatch(/Picks\s*1/);
  });

  it("Warnings tab badge shows the warn count + warn-tone class", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const warnTab = wrapper.findAll(".wp-dbg-tab")[3];
    expect(warnTab.text()).toMatch(/Warnings\s*1/);
    expect(warnTab.find(".wp-dbg-tab-badge--warn").exists()).toBe(true);
  });

  it("renders copy + download buttons in the toolbar", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    expect(wrapper.find('[data-test="dbg-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dbg-download"]').exists()).toBe(true);
  });

  it("renders empty state when snapshot is empty", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: "" } });
    expect(wrapper.text()).toContain("Run the graph");
  });
});
