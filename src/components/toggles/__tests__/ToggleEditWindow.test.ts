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
    ["Wire dot in front of the row", { hide_dot: true }],
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

  it("hides the dot when the first group is picked and nothing is wired", async () => {
    const w = open(base);
    const win = w.findComponent({ name: "Combobox" });
    win.vm.$emit("update:modelValue", ["LoRAs"]);
    await flushPromises();
    expect(done(w)?.[0]).toMatchObject({ groups: ["LoRAs"], hide_dot: true });
    w.unmount();
  });

  it("keeps the dot when something is wired already", async () => {
    const w = mount(ToggleEditWindow, {
      attachTo: document.body,
      props: {
        t: base, pickOne: false, shownOn: true, effOn: true, parentName: "", blocked: false,
        needsOptions: [{ value: "", label: "Nothing" }], groupOptions: [], groupId: "", outputsFull: false,
        controlState: { control: "bypass", active: false, hint: "Bypasses when off: Lora" },
      },
    });
    w.findComponent({ name: "Combobox" }).vm.$emit("update:modelValue", ["LoRAs"]);
    await flushPromises();
    expect(done(w)?.[0]).not.toHaveProperty("hide_dot");
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

  it("offers an Off value and an Off negative in Any on only", async () => {
    for (const pickOne of [true, false]) {
      const w = open({ ...base, off_value: "photorealistic", off_negative: "anime" }, { pickOne });
      for (let i = 0; i < 4; i++) {
        await vi.dynamicImportSettled();
        await flushPromises();
      }
      expect(q('[data-test="tg-off-value"]') === null, String(pickOne)).toBe(pickOne);
      expect(q('[data-test="tg-off-negative"]') === null, String(pickOne)).toBe(pickOne);
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

  it("folds When off, When on and Upstream into Advanced, open when something is set", async () => {
    const plain: Row = { ...base, control: undefined };
    delete (plain as { control?: unknown }).control;
    const w = open(plain);
    const head = q('[data-test="tg-advanced"]');
    expect(head?.getAttribute("aria-expanded")).toBe("false");
    expect(q('[data-test="tg-advanced-summary"]')).toBeNull();
    w.unmount();
    const w2 = open({ ...base, upstream: true });
    expect(q('[data-test="tg-advanced"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(q('[data-test="tg-advanced-summary"]')?.textContent).toBe("Bypasses when off · Upstream can set it");
    w2.unmount();
  });

  it("the preview shows the mute / bypass icon as soon as When off is set", async () => {
    const plain: Row = { ...base };
    delete (plain as { control?: unknown }).control;
    const w = open(plain);
    const preview = (): HTMLElement | null => q('[data-test="tg-window-preview"]');
    expect(preview()?.querySelector(".wp-tgr__ctlicon.is-mute")).toBeNull();
    q('[data-test="tg-advanced"]')?.click();
    await flushPromises();
    q('[data-test="tg-control-mute"]')?.click();
    await flushPromises();
    expect(preview()?.querySelector(".wp-tgr__ctlicon.is-mute")).not.toBeNull();
    w.unmount();
  });

  it("Lock value offers wildcards only, with each row's icon, and drops seed-only picks", async () => {
    const lockChoices = [
      { node: "slate-marten", uid: "w", label: "slate-marten · Ctx · Mood", wildcard: true, kind: "wildcard" },
      { node: "slate-marten", uid: "d", label: "slate-marten · Ctx · Colour", wildcard: false, kind: "derivation" },
    ];
    const t: Row = { ...base, lock: "seed", lock_targets: [{ node: "slate-marten", uid: "w" }, { node: "slate-marten", uid: "d" }] };
    const w = mount(ToggleEditWindow, {
      attachTo: document.body,
      props: {
        t, pickOne: false, shownOn: true, effOn: true, parentName: "", blocked: false,
        needsOptions: [], groupOptions: [], groupId: "", outputsFull: false, lockChoices,
      },
    });
    const combo = (): { options: { value: string; icon?: string }[] } =>
      w.findAllComponents({ name: "Combobox" }).at(-1)?.props() as { options: { value: string; icon?: string }[] };
    expect(combo().options.map((o) => o.value)).toEqual(["slate-marten|w", "slate-marten|d"]);
    expect(combo().options[1]?.icon).toBe("pi pi-arrow-right-arrow-left");
    q('[data-test="tg-lock-value"]')?.click();
    await flushPromises();
    expect(combo().options.map((o) => o.value)).toEqual(["slate-marten|w"]);
    expect(q('[data-test="tg-lock-dropped"]')?.textContent).toContain("1 picked row");
    expect(done(w)?.[0].lock_targets).toEqual([{ node: "slate-marten", uid: "w" }]);
    w.unmount();
  });
});
