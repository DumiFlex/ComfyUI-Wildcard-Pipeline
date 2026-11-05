/** Regression: the actionbar icon-swap rAF loop is bounded (review M3). */
import { describe, it, expect, vi, afterEach } from "vitest";
import { startIconReplaceLoop } from "./topbar";

afterEach(() => vi.unstubAllGlobals());

function stubRaf() {
  const queue: FrameRequestCallback[] = [];
  const raf = vi.fn((cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal("requestAnimationFrame", raf);
  const drain = (max: number): number => {
    let n = 0;
    while (queue.length && n < max) { queue.shift()?.(0); n++; }
    return n;
  };
  return { raf, drain };
}

describe("startIconReplaceLoop", () => {
  it("gives up after maxFrames when no button ever renders", () => {
    const { drain } = stubRaf();
    startIconReplaceLoop(5);
    expect(drain(1000)).toBe(5);
  });

  it("stops on the first frame a matching button exists", () => {
    const { drain } = stubRaf();
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Wildcard Pipeline Workspace (opens in a new window)");
    document.body.appendChild(btn);
    startIconReplaceLoop(50);
    expect(drain(1000)).toBe(1);
    expect(btn.classList.contains("wp-top-menu-button")).toBe(true);
    btn.remove();
  });
});
