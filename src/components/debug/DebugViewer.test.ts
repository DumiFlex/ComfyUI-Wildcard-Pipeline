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

  it("Trace tab fans out multi-write modules into one row per binding", async () => {
    const multi = JSON.stringify({
      __wp_trace__: [
        {
          id: "fixedmod1",
          type: "fixed_values",
          status: "ok",
          writes: [
            { variable: "alpha", value: "v1" },
            { variable: "beta", value: "v2" },
            { variable: "gamma", value: "v3" },
          ],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: multi } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const rows = wrapper.findAll(".wp-dbg-trace-row").filter(
      (r) => !r.classes("wp-dbg-trace-row--head"),
    );
    expect(rows.length).toBe(3);
    const labels = wrapper.findAll(".wp-dbg-trace-label").map((el) => el.text());
    expect(labels).toEqual(["$alpha", "$beta", "$gamma"]);
  });

  it("Trace tab applies kind-chip color class per module type", async () => {
    const mixed = JSON.stringify({
      __wp_trace__: [
        { id: "w1", type: "wildcard",     status: "ok", writes: [{ variable: "a", value: "x" }] },
        { id: "f1", type: "fixed_values", status: "ok", writes: [{ variable: "b", value: "y" }] },
        { id: "c1", type: "combine",      status: "ok", writes: [{ variable: "c", value: "z" }] },
        { id: "d1", type: "derivation",   status: "ok", writes: [{ variable: "d", value: "w" }] },
        { id: "k1", type: "constraint",   status: "ok", writes: [] },
        { node: "WP_ContextInjector", binding: "inj1", type: "str", status: "ok" },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: mixed } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const types = wrapper.findAll(".wp-dbg-trace-type");
    expect(types[0].classes()).toContain("wp-kind-chip--wildcard");
    expect(types[1].classes()).toContain("wp-kind-chip--fixed");
    expect(types[2].classes()).toContain("wp-kind-chip--combine");
    expect(types[3].classes()).toContain("wp-kind-chip--derivation");
    expect(types[4].classes()).toContain("wp-kind-chip--constraint");
    // Injector trace's `type` field is "str" (from injector_node.py),
    // doesn't map to a known kind — falls back to unknown variant.
    expect(types[5].classes()).toContain("wp-kind-chip--unknown");
  });

  it("Trace row for module with no bindings still surfaces (constraint-style)", async () => {
    const constraintSnap = JSON.stringify({
      __wp_trace__: [
        { id: "constraintabc", type: "constraint", status: "ok", writes: [] },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: constraintSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labels = wrapper.findAll(".wp-dbg-trace-label");
    expect(labels.length).toBe(1);
    // Falls back to short-uuid label since no binding to display.
    expect(labels[0].text()).toBe("$constrai");
  });

  it("Trace seed cell renders the full seed (no truncation)", async () => {
    const fullSeedSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "abc12345",
          type: "wildcard",
          status: "ok",
          seed: 4932922958855935,
          writes: [{ variable: "x", value: "v" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: fullSeedSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    // The clickable variant is the data row (header row uses a plain
    // `<span>` for the column label, not a button).
    const seedCell = wrapper.find(".wp-dbg-trace-seed--clickable");
    expect(seedCell.text()).toBe("4932922958855935");
    expect(seedCell.text()).not.toContain("…");
  });

  it("Trace seed cell renders as a clickable button with copy title", async () => {
    const fullSeedSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "abc12345",
          type: "wildcard",
          status: "ok",
          seed: 12345,
          writes: [{ variable: "x", value: "v" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: fullSeedSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const seedBtn = wrapper.find(".wp-dbg-trace-seed--clickable");
    expect(seedBtn.exists()).toBe(true);
    expect(seedBtn.element.tagName).toBe("BUTTON");
    expect(seedBtn.attributes("title")).toBe("Click to copy seed");
  });

  it("Picks tab resolves @{uuid} refs in value to @{$varname}", async () => {
    const refSnap = JSON.stringify({
      __wp_picks__: {
        backdrop1: {
          value: "minimal interior with @{a361dbdc} accents",
          sub_category: "indoor",
        },
      },
      __wp_trace__: [
        {
          id: "backdrop1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "backdrop", value: "minimal interior with linen accents" }],
        },
        {
          id: "a361dbdc",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "fabric", value: "linen" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: refSnap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const valCell = wrapper.find(".wp-dbg-pick-val");
    expect(valCell.text()).toBe("minimal interior with @{$fabric} accents");
  });

  it("Picks tab leaves unknown @{uuid} refs unchanged", async () => {
    const orphanRefSnap = JSON.stringify({
      __wp_picks__: {
        m1: { value: "see @{deadbeef} stuff" },
      },
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "x", value: "see @{deadbeef} stuff" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: orphanRefSnap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const valCell = wrapper.find(".wp-dbg-pick-val");
    expect(valCell.text()).toBe("see @{deadbeef} stuff");
  });
});
