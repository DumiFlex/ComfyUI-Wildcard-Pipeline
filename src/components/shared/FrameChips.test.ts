import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import FrameChips from "./FrameChips.vue";

/**
 * The grid shared by WP_ContextLoop and WP_SeedList. The two nodes disagree
 * about what a click means, so most of what matters here is that `selectable`
 * and `bypassInteractive` actually gate the right emissions.
 */
describe("FrameChips", () => {
  const at = (w: ReturnType<typeof mount>, n: number | "base") =>
    w.find(`[data-test="loop-frame-${n}"]`);

  it("renders one chip per frame, and base only when asked", () => {
    const a = mount(FrameChips, { props: { count: 5 } });
    expect(a.findAll('[data-test^="loop-frame-"]')).toHaveLength(5);
    expect(a.find('[data-test="loop-frame-base"]').exists()).toBe(false);

    const b = mount(FrameChips, { props: { count: 5, showBase: true } });
    expect(b.find('[data-test="loop-frame-base"]').exists()).toBe(true);
  });

  it("always renders at least one chip, even at count 0", () => {
    const w = mount(FrameChips, { props: { count: 0 } });
    expect(w.findAll('[data-test^="loop-frame-"]')).toHaveLength(1);
  });

  describe("selectable (Context Loop)", () => {
    const sel = (extra = {}) =>
      mount(FrameChips, { props: { count: 4, selectable: true, showBase: true, bypassInteractive: true, ...extra } });

    it("plain click selects, shift locks, alt bypasses", async () => {
      const w = sel();
      await at(w, 2).trigger("click");
      expect(w.emitted("select")?.[0]).toEqual([1]);
      await at(w, 3).trigger("click", { shiftKey: true });
      expect(w.emitted("toggleLock")?.[0]).toEqual([2]);
      await at(w, 4).trigger("click", { altKey: true });
      expect(w.emitted("toggleBypass")?.[0]).toEqual([3]);
    });

    it("a modifier click never also selects", async () => {
      const w = sel();
      await at(w, 2).trigger("click", { shiftKey: true });
      await at(w, 3).trigger("click", { altKey: true });
      expect(w.emitted("select")).toBeUndefined();
    });

    it("base selects null and takes no modifiers", async () => {
      const w = sel();
      await at(w, "base").trigger("click");
      expect(w.emitted("select")?.[0]).toEqual([null]);
      expect(w.emitted("toggleLock")).toBeUndefined();
      expect(w.emitted("toggleBypass")).toBeUndefined();
    });
  });

  describe("non-selectable (Seed List)", () => {
    const plain = (extra = {}) => mount(FrameChips, { props: { count: 4, ...extra } });

    // No edit cursor here, so demanding a modifier for the only available
    // action would be ceremony.
    it("a plain click IS the lock toggle", async () => {
      const w = plain();
      await at(w, 2).trigger("click");
      expect(w.emitted("toggleLock")?.[0]).toEqual([1]);
      expect(w.emitted("select")).toBeUndefined();
    });

    it("alt does nothing when bypass belongs to another node", async () => {
      const w = plain({ bypassed: [1] });
      await at(w, 2).trigger("click", { altKey: true });
      expect(w.emitted("toggleBypass")).toBeUndefined();
      expect(w.emitted("toggleLock")).toBeUndefined();
    });

    it("still SHOWS bypass it cannot change", () => {
      const w = plain({ bypassed: [1] });
      expect(at(w, 2).classes()).toContain("wp-fchips__chip--bypassed");
    });

    it("explains who owns the bypass instead of looking broken", () => {
      const w = plain({ bypassed: [1], bypassReadonlyHint: "Owned by the loop." });
      expect(at(w, 2).attributes("title")).toContain("Owned by the loop.");
    });
  });

  describe("collapse", () => {
    it("starts open and hides the grid when toggled", async () => {
      const w = mount(FrameChips, { props: { count: 4 } });
      expect(w.find('[data-test="loop-frames-grid"]').exists()).toBe(true);
      await w.find('[data-test="loop-frames-toggle"]').trigger("click");
      expect(w.find('[data-test="loop-frames-grid"]').exists()).toBe(false);
      await w.find('[data-test="loop-frames-toggle"]').trigger("click");
      expect(w.find('[data-test="loop-frames-grid"]').exists()).toBe(true);
    });

    // Hiding the grid must not also hide the fact that frames are set — a
    // forgotten lock is a confusing run.
    it("keeps reporting locked/bypassed counts while collapsed", async () => {
      const w = mount(FrameChips, { props: { count: 6, locked: [0, 2], bypassed: [4] } });
      await w.find('[data-test="loop-frames-toggle"]').trigger("click");
      const summary = w.find('[data-test="loop-frames-summary"]');
      expect(summary.text()).toMatch(/2 locked/);
      expect(summary.text()).toMatch(/1 bypassed/);
    });

    it("is controllable by the host, which persists it to node.properties", async () => {
      const w = mount(FrameChips, { props: { count: 4, collapsed: true } });
      // Starts collapsed because the host said so — a saved workflow reopens
      // the way it was left.
      expect(w.find('[data-test="loop-frames-grid"]').exists()).toBe(false);
      await w.find('[data-test="loop-frames-toggle"]').trigger("click");
      expect(w.emitted("update:collapsed")?.[0]).toEqual([false]);
    });

    it("shows no summary when nothing is set", () => {
      const w = mount(FrameChips, { props: { count: 6 } });
      expect(w.find('[data-test="loop-frames-summary"]').exists()).toBe(false);
    });

    // Out-of-range locks survive a count change and re-apply if it grows back,
    // but they have no chip here — claiming them would name a frame that is
    // not on screen. The modal owns that story.
    it("counts only in-range locks", () => {
      const w = mount(FrameChips, { props: { count: 3, locked: [0, 9] } });
      expect(w.find('[data-test="loop-frames-summary"]').text()).toMatch(/1 locked/);
    });
  });

  it("namespaces every test id so two widgets can coexist", () => {
    const w = mount(FrameChips, { props: { count: 2, testId: "seedlist-frame" } });
    expect(w.find('[data-test="seedlist-frame-1"]').exists()).toBe(true);
    expect(w.find('[data-test="seedlist-frames-grid"]').exists()).toBe(true);
    expect(w.find('[data-test="loop-frame-1"]').exists()).toBe(false);
  });

  it("prints the combos that apply to this mode", () => {
    const loop = mount(FrameChips, { props: { count: 2, selectable: true } });
    expect(loop.find('[data-test="loop-frames-hint"]').text()).toMatch(/shift/i);
    const list = mount(FrameChips, { props: { count: 2 } });
    expect(list.find('[data-test="loop-frames-hint"]').text()).toMatch(/click a frame to lock/i);
    expect(list.find('[data-test="loop-frames-hint"]').text()).not.toMatch(/shift/i);
  });

  it("bounds its height and scrolls rather than growing the node", () => {
    const w = mount(FrameChips, { props: { count: 200 } });
    const grid = w.find('[data-test="loop-frames-grid"]');
    expect(w.findAll('[data-test^="loop-frame-"]')).toHaveLength(200);
    // jsdom does not lay out, so assert the contract the CSS declares.
    expect(grid.classes()).toContain("wp-fchips__grid");
  });
});
