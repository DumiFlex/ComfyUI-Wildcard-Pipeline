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

describe("ToggleRow chip", () => {
  it("says Name · $var, and the name alone when Show is off", () => {
    const chip: Row = { ...base, style: "chip" };
    const w = mountRow(chip, { editable: false });
    expect(w.find(".wp-tgr__chip").text().replace(/\s+/g, "")).toBe("Dawn·$dawn");
    w.unmount();
    const bare = mountRow({ ...chip, hide_var: true }, { editable: false });
    expect(bare.find('[data-test="tg-chip-var-a"]').exists()).toBe(false);
    expect(bare.find(".wp-tgr__chip").text()).toBe("Dawn");
    bare.unmount();
  });
});

describe("ToggleRow looks", () => {
  it("draws the icon and hands its colours to the row", () => {
    const w = mountRow({ ...base, icon: "sun", icon_color: "#ffcc00", text_color: "#ff0000", tint: "#00aaff" }, {});
    const row = w.find(`[data-test="tg-row-${base.id}"]`);
    expect(row.find(".pi-sun").exists()).toBe(true);
    const style = row.attributes("style") ?? "";
    expect(style).toContain("--wp-tg-icon: #ffcc00");
    expect(style).toContain("--wp-tg-text: #ff0000");
    expect(style).not.toContain("--wp-accent");
    expect(w.find(".wp-tgr__ctl").attributes("style")).toContain("--wp-accent: #00aaff");
    expect(row.classes()).toContain("has-icon-color");
    w.unmount();
  });

  it("keeps the theme's look with no colours set", () => {
    const w = mountRow(base, {});
    expect(w.find(`[data-test="tg-row-${base.id}"]`).attributes("style") ?? "").not.toContain("--wp-accent");
    w.unmount();
  });

  it("offers edit, globe and remove on the row in the editor", async () => {
    const w = mountRow(base, { editable: true });
    expect(w.find(`[data-test="tg-edit-${base.id}"]`).exists()).toBe(true);
    expect(w.find(`[data-test="tg-internal-${base.id}"]`).exists()).toBe(true);
    await w.find(`[data-test="tg-remove-${base.id}"]`).trigger("click");
    expect(w.emitted("remove")).toHaveLength(1);
    w.unmount();
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

describe("ToggleRow controls", () => {
  it("draws a checkbox for the Check style", () => {
    const w = mountRow({ ...base, style: "checkbox" }, { editable: false });
    expect(w.find(`[data-test="tg-ctl-${base.id}"]`).exists()).toBe(true);
    expect(w.find(".wp-tgr__ctl").html()).toContain("checkbox");
    w.unmount();
  });
});
