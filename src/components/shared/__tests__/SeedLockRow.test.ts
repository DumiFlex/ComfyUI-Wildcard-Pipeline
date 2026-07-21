import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SeedLockRow from "../SeedLockRow.vue";

function row(props = {}) {
  return mount(SeedLockRow, { props: { index: 0, derived: 12345, locked: false, seed: null, ...props } });
}

describe("SeedLockRow", () => {
  it("unlocked: shows derived value + a Lock toggle, no input", () => {
    const w = row();
    expect(w.find('[data-test="seedrow-derived"]').text()).toContain("12345");
    expect(w.find('[data-test="seedrow-input"]').exists()).toBe(false);
  });
  it("locking emits update with the derived value captured", async () => {
    const w = row();
    await w.find('[data-test="seedrow-lock"]').trigger("click");
    expect(w.emitted("update")![0][0]).toEqual({ index: 0, seed: 12345 });
  });
  it("unlocking emits update with null", async () => {
    const w = row({ locked: true, seed: 999 });
    await w.find('[data-test="seedrow-lock"]').trigger("click");
    expect(w.emitted("update")![0][0]).toEqual({ index: 0, seed: null });
  });
  it("editing the seed input emits update with the typed value", async () => {
    const w = row({ locked: true, seed: 999 });
    await w.find('[data-test="seedrow-input"]').setValue("4242");
    const updates = w.emitted("update")!;
    expect(updates[updates.length - 1][0]).toEqual({ index: 0, seed: 4242 });
  });
  it("displays #N (1-based) from the 0-based index", () => {
    expect(row({ index: 2 }).find('[data-test="seedrow-idx"]').text()).toBe("#3");
  });
  it("inactive dims the row but stays interactive (unlock still emits)", async () => {
    const w = row({ locked: true, seed: 999, inactive: true });
    expect(w.find(".srow").classes()).toContain("srow--inactive");
    await w.find('[data-test="seedrow-lock"]').trigger("click");
    expect(w.emitted("update")![0][0]).toEqual({ index: 0, seed: null });
  });
  it("lock-previous: fills + locks the captured previous seed", async () => {
    const w = row({ previous: 777 });
    const btn = w.find('[data-test="seedrow-lockprev"]');
    expect(btn.attributes("disabled")).toBeUndefined();
    await btn.trigger("click");
    expect(w.emitted("update")![0][0]).toEqual({ index: 0, seed: 777 });
  });
  it("lock-previous: disabled when the frame has no previous seed", () => {
    expect(row({ previous: null }).find('[data-test="seedrow-lockprev"]').attributes("disabled")).toBeDefined();
    expect(row().find('[data-test="seedrow-lockprev"]').attributes("disabled")).toBeDefined(); // absent → disabled
  });
});

describe("SeedLockRow bypass (#13)", () => {
  it("hides the bypass toggle unless bypassable", () => {
    expect(row().find('[data-test="seedrow-bypass"]').exists()).toBe(false);
    expect(row({ bypassable: true }).find('[data-test="seedrow-bypass"]').exists()).toBe(true);
  });
  it("emits bypass with the toggled state", async () => {
    const w = row({ bypassable: true, bypassed: false });
    await w.get('[data-test="seedrow-bypass"]').trigger("click");
    expect(w.emitted("bypass")![0]).toEqual([{ index: 0, bypassed: true }]);
  });
  it("marks the row bypassed + respects bypassDisabled", () => {
    const on = row({ bypassable: true, bypassed: true });
    expect(on.get(".srow").classes()).toContain("srow--bypassed");
    const dis = row({ bypassable: true, bypassed: false, bypassDisabled: true });
    expect(dis.get('[data-test="seedrow-bypass"]').attributes("disabled")).toBeDefined();
  });
});
