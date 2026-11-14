import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TogglesWidget from "./TogglesWidget.vue";
import { ctlInputName } from "../../extension/toggle-control";
import { defaultTogglesConfig, parseTogglesConfig, type ToggleRow, type TogglesConfig } from "../../extension/toggles";

const row = (id: string, name: string, on: boolean, extra: Partial<ToggleRow> = {}): ToggleRow => ({
  id, kind: "toggle", name, var: name.toLowerCase(), on, pin: false, out: 0, style: "switch", ...extra,
});
const cfg = (mode: "any" | "one"): TogglesConfig => ({
  ...defaultTogglesConfig(),
  mode,
  layout: "grid",
  rows: [
    row("00000001", "Dawn", false, { control: "mute" }),
    row("00000002", "Sunset", false, { control: "bypass" }),
    row("00000003", "Night", true, { pin: true, out: 1 }),
  ],
});
function lastConfig(w: { emitted: (e: string) => unknown[][] | undefined }): TogglesConfig | undefined {
  const all = w.emitted("update:modelValue");
  return all?.[all.length - 1]?.[0] as TogglesConfig | undefined;
}

describe("TogglesWidget Grid layout", () => {
  it("keeps layout and merged lines through a parse", () => {
    const back = parseTogglesConfig(JSON.stringify({ ...cfg("any"), sockets_merged: true }));
    expect(back.layout).toBe("grid");
    expect(back.sockets_merged).toBe(true);
  });

  it.each(["any", "one"] as const)("draws the toggles as tiles in %s mode, with no dots on the tiles", (mode) => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg(mode) } });
    const grid = w.find('[data-test="tg-grid"]');
    expect(grid.exists()).toBe(true);
    expect(grid.find('[data-test="tg-row-00000001"]').exists()).toBe(true);
    expect(grid.find("[data-wp-out]").exists()).toBe(false);
    expect(grid.find("[data-wp-socket]").exists()).toBe(false);
    w.unmount();
  });

  it("packs control dots on the left and outputs on the right, each side on its own", () => {
    const c = cfg("one");
    c.rows = [
      row("00000001", "Dawn", false, { control: "mute", pin: true, out: 1 }),
      row("00000002", "Sunset", false, { control: "bypass" }),
      row("00000003", "Night", true, { pin: true, out: 2 }),
      row("00000004", "Noon", false),
    ];
    const w = mount(TogglesWidget, { props: { modelValue: c } });
    const lines = w.findAll('[data-test^="tg-sockline-top-"]');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.attributes("data-wp-socket")).toBe(ctlInputName("00000001"));
    expect(lines[0]?.attributes("data-wp-out")).toBe("toggle_1");
    expect(lines[1]?.attributes("data-wp-socket")).toBe(ctlInputName("00000002"));
    expect(lines[1]?.attributes("data-wp-out")).toBe("toggle_2");
    expect(lines[1]?.text()).toContain("Sunset");
    expect(lines[1]?.text()).toContain("Night");
    w.unmount();
  });

  it("merges the socket lines into one that carries every dot, and opens them again", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg("any") } });
    await w.find('[data-test="tg-sock-merge"]').trigger("click");
    const merged = lastConfig(w);
    expect(merged?.sockets_merged).toBe(true);
    await w.setProps({ modelValue: merged });
    const line = w.find('[data-test="tg-sockmerged-top"]');
    expect(line.attributes("data-wp-out")).toBe("toggle_1");
    expect(line.attributes("data-wp-socket")).toBeTruthy();
    expect(w.find('[data-test="tg-sockline-top-0"]').exists()).toBe(false);
    // A count per side, not every name, so many wires don't crowd it.
    expect(line.text()).toContain("2 in");
    expect(line.text()).toContain("1 out");
    expect(line.text()).not.toContain("Sunset");
    await w.find('[data-test="tg-sock-expand"]').trigger("click");
    expect(lastConfig(w)?.sockets_merged).toBeUndefined();
    w.unmount();
  });

  it("keeps rows in the edit view, where the Layout switch lives", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: { ...cfg("any"), layout: undefined }, editRequest: 0 } });
    expect(w.find('[data-test="tg-grid"]').exists()).toBe(false);
    await w.setProps({ editRequest: 1 });
    expect(w.find('[data-test="tg-grid"]').exists()).toBe(false);
    await w.find('[data-test="tg-layout-grid"]').trigger("click");
    expect(lastConfig(w)?.layout).toBe("grid");
    w.unmount();
  });

  it("lets a group pick its own layout and merge its own lines", async () => {
    const grouped: TogglesConfig = {
      ...defaultTogglesConfig(),
      rows: [
        row("00000001", "Top", false),
        { id: "0000000a", kind: "label", name: "Light", color: 2, layout: "grid" },
        row("00000002", "Rim", false, { control: "mute" }),
        row("00000003", "Fog", false, { pin: true, out: 1 }),
        row("00000004", "Rain", false, { control: "bypass" }),
      ],
    };
    const w = mount(TogglesWidget, { props: { modelValue: grouped, editRequest: 0 } });
    const grids = w.findAll('[data-test="tg-grid"]');
    expect(grids).toHaveLength(1);
    expect(grids[0]?.find('[data-test="tg-row-00000002"]').exists()).toBe(true);
    expect(w.find('[data-test="tg-row-00000001"]').exists()).toBe(true);
    await w.find('[data-test="tg-sock-merge"]').trigger("click");
    const merged = lastConfig(w);
    expect(merged?.sockets_merged).toBeUndefined();
    expect(merged?.rows.find((r) => r.id === "0000000a")).toMatchObject({ sockets_merged: true });
    await w.setProps({ modelValue: merged });
    expect(w.find('[data-test="tg-sockmerged-0000000a"]').exists()).toBe(true);
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="tg-glayout-0000000a"]').trigger("click");
    expect(lastConfig(w)?.rows.find((r) => r.id === "0000000a")).not.toHaveProperty("layout", "grid");
    w.unmount();
  });
});

describe("TogglesWidget folded group", () => {
  it("puts its toggles' control inputs on the folded title too", () => {
    const c: TogglesConfig = {
      ...defaultTogglesConfig(),
      rows: [
        { id: "0000000a", kind: "label", name: "G", color: 1, collapsed: true },
        row("00000001", "A", false, { control: "mute", pin: true, out: 1 }),
      ],
    };
    const w = mount(TogglesWidget, { props: { modelValue: c } });
    const title = w.find('[data-test="tg-label-0000000a"]');
    expect(title.attributes("data-wp-socket")).toBe(ctlInputName("00000001"));
    expect(title.attributes("data-wp-out")).toBe("toggle_1");
    w.unmount();
  });
});

describe("TogglesWidget edit-view drag", () => {
  const grouped = (): TogglesConfig => ({
    ...defaultTogglesConfig(),
    rows: [
      row("00000001", "Top", false),
      { id: "0000000a", kind: "label", name: "Light", color: 2 },
      row("00000002", "Rim", false),
      row("00000003", "Fog", false),
      { id: "0000000b", kind: "label", name: "Sky", color: 3 },
      row("00000004", "Rain", false),
    ],
  });

  it("drops a toggle below a group, into no group, with a full-width line", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: grouped(), editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    const list = w.findComponent({ name: "SortableList" });
    const dropLine = list.props("dropLine") as (d: { from: number; over: number; edge: string }, noOp: boolean) => unknown;
    // Shown: Top, Light, Rim, Fog, Sky, Rain. Top before Sky: below Light.
    expect(dropLine({ from: 0, over: 4, edge: "before" }, false)).toBe(true);
    // Top after Rim: inside Light, an inset line in its colour.
    expect(dropLine({ from: 0, over: 2, edge: "after" }, false)).toMatchObject({ inset: 22, color: "var(--wp-var-2)" });
    // A label can't land inside another group.
    expect(dropLine({ from: 4, over: 2, edge: "after" }, false)).toBe(false);
    list.vm.$emit("drop", { from: 0, over: 4, edge: "before", to: 3 });
    const out = lastConfig(w);
    expect(out?.rows.map((r) => r.id)).toEqual(["0000000a", "00000002", "00000003", "00000001", "0000000b", "00000004"]);
    expect(out?.rows.find((r) => r.id === "00000001")).toMatchObject({ ungrouped: true });
    w.unmount();
  });

  it("draws a toggle below a group outside it in the clean view", () => {
    const c = grouped();
    c.rows = [c.rows[1], c.rows[2], { ...(c.rows[0] as ToggleRow), ungrouped: true }, c.rows[4], c.rows[5]];
    const w = mount(TogglesWidget, { props: { modelValue: c } });
    const top = w.find('[data-test="tg-row-00000001"]');
    expect(top.exists()).toBe(true);
    expect(top.element.closest(".wp-tg__member.is-grouped")).toBeNull();
    w.unmount();
  });
});

describe("TogglesWidget Show node", () => {
  it("unfolds the label group that holds the toggle WP Debug points at", async () => {
    const config: TogglesConfig = {
      ...defaultTogglesConfig(),
      mode: "any",
      rows: [
        { id: "0000000a", kind: "label", name: "Weather", color: 1, collapsed: true },
        row("00000001", "Rain", false),
        { id: "0000000b", kind: "label", name: "Light", color: 2, collapsed: true },
        row("00000002", "Sun", true),
      ],
    };
    const w = mount(TogglesWidget, { props: { modelValue: config } });
    const root = w.find("[data-wp-reveal]");
    expect(root.exists()).toBe(true);
    root.element.dispatchEvent(new CustomEvent("wp-reveal", { detail: { vars: ["rain"] } }));
    const next = lastConfig(w);
    const labels = next?.rows.filter((r) => r.kind === "label").map((r) => [r.name, r.kind === "label" && r.collapsed === true]);
    expect(labels).toEqual([["Weather", false], ["Light", true]]);
    w.unmount();
  });

  it("changes nothing when the toggle is already in sight", () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg("any") } });
    w.find("[data-wp-reveal]").element.dispatchEvent(new CustomEvent("wp-reveal", { detail: { vars: ["dawn"] } }));
    expect(w.emitted("update:modelValue")).toBeUndefined();
    w.unmount();
  });
});
