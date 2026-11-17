import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import SeedEditWindow from "./SeedEditWindow.vue";
import type { SeedRow } from "../../extension/seeds";

const row: SeedRow = { id: "aaaa0001", kind: "seed", name: "Hero", mode: "fixed", value: 1234, per_frame: "new", pin: false, out: 0 };

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

function click(sel: string): void {
  document.querySelector<HTMLElement>(sel)?.click();
}

describe("SeedEditWindow", () => {
  it("locks a frame on the draft and hands it back on Done", async () => {
    const w = mount(SeedEditWindow, {
      attachTo: document.body,
      props: { row, config: { version: 1, rows: [row] }, baseSeed: 1, frames: 3, lastRun: { "1": { aaaa0001: 77 } } },
    });
    await flushPromises();
    expect(document.querySelectorAll('[data-test^="seeds-cell-"]')).toHaveLength(3);
    click('[data-test="seeds-cell-1"]');
    await flushPromises();
    click('[data-test="seeds-window-done"]');
    const done = w.emitted("done") as SeedRow[][] | undefined;
    expect(done?.[0]?.[0]?.locks).toEqual({ "1": 77 });
    w.unmount();
  });

  it("keeps the seed it has when leaving Follow", async () => {
    const follow: SeedRow = { ...row, mode: "follow", value: 0 };
    const w = mount(SeedEditWindow, {
      attachTo: document.body,
      props: { row: follow, config: { version: 1, rows: [follow] }, baseSeed: 5 },
    });
    await flushPromises();
    click('[data-test="seeds-mode-fixed"]');
    await flushPromises();
    click('[data-test="seeds-window-done"]');
    const next = (w.emitted("done") as SeedRow[][] | undefined)?.[0]?.[0];
    expect(next?.mode).toBe("fixed");
    expect(next?.value).not.toBe(0);
    w.unmount();
  });

  it("cancels at once when nothing changed", async () => {
    const w = mount(SeedEditWindow, { attachTo: document.body, props: { row, config: { version: 1, rows: [row] }, baseSeed: 1 } });
    await flushPromises();
    click('[data-test="seeds-window-cancel"]');
    expect(w.emitted("cancel")).toHaveLength(1);
    w.unmount();
  });

  it("has the row's mode and Last run buttons on its preview", async () => {
    const random: SeedRow = { ...row, mode: "random", value: 50 };
    const w = mount(SeedEditWindow, {
      attachTo: document.body,
      props: { row: random, config: { version: 1, rows: [random] }, baseSeed: 1, lastSeed: 4242 },
    });
    await flushPromises();
    click('[data-test="seeds-mode-aaaa0001"]');
    await flushPromises();
    click('[data-test="seeds-mode-aaaa0001"]');
    await flushPromises();
    click('[data-test="seeds-last-aaaa0001"]');
    await flushPromises();
    click('[data-test="seeds-window-done"]');
    const next = (w.emitted("done") as SeedRow[][] | undefined)?.[0]?.[0];
    expect(next).toMatchObject({ mode: "fixed", value: 4242 });
    w.unmount();
  });
});
