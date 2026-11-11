import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToggleRow from "../ToggleRow.vue";
import type { ToggleRow as Row } from "../../../extension/toggles";

const base: Row = { id: "a", kind: "toggle", name: "Dawn", var: "dawn", on: true, pin: false, out: 0, style: "switch" };

function mountRow(t: Row, extra: { editable?: boolean; pickOne?: boolean; editing?: boolean } = {}) {
  return mount(ToggleRow, {
    attachTo: document.body,
    props: {
      t, pickOne: extra.pickOne ?? false, shownOn: true, effOn: true, parentName: "", blocked: false, indent: 0,
      editing: extra.editing ?? false, needsOptions: [], groupOptions: [], groupId: "", outputsFull: false,
      editable: extra.editable ?? true,
    },
  });
}

describe("ToggleRow internal button", () => {
  it("is pressed by default and turning it off shows the variable in the Assembler", async () => {
    const w = mountRow(base);
    const btn = w.find('[data-test="tg-internal-a"]');
    expect(btn.attributes("aria-pressed")).toBe("true");
    await btn.trigger("click");
    expect(w.emitted("patch")?.[0]).toEqual([{ visible: true }]);
    w.unmount();
  });

  it("turning it back on clears visible", async () => {
    const w = mountRow({ ...base, visible: true });
    const btn = w.find('[data-test="tg-internal-a"]');
    expect(btn.attributes("aria-pressed")).toBe("false");
    await btn.trigger("click");
    expect(w.emitted("patch")?.[0]).toEqual([{ visible: undefined }]);
    w.unmount();
  });

  it("only shows in the edit view, in both modes", () => {
    for (const pickOne of [false, true]) {
      const clean = mountRow(base, { editable: false, pickOne });
      expect(clean.find('[data-test="tg-internal-a"]').exists()).toBe(false);
      clean.unmount();
      const edit = mountRow(base, { pickOne });
      expect(edit.find('[data-test="tg-internal-a"]').exists()).toBe(true);
      edit.unmount();
    }
  });
});

describe("ToggleRow style in Pick one", () => {
  it("is disabled while Pick one is on", () => {
    const one = mountRow(base, { pickOne: true, editing: true });
    expect(one.find('[aria-label="Style"]').attributes("aria-disabled") ?? one.find('[aria-label="Style"] button').attributes("disabled")).toBeDefined();
    expect(one.text()).toContain("not used while Pick one is on");
    one.unmount();
    const any = mountRow(base, { editing: true });
    expect(any.find('[aria-label="Style"] button').attributes("disabled")).toBeUndefined();
    any.unmount();
  });
});

describe("ToggleRow Pick one style", () => {
  function pickRow(pickStyle: "radio" | "chip" | "switch" | "checkbox", shownOn = false) {
    return mount(ToggleRow, {
      attachTo: document.body,
      props: {
        t: { ...base, style: "buttons" }, pickOne: true, pickStyle, shownOn, effOn: shownOn, parentName: "",
        blocked: false, indent: 0, editing: false, needsOptions: [], groupOptions: [], groupId: "",
        outputsFull: false, editable: false,
      },
    });
  }

  it("draws the node's Pick one style, not the row's own", () => {
    const radio = pickRow("radio");
    expect(radio.find('[role="radio"]').exists()).toBe(true);
    radio.unmount();
    const chip = pickRow("chip");
    expect(chip.find(".wp-tgr__row").classes()).toContain("is-chip");
    expect(chip.find(".wp-switch--chip").exists()).toBe(true);
    chip.unmount();
    const sw = pickRow("switch");
    expect(sw.find(".wp-switch--chip").exists()).toBe(false);
    expect(sw.find('[role="switch"]').exists()).toBe(true);
    sw.unmount();
  });

  it("a switch shows the pick and picking emits set-on", async () => {
    const w = pickRow("switch", true);
    const ctl = w.find('[role="switch"]');
    expect(ctl.attributes("aria-checked")).toBe("true");
    await ctl.trigger("click");
    expect(w.emitted("set-on")?.[0]).toEqual([false]);
    w.unmount();
  });
});

describe("ToggleRow Pick one Value", () => {
  it("warns that inline picks print as written", () => {
    const w = mountRow({ ...base, value: "{golden|soft} light" }, { pickOne: true, editing: true });
    expect(w.find('[data-test="tg-inline-picks"]').exists()).toBe(true);
    w.unmount();
    const plain = mountRow({ ...base, value: "$time light" }, { pickOne: true, editing: true });
    expect(plain.find('[data-test="tg-inline-picks"]').exists()).toBe(false);
    plain.unmount();
  });
});

describe("ToggleRow Pick one Value variables", () => {
  it("flags a $name nothing upstream sets", () => {
    const w = mount(ToggleRow, {
      attachTo: document.body,
      props: {
        t: { ...base, value: "$time and $nowhere" }, pickOne: true, shownOn: true, effOn: true, parentName: "", blocked: false,
        indent: 0, editing: true, needsOptions: [], groupOptions: [], groupId: "", outputsFull: false, editable: true,
        varSuggestions: ["time"],
      },
    });
    expect(w.find('[data-test="tg-missing-vars"]').text()).toContain("$nowhere");
    expect(w.find('[data-test="tg-missing-vars"]').text()).not.toContain("$time");
    w.unmount();
  });
});
