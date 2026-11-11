import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ToggleEditWindow from "../ToggleEditWindow.vue";
import type { ToggleRow as Row } from "../../../extension/toggles";

const base: Row = { id: "a", kind: "toggle", name: "Dawn", var: "dawn", on: true, pin: false, out: 0, style: "switch", control: "bypass" };

function open(t: Row, extra: { pickOne?: boolean; varSuggestions?: string[]; groupId?: string } = {}) {
  return mount(ToggleEditWindow, {
    attachTo: document.body,
    props: {
      t, pickOne: extra.pickOne ?? false, shownOn: true, effOn: true, parentName: "", blocked: false,
      needsOptions: [{ value: "", label: "Nothing" }],
      groupOptions: extra.groupId !== undefined ? [{ value: "", label: "Top" }, { value: "g1", label: "Light" }] : [],
      groupId: extra.groupId ?? "", outputsFull: false, nodeTitle: "Light",
      ...(extra.varSuggestions ? { varSuggestions: extra.varSuggestions } : {}),
    },
  });
}
/** The window is teleported to body. */
function q(sel: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(sel);
}
function done(w: ReturnType<typeof open>): [Row, string] | undefined {
  q('[data-test="tg-window-done"]')?.click();
  return w.emitted("done")?.[0] as [Row, string] | undefined;
}

describe("ToggleEditWindow", () => {
  it.each([
    ["Show", { hide_var: true }],
    ["Invert: bypass while on", { invert: true }],
    ["Upstream can set it", { upstream: true }],
    ["BOOLEAN output", { pin: true }],
  ])("the words %s tick their box", async (words, patch) => {
    const w = open(base);
    const label = [...document.body.querySelectorAll<HTMLElement>(".wp-tgr__check > span")].find((s) => s.textContent === words);
    expect(label, words).toBeTruthy();
    label?.click();
    await flushPromises();
    expect(done(w)?.[0]).toMatchObject(patch);
    w.unmount();
  });

  it("writes nothing until Done, then hands back the draft and its group", async () => {
    const w = open(base, { groupId: "" });
    const name = q('[data-test="tg-name"]') as HTMLInputElement | null;
    if (name) {
      name.value = "Sunrise";
      name.dispatchEvent(new Event("change"));
    }
    await flushPromises();
    expect(w.emitted("done")).toBeUndefined();
    expect(q('[data-test="tg-window-preview"]')?.textContent).toContain("Sunrise");
    const out = done(w);
    expect(out?.[0].name).toBe("Sunrise");
    expect(out?.[1]).toBe("");
    w.unmount();
  });

  it("Cancel without changes closes at once", async () => {
    const w = open(base);
    q('[data-test="tg-window-cancel"]')?.click();
    await flushPromises();
    expect(w.emitted("cancel")).toHaveLength(1);
    w.unmount();
  });

  it("hides Style and Needs in Pick one", () => {
    const one = open(base, { pickOne: true });
    expect(q('[aria-label="Style"]')).toBeNull();
    expect(q('[data-test="tg-needs"]')).toBeNull();
    one.unmount();
    const any = open(base);
    expect(q('[aria-label="Style"]')).not.toBeNull();
    expect(q('[data-test="tg-needs"]')).not.toBeNull();
    any.unmount();
  });

  it("offers a Value and a negative in both modes", async () => {
    for (const pickOne of [true, false]) {
      const w = open({ ...base, negative: "night sky" }, { pickOne });
      for (let i = 0; i < 4; i++) {
        await vi.dynamicImportSettled();
        await flushPromises();
      }
      expect(q('[data-test="tg-value"]'), String(pickOne)).not.toBeNull();
      expect(q('[data-test="tg-negative"]'), String(pickOne)).not.toBeNull();
      w.unmount();
    }
  });

  it("warns that inline picks print as written", () => {
    const w = open({ ...base, value: "{golden|soft} light" }, { pickOne: true });
    expect(q('[data-test="tg-inline-picks"]')).not.toBeNull();
    w.unmount();
    const plain = open({ ...base, value: "$time light" }, { pickOne: true });
    expect(q('[data-test="tg-inline-picks"]')).toBeNull();
    plain.unmount();
  });

  it("flags a $name nothing upstream sets", () => {
    const w = open({ ...base, value: "$time and $nowhere" }, { pickOne: true, varSuggestions: ["time"] });
    const note = q('[data-test="tg-missing-vars"]')?.textContent ?? "";
    expect(note).toContain("$nowhere");
    expect(note).not.toContain("$time");
    w.unmount();
  });
  it("colours the header with the toggle's looks", () => {
    const w = open({ ...base, icon: "moon", icon_color: "#7aa7ff", text_color: "#a9c4ff", tint: "#4c7dff" });
    const icon = q('[data-test="tg-window-icon"]');
    expect(icon?.className).toContain("pi-moon");
    expect(icon?.getAttribute("style")).toContain("--wp-tgw-icon: #7aa7ff");
    expect(q('[data-test="tg-window-sub"]')?.getAttribute("style")).toContain("--wp-tgw-text: #a9c4ff");
    w.unmount();
  });
});
