import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ToggleRowView from "./ToggleRow.vue";
import type { ToggleRow } from "../../extension/toggles";
import type { ControlState, FocusSpotView } from "../../extension/toggle-control";

const base = {
  pickOne: false, parentName: "", blocked: false, needsOptions: [], groupOptions: [],
  groupId: "", outputsFull: false, indent: 0, editing: false, editable: false, shownOn: false, effOn: false,
};
const t = (style: ToggleRow["style"]): ToggleRow => ({
  id: "00000001", kind: "toggle", name: "Detailer", var: "detailer", on: false, pin: false, out: 0, style, control: "bypass",
});
const state: ControlState = { control: "bypass", active: true, hint: "Bypasses now: KSampler" };
const node: FocusSpotView = { key: "n:7", label: "KSampler", kind: "node", count: 1 };
const group: FocusSpotView = { key: "g:0", label: "Upscale", kind: "group", count: 3 };
const all: FocusSpotView = { key: "all", label: "All targets", kind: "all", count: 4 };

describe("ToggleRow mute / bypass icon", () => {
  it.each(["switch", "chip"] as const)("one place: a click shows it (%s)", async (style) => {
    const w = mount(ToggleRowView, { props: { ...base, t: t(style), controlState: state, focusSpots: [node] } });
    const btn = w.find('[data-test="tg-ctl-show-00000001"]');
    expect(btn.element.tagName).toBe("BUTTON");
    expect(btn.attributes("aria-label")).toBe("Show KSampler on the canvas");
    await btn.trigger("click");
    expect(w.emitted("show-target")).toEqual([["n:7"]]);
    w.unmount();
  });

  it("several places: the click opens a menu, a pick shows that one", async () => {
    const w = mount(ToggleRowView, { props: { ...base, t: t("chip"), controlState: state, focusSpots: [all, node, group] }, attachTo: document.body });
    const btn = w.find('[data-test="tg-ctl-show-00000001"]');
    expect(btn.attributes("aria-haspopup")).toBe("menu");
    await btn.trigger("click");
    await nextTick();
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent ?? "");
    expect(labels.some((l) => l.includes("All targets"))).toBe(true);
    expect(labels.some((l) => l.includes("Upscale"))).toBe(true);
    const pick = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => e.textContent?.includes("Upscale"));
    pick?.click();
    await nextTick();
    expect(w.emitted("show-target")).toEqual([["g:0"]]);
    w.unmount();
  });

  it("nothing to show: a plain icon", () => {
    const w = mount(ToggleRowView, { props: { ...base, t: t("switch"), controlState: state, focusSpots: [] } });
    expect(w.find('[data-test="tg-ctl-show-00000001"]').exists()).toBe(false);
    expect(w.find("i.wp-tgr__ctlicon.pi-forward").exists()).toBe(true);
    w.unmount();
  });
});
