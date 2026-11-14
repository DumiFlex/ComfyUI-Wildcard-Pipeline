import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TogglesWidget from "./TogglesWidget.vue";
import ToggleRowView from "./ToggleRow.vue";
import Checkbox from "@/kit/Checkbox.vue";
import {
  defaultTogglesConfig, effectiveToggles, parseTogglesConfig, pickedId,
  type ToggleRow, type TogglesConfig,
} from "../../extension/toggles";

const row = (id: string, name: string, on: boolean): ToggleRow => ({
  id, kind: "toggle", name, var: name.toLowerCase(), on, pin: false, out: 0, style: "switch",
});
const cfg = (required: boolean, ons: [boolean, boolean, boolean]): TogglesConfig => ({
  ...defaultTogglesConfig(),
  mode: "one",
  ...(required ? { pick_required: true as const } : {}),
  rows: [row("00000001", "Dawn", ons[0]), row("00000002", "Noon", ons[1]), row("00000003", "Dusk", ons[2])],
});
function lastConfig(w: { emitted: (e: string) => unknown[][] | undefined }): TogglesConfig | undefined {
  const all = w.emitted("update:modelValue");
  return all?.[all.length - 1]?.[0] as TogglesConfig | undefined;
}
function rowView(w: ReturnType<typeof mount>, id: string) {
  const v = w.findAllComponents(ToggleRowView).find((c) => c.props("t").id === id);
  if (!v) throw new Error(`no row ${id}`);
  return v;
}

describe("Pick one: Always one on", () => {
  it("keeps the flag through a parse, and only as true", () => {
    expect(parseTogglesConfig(JSON.stringify(cfg(true, [false, true, false]))).pick_required).toBe(true);
    expect(parseTogglesConfig(JSON.stringify({ ...cfg(false, [false, true, false]), pick_required: false })).pick_required).toBeUndefined();
  });

  it("picks the first toggle when none is on", () => {
    expect(pickedId(cfg(true, [false, false, false]))).toBe("00000001");
    expect(pickedId(cfg(false, [false, false, false]))).toBeUndefined();
    expect(effectiveToggles(cfg(true, [false, false, false])).get("00000001")).toBe(true);
  });

  it("the picked toggle can't be switched off; picking another still works", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg(true, [false, true, false]) } });
    rowView(w, "00000002").vm.$emit("set-on", false);
    await w.vm.$nextTick();
    expect(w.emitted("update:modelValue")).toBeUndefined();
    rowView(w, "00000003").vm.$emit("set-on", true);
    await w.vm.$nextTick();
    const next = lastConfig(w);
    expect(next?.rows.map((r) => (r.kind === "toggle" ? r.on : null))).toEqual([false, false, true]);
    w.unmount();
  });

  it("without it, the picked toggle switches off (none on)", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg(false, [false, true, false]) } });
    rowView(w, "00000002").vm.$emit("set-on", false);
    await w.vm.$nextTick();
    expect(lastConfig(w)?.rows.every((r) => r.kind !== "toggle" || !r.on)).toBe(true);
    w.unmount();
  });

  it("turning it on with none on switches the first toggle on", async () => {
    const w = mount(TogglesWidget, { props: { modelValue: cfg(false, [false, false, false]), editRequest: 0 } });
    await w.setProps({ editRequest: 1 });
    const box = w.findAllComponents(Checkbox).find((c) => c.attributes("data-test") === "tg-pick-required");
    if (!box) throw new Error("no Always one on box");
    box.vm.$emit("update:modelValue", true);
    await w.vm.$nextTick();
    const next = lastConfig(w);
    expect(next?.pick_required).toBe(true);
    expect(next?.rows.map((r) => (r.kind === "toggle" ? r.on : null))).toEqual([true, false, false]);
    box.vm.$emit("update:modelValue", false);
    await w.vm.$nextTick();
    expect(lastConfig(w)?.pick_required).toBeUndefined();
    w.unmount();
  });
});
