import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SeedsWidget from "./SeedsWidget.vue";
import { currentFrame, setFrame } from "../context-loop/frame-cursor";
import type { SeedLabel } from "../../extension/seeds";
import { namedSeed, rowSeed, type SeedRow, type SeedsConfig } from "../../extension/seeds";

const row = (patch: Partial<SeedRow> = {}): SeedRow => ({
  id: "aaaa0001", kind: "seed", name: "Hero", mode: "fixed", value: 1234, per_frame: "new", pin: false, out: 0, ...patch,
});
const cfg = (...rows: SeedRow[]): SeedsConfig => ({ version: 1, rows });

function emittedConfig(w: ReturnType<typeof mount>): SeedsConfig | undefined {
  const calls = w.emitted("update:modelValue") as SeedsConfig[][] | undefined;
  return calls?.at(-1)?.[0];
}

describe("SeedsWidget", () => {
  it("shows each row's seed for the frame and an empty note with none", async () => {
    const empty = mount(SeedsWidget, { props: { modelValue: cfg(), baseSeed: 1 } });
    expect(empty.text()).toContain("No seeds yet");
    empty.unmount();

    const w = mount(SeedsWidget, { props: { modelValue: cfg(row()), baseSeed: 1 } });
    await flushPromises();
    expect(w.find('[data-test="seeds-row-aaaa0001"]').text()).toContain("1 234");
    w.unmount();
  });

  it("marks a pinned row for its output dot", async () => {
    const w = mount(SeedsWidget, { props: { modelValue: cfg(row({ pin: true, out: 2 })), baseSeed: 1 } });
    await flushPromises();
    expect(w.find('[data-test="seeds-row-aaaa0001"]').attributes("data-wp-out")).toBe("seed_2");
    w.unmount();
  });

  it("locks the frame's seed, preferring what the last run used", async () => {
    const w = mount(SeedsWidget, {
      props: { modelValue: cfg(row({ mode: "follow" })), baseSeed: 7, lastRun: { "0": { aaaa0001: 99 } } },
    });
    await flushPromises();
    await w.find('[data-test="seeds-lock-aaaa0001"]').trigger("click");
    const next = emittedConfig(w)?.rows[0] as SeedRow | undefined;
    expect(next?.locks).toEqual({ "0": 99 });
    w.unmount();
  });

  it("unlocks a locked frame", async () => {
    const w = mount(SeedsWidget, { props: { modelValue: cfg(row({ locks: { "0": 5 } })), baseSeed: 1 } });
    await flushPromises();
    await w.find('[data-test="seeds-lock-aaaa0001"]').trigger("click");
    const next = emittedConfig(w)?.rows[0] as SeedRow | undefined;
    expect(next?.locks).toBeUndefined();
    w.unmount();
  });

  it("adds a seed row with a free name in the edit view the toolbar pencil opens", async () => {
    const w = mount(SeedsWidget, { props: { modelValue: cfg(row({ name: "Seed" })), baseSeed: 1 } });
    expect(w.find('[data-test="seeds-add"]').exists()).toBe(false);
    await w.setProps({ editRequest: 1 });
    await w.find('[data-test="seeds-add"]').trigger("click");
    const rows = emittedConfig(w)?.rows ?? [];
    expect(rows.map((r) => r.name)).toEqual(["Seed", "Seed 2"]);
    w.unmount();
  });

  it("folds a label and keeps its rows' output dots on it", async () => {
    const label = { id: "bbbb0001", kind: "label" as const, name: "Prompts", collapsed: true };
    const w = mount(SeedsWidget, {
      props: { modelValue: { version: 1, rows: [label, row({ pin: true, out: 1 })] }, baseSeed: 1 },
    });
    await flushPromises();
    expect(w.find('[data-test="seeds-row-aaaa0001"]').exists()).toBe(false);
    expect(w.find('[data-test="seeds-label-bbbb0001"]').attributes("data-wp-out")).toBe("seed_1");
    w.unmount();
  });

  it("shows the frame picker only inside a loop, and the seed follows it", async () => {
    const r = row({ mode: "follow" });
    const solo = mount(SeedsWidget, { props: { modelValue: cfg(r), baseSeed: 3 } });
    expect(solo.find('[data-test="seeds-frame"]').exists()).toBe(false);
    solo.unmount();

    const w = mount(SeedsWidget, { props: { modelValue: cfg(r), baseSeed: 3, frames: 4 } });
    await flushPromises();
    expect(w.find('[data-test="seeds-frame"]').exists()).toBe(true);
    const shown = w.find('[data-test="seeds-row-aaaa0001"] [data-test="seeds-seed"]').text().replace(/\s/g, "");
    expect(shown).toBe(String(rowSeed(r, 3, 0)));
    w.unmount();
  });

  it("asks for a new base seed", async () => {
    const w = mount(SeedsWidget, { props: { modelValue: cfg(), baseSeed: 1 } });
    const reroll = w.findAll("button").find((b) => b.text().includes("Reroll"));
    await reroll?.trigger("click");
    expect(w.emitted("reroll-base")).toHaveLength(1);
    w.unmount();
  });

  it("cycles a row's mode from the node, keeping its seed when it leaves Follow", async () => {
    const w = mount(SeedsWidget, { props: { modelValue: cfg(row({ mode: "follow" })), baseSeed: 9 } });
    await flushPromises();
    await w.find('[data-test="seeds-mode-aaaa0001"]').trigger("click");
    const r = emittedConfig(w)?.rows[0] as SeedRow;
    expect(r.mode).toBe("random");
    expect(r.value).toBe(namedSeed(9, "Hero"));
    w.unmount();

    const f = mount(SeedsWidget, { props: { modelValue: cfg(row({ mode: "fixed" })), baseSeed: 9 } });
    await f.find('[data-test="seeds-mode-aaaa0001"]').trigger("click");
    expect((emittedConfig(f)?.rows[0] as SeedRow).mode).toBe("follow");
    f.unmount();
  });

  it("puts a row back on the seed it started from last run", async () => {
    const none = mount(SeedsWidget, { props: { modelValue: cfg(row({ mode: "random" })), baseSeed: 1 } });
    expect(none.find('[data-test="seeds-last-aaaa0001"]').attributes("disabled")).toBeDefined();
    none.unmount();

    const w = mount(SeedsWidget, {
      props: { modelValue: cfg(row({ mode: "random", value: 50 })), baseSeed: 1, lastBases: { aaaa0001: 4242 } },
    });
    await w.find('[data-test="seeds-last-aaaa0001"]').trigger("click");
    const r = emittedConfig(w)?.rows[0] as SeedRow;
    expect(r).toMatchObject({ mode: "fixed", value: 4242 });
    w.unmount();
  });

  it("offers Base seed from Loop only with a Loop upstream", async () => {
    const solo = mount(SeedsWidget, { props: { modelValue: cfg(row()), baseSeed: 1 } });
    expect(solo.find('[data-test="seeds-from-loop"]').exists()).toBe(false);
    solo.unmount();

    const w = mount(SeedsWidget, { props: { modelValue: cfg(row()), baseSeed: 1, loopSeed: 77 } });
    await w.find('[data-test="seeds-from-loop"]').trigger("click");
    expect(emittedConfig(w)?.base_from_loop).toBe(true);
    await w.setProps({ modelValue: { ...cfg(row()), base_from_loop: true } });
    expect(w.find('[data-test="seeds-reroll"]').attributes("disabled")).toBeDefined();
    await w.find('[data-test="seeds-from-loop"]').trigger("click");
    expect(emittedConfig(w)?.base_from_loop).toBeUndefined();
    w.unmount();
  });

  it("follows the Loop's Edit frame and moves it when stepped", async () => {
    setFrame(2);
    const r = row({ mode: "follow" });
    const w = mount(SeedsWidget, { props: { modelValue: cfg(r), baseSeed: 7, frames: 4 } });
    await flushPromises();
    expect(w.find('[data-test="seeds-row-aaaa0001"]').text()).toContain(
      String(rowSeed(r, 7, 2)).replace(/\B(?=(\d{3})+(?!\d))/g, " "),
    );
    setFrame(null);
    await flushPromises();
    expect(w.find('[data-test="seeds-row-aaaa0001"]').text()).toContain(
      String(rowSeed(r, 7, 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "),
    );
    const stepper = w.findComponent({ name: "WpNumber" });
    stepper.vm.$emit("update:modelValue", 4);
    await flushPromises();
    expect(currentFrame.value).toBe(3);
    setFrame(null);
    w.unmount();
  });

  it("draws a label's icon and own colour, and a row's icon and looks", async () => {
    const label: SeedLabel = { id: "lab00001", kind: "label", name: "Faces", icon: "user", hex: "#ff8800" };
    const r = row({ icon: "star", icon_color: "#00ff00", text_color: "#0000ff", tint: "#ff0000" });
    const w = mount(SeedsWidget, { props: { modelValue: { version: 1, rows: [label, r] }, baseSeed: 1 } });
    await flushPromises();
    const head = w.get('[data-test="seeds-label-lab00001"]');
    expect(head.find(".pi-user").exists()).toBe(true);
    expect(head.attributes("style")).toContain("rgb(255, 136, 0)");
    const rowEl = w.get('[data-test="seeds-row-aaaa0001"]');
    expect(rowEl.find('[data-test="seeds-icon-aaaa0001"]').classes()).toContain("pi-star");
    expect(rowEl.attributes("style")).toContain("--wp-sdr-tint: #ff0000");
    expect(rowEl.classes()).toContain("has-tint");
    w.unmount();
  });
});
