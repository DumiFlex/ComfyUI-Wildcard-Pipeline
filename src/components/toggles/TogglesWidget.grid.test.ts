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
    await w.find('[data-test="tg-glayout-0000000a-rows"]').trigger("click");
    expect(lastConfig(w)?.rows.find((r) => r.id === "0000000a")).not.toHaveProperty("layout", "grid");
    w.unmount();
  });
});
