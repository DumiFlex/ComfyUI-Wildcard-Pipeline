import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ToggleRowView from "./ToggleRow.vue";
import type { ToggleRow } from "../../extension/toggles";

const row = (on: boolean): ToggleRow => ({
  id: "00000001", kind: "toggle", name: "Detailer", var: "detailer", on, pin: false, out: 0, style: "buttons",
});

const base = {
  pickOne: false, parentName: "", blocked: false, needsOptions: [], groupOptions: [],
  groupId: "", outputsFull: false, indent: 0, editing: false, editable: false,
};

describe("ToggleRow buttons", () => {
  it.each([true, false])("a click on the lit side flips it (on: %s)", async (on) => {
    const w = mount(ToggleRowView, { props: { ...base, t: row(on), shownOn: on, effOn: on } });
    await w.find(`[data-test="tg-ctl-00000001-${on ? "on" : "off"}"]`).trigger("click");
    expect(w.emitted("set-on")).toEqual([[!on]]);
    w.unmount();
  });

  it("a click on the other side switches once", async () => {
    const w = mount(ToggleRowView, { props: { ...base, t: row(false), shownOn: false, effOn: false } });
    await w.find('[data-test="tg-ctl-00000001-on"]').trigger("click");
    expect(w.emitted("set-on")).toEqual([[true]]);
    w.unmount();
  });

  it("switches once even when the row re-renders before the click bubbles up", async () => {
    // On the canvas the row's new state is drawn while the click is still on its way
    // up, so a handler that ran after the kit's saw the side it had just lit.
    let w: ReturnType<typeof mount> | null = null;
    const relight = (): void => {
      w?.find('[data-test="tg-ctl-00000001-on"]').element.setAttribute("data-active", "true");
      w?.find('[data-test="tg-ctl-00000001-off"]').element.setAttribute("data-active", "false");
    };
    w = mount(ToggleRowView, { props: { ...base, t: row(false), shownOn: false, effOn: false, "onSet-on": relight } });
    await w.find('[data-test="tg-ctl-00000001-on"]').trigger("click");
    expect(w.emitted("set-on")).toEqual([[true]]);
    w.unmount();
  });

  it("does nothing while blocked", async () => {
    const w = mount(ToggleRowView, { props: { ...base, t: row(true), shownOn: true, effOn: true, blocked: true } });
    await w.find('[data-test="tg-ctl-00000001-on"]').trigger("click");
    expect(w.emitted("set-on")).toBeUndefined();
    w.unmount();
  });
});
