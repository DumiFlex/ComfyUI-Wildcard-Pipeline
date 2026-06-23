import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SeedListModal from "../SeedListModal.vue";

function modal(props = {}) {
  return mount(SeedListModal, {
    props: { nodeName: "WP Context Loop", baseSeed: 42, count: 4, strategy: "sequential",
             seedLocks: { "1": 999 }, overrideHint: "Test hint.", ...props },
    attachTo: document.body,
    // The modal body renders inside `<Teleport to="body">`; stubbing teleport
    // renders the children in place so the wrapper's `find()` reaches them
    // (repo convention — see RemapRefPopup.test.ts, ConfirmDialog.test.ts).
    global: { stubs: { teleport: true } },
  });
}
// ES2020 lib — no Array.prototype.at; read the last emit by index.
function lastEmit(w: ReturnType<typeof modal>) {
  const ev = w.emitted("update:seedLocks")!;
  return ev[ev.length - 1][0];
}

describe("SeedListModal", () => {
  it("renders one row per iteration (count)", () => {
    expect(modal().findAll('[data-test="seedrow-idx"]')).toHaveLength(4);
  });
  it("shows the locked-count pill", () => {
    expect(modal().find('[data-test="mx-seed-lockcount"]').text()).toMatch(/1 locked/i);
  });
  it("shows the override hint with the provided text; hidden when empty", () => {
    const shown = modal({ overrideHint: "Heads up: override is on." });
    expect(shown.find('[data-test="mx-seed-hint"]').exists()).toBe(true);
    expect(shown.find('[data-test="mx-seed-hint"]').text()).toContain("Heads up: override is on.");
    expect(modal({ overrideHint: "" }).find('[data-test="mx-seed-hint"]').exists()).toBe(false);
  });
  it("a row update re-emits update:seedLocks with the merged map", async () => {
    const w = modal({ seedLocks: {} });
    await w.findAll('[data-test="seedrow-lock"]')[0].trigger("click"); // lock #1 (index 0), sequential derived = 42
    expect(lastEmit(w)).toEqual({ "0": 42 });
  });
  it("Lock all locks every iteration to its derived seed", async () => {
    const w = modal({ seedLocks: {} });
    await w.find('[data-test="mx-seed-lockall"]').trigger("click");
    expect(lastEmit(w)).toEqual({ "0": 42, "1": 43, "2": 44, "3": 45 });
  });
  it("Unlock all emits an empty map", async () => {
    const w = modal({ seedLocks: { "1": 999 } });
    await w.find('[data-test="mx-seed-unlockall"]').trigger("click");
    expect(lastEmit(w)).toEqual({});
  });
  it("Copy flashes a 'Copied' indicator on click", async () => {
    const w = modal();
    const btn = () => w.find('[data-test="mx-seed-copy"]');
    expect(btn().classes()).not.toContain("ghost--copied");
    await btn().trigger("click");
    expect(btn().classes()).toContain("ghost--copied");
    expect(btn().text()).toContain("Copied");
    w.unmount(); // clears the 1.5s reset timer via onBeforeUnmount
  });
  it("renders locks beyond count as a dimmed inactive group", () => {
    const w = modal({ count: 3, seedLocks: { "1": 11, "5": 55 } });
    expect(w.find('[data-test="mx-seed-inactive"]').exists()).toBe(true);
    // 3 active rows (#1-#3) + the out-of-range lock shown as #6
    expect(w.findAll('[data-test="seedrow-idx"]').map((n) => n.text())).toEqual(["#1", "#2", "#3", "#6"]);
  });
  it("no inactive group when every lock is within count", () => {
    const w = modal({ count: 3, seedLocks: { "1": 11 } });
    expect(w.find('[data-test="mx-seed-inactive"]').exists()).toBe(false);
    expect(w.findAll('[data-test="seedrow-idx"]')).toHaveLength(3);
  });
});
