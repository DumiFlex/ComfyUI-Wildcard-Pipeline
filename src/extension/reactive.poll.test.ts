import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope } from "vue";
import { reactiveFromGraph } from "./reactive";

/**
 * The polling fallback's cost, which nothing made visible before.
 *
 * Measured on an 8-node Context chain carrying 96 variables: 0.59ms per
 * refresh. Small alone, and not what it costs — every node walks its WHOLE
 * upstream chain, so a series chain is quadratic in total work, and a series
 * chain is the shape people build.
 *
 * The fallback exists for upstream edits that fire no event on this node.
 * Neither of the gates below can hide such an edit for long, and both stop
 * work at moments when no edit is possible at all.
 */
describe("reactiveFromGraph — the poll does not run flat out forever", () => {
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
  });
  afterEach(() => vi.useRealTimers());

  /** A node whose computed value we control, with a counter for how often the
   *  compute actually ran. */
  function mount(initial = "a") {
    let value = initial;
    let computes = 0;
    const scope = effectScope();
    scope.run(() => {
      reactiveFromGraph({}, () => { computes += 1; return value; }, (x, y) => x === y);
    });
    return {
      computes: () => computes,
      set: (v: string) => { value = v; },
      stop: () => scope.stop(),
    };
  }

  it("does no work at all while the tab is hidden", () => {
    const f = mount();
    const baseline = f.computes();
    hidden = true;
    vi.advanceTimersByTime(400 * 20);
    expect(f.computes()).toBe(baseline);
    f.stop();
  });

  it("catches up once on the way back to visible", () => {
    // An edit made in another tab must not stay invisible; the point of the
    // gate is to skip work nobody can observe, not to miss it.
    const f = mount();
    hidden = true;
    vi.advanceTimersByTime(400 * 10);
    const beforeReturn = f.computes();
    hidden = false;
    vi.advanceTimersByTime(400);
    expect(f.computes()).toBe(beforeReturn + 1);
    f.stop();
  });

  it("backs off once the value stops changing", () => {
    const f = mount();
    // Ten unchanged polls take it off the base rate.
    vi.advanceTimersByTime(400 * 10);
    const afterFirstQuiet = f.computes();
    // The next ten ticks are now spread across a 3x period, so far fewer of
    // them do any work.
    vi.advanceTimersByTime(400 * 10);
    const during = f.computes() - afterFirstQuiet;
    expect(during).toBeLessThan(10);
    expect(during).toBeGreaterThan(0);   // still polling, just less often
    f.stop();
  });

  it("snaps back to full rate the moment something actually changes", () => {
    const f = mount();
    vi.advanceTimersByTime(400 * 30);   // fully backed off
    f.set("b");
    // Give the slow rate a chance to notice the change...
    vi.advanceTimersByTime(400 * 8);
    const afterChange = f.computes();
    // ...and from there it should be polling every tick again.
    vi.advanceTimersByTime(400 * 5);
    expect(f.computes() - afterChange).toBe(5);
    f.stop();
  });

  it("snaps back on user activity, before any change is observed", () => {
    // Someone who starts editing should not wait out the back-off ladder to
    // see their own upstream edit land.
    const f = mount();
    vi.advanceTimersByTime(400 * 30);
    document.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(400);        // resets, does not compute this tick
    const afterReset = f.computes();
    vi.advanceTimersByTime(400 * 5);
    expect(f.computes() - afterReset).toBe(5);
    f.stop();
  });
});
