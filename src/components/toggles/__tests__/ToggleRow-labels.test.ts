import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToggleRow from "../ToggleRow.vue";
import type { ToggleRow as Row } from "../../../extension/toggles";

const row: Row = { id: "a", kind: "toggle", name: "Settings from the model", var: "model_settings", on: true, pin: false, out: 0, style: "switch", control: "bypass" };

function mountRow() {
  return mount(ToggleRow, {
    attachTo: document.body,
    props: {
      t: row, pickOne: false, shownOn: true, effOn: true, parentName: "", blocked: false, indent: 0, editing: true,
      needsOptions: [], groupOptions: [], groupId: "", outputsFull: false, editable: true,
    },
  });
}

describe("ToggleRow edit panel: the words beside each box tick it", () => {
  it.each([
    ["Show", { hide_var: true }],
    ["Invert: bypass while on", { invert: true }],
    ["Upstream can set it", { upstream: true }],
    ["BOOLEAN output", { pin: true }],
  ])("%s", async (words, patch) => {
    const w = mountRow();
    const label = w.findAll(".wp-tgr__check > span").find((s) => s.text() === words);
    expect(label, words).toBeTruthy();
    await label?.trigger("click");
    expect(w.emitted("patch")?.[0]).toEqual([patch]);
    w.unmount();
  });
});
