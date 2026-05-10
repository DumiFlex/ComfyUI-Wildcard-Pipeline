import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DebugViewer from "./DebugViewer.vue";

const SAMPLE_SNAPSHOT = JSON.stringify({
  hair_style: "long flowing",
  mood: "joyful",
  __wp_picks__: { abc12345: { value: "long flowing", sub_category: "long" } },
  __wp_constraints__: [{ source: "abc12345", target: "def67890" }],
  // Trace entry includes `writes[].variable` so the picks-tab lookup
  // can re-key `abc12345 → $hair_style` instead of showing the raw uuid.
  __wp_trace__: [
    {
      id: "abc12345",
      type: "wildcard",
      status: "ok",
      seed: 4231,
      writes: [{ variable: "hair_style", value: "long flowing", source: "wildcard" }],
    },
  ],
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

  it("Trace tab badge shows the entry count", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const traceTab = wrapper.findAll(".wp-dbg-tab")[1];
    expect(traceTab.text()).toMatch(/Trace\s*1/);
  });

  it("Trace tab renders $variable labels not raw module ids", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labelCells = wrapper.findAll(".wp-dbg-trace-label");
    expect(labelCells.length).toBe(1);
    expect(labelCells[0].text()).toContain("$hair_style");
  });

  it("Trace tab renders status pill with ok variant", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.find(".wp-dbg-trace-pill--ok").exists()).toBe(true);
  });

  it("Trace tab renders error pill + row tint when entry has error", async () => {
    const errSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "fff00000",
          type: "wildcard",
          status: "failed",
          error: { type: "ValueError", message: "missing target" },
          writes: [],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: errSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.find(".wp-dbg-trace-pill--error").exists()).toBe(true);
    expect(wrapper.find(".wp-dbg-trace-row--error").exists()).toBe(true);
  });

  it("Picks tab re-keys raw module ids to $variable_name via trace lookup", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const keyCells = wrapper.findAll(".wp-dbg-pick-key");
    expect(keyCells.length).toBe(1);
    expect(keyCells[0].text()).toBe("$hair_style");
    // Value column shows the picked option's `value` field, not raw JSON.
    const valCell = wrapper.find(".wp-dbg-pick-val");
    expect(valCell.text()).toBe("long flowing");
    // Sub-category shown as a chip when present.
    expect(wrapper.find(".wp-dbg-pick-cat").text()).toBe("long");
  });

  it("Picks tab falls back to short uuid when trace doesn't carry the variable", async () => {
    const orphanSnap = JSON.stringify({
      __wp_picks__: { ffeeddcc11: { value: "orphaned" } },
      __wp_trace__: [],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: orphanSnap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const keyCell = wrapper.find(".wp-dbg-pick-key");
    expect(keyCell.text()).toBe("$ffeeddcc");
  });
});
