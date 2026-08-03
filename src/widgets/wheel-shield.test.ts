import { describe, it, expect, vi, afterEach } from "vitest";
import { installWheelShield } from "./wheel-shield";

/** jsdom reports 0 for every scroll metric, so state them explicitly. */
function makeScroller(overflow: "auto" | "visible", scrollable: boolean): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = overflow;
  el.style.overflowX = overflow;
  Object.defineProperty(el, "scrollHeight", { value: scrollable ? 500 : 100, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(el, "scrollWidth", { value: scrollable ? 500 : 100, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: 100, configurable: true });
  return el;
}

function setup(overflow: "auto" | "visible", scrollable: boolean) {
  // Mirrors the real structure: the canvas's wheel handler lives on an element
  // ABOVE our widget (the Vue node), not on window. That is what lets a
  // window-capture listener win — putting the stand-in on window instead would
  // make registration order decide it, since stopPropagation does not stop
  // listeners already invoked on the same node.
  const nodeEl = document.createElement("div");
  const root = document.createElement("div");
  const scroller = makeScroller(overflow, scrollable);
  const leaf = document.createElement("span");
  scroller.appendChild(leaf);
  root.appendChild(scroller);
  nodeEl.appendChild(root);
  document.body.appendChild(nodeEl);

  const canvasHandler = vi.fn();
  nodeEl.addEventListener("wheel", canvasHandler);
  const dispose = installWheelShield(root);
  return { root, leaf, canvasHandler, dispose };
}

function wheel(target: HTMLElement, init: Partial<WheelEventInit> = {}) {
  target.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true, ...init }));
}

afterEach(() => { document.body.replaceChildren(); });

describe("installWheelShield", () => {
  it("absorbs the wheel when something under the cursor can scroll", () => {
    // Nodes 2.0 otherwise forwards it to the canvas, which zooms and cancels
    // the default, so the content never moves (measured 0.900 -> 0.818).
    const { leaf, canvasHandler, dispose } = setup("auto", true);
    wheel(leaf);
    expect(canvasHandler).not.toHaveBeenCalled();
    dispose();
  });

  it("lets the canvas zoom when nothing can scroll", () => {
    const { leaf, canvasHandler, dispose } = setup("auto", false);
    wheel(leaf);
    expect(canvasHandler).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("lets the canvas zoom when the element is not a scroll container", () => {
    const { leaf, canvasHandler, dispose } = setup("visible", true);
    wheel(leaf);
    expect(canvasHandler).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("leaves ctrl+wheel to the canvas — that is pinch zoom", () => {
    const { leaf, canvasHandler, dispose } = setup("auto", true);
    wheel(leaf, { ctrlKey: true });
    expect(canvasHandler).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("ignores wheels outside the widget", () => {
    const { root, canvasHandler, dispose } = setup("auto", true);
    // A sibling inside the same node, but outside our widget root.
    const outside = document.createElement("div");
    root.parentElement?.appendChild(outside);
    wheel(outside);
    expect(canvasHandler).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("declares the host's documented capture attribute", () => {
    const { root, dispose } = setup("auto", true);
    expect(root.getAttribute("data-capture-wheel")).toBe("true");
    dispose();
  });

  it("stops absorbing once disposed", () => {
    const { leaf, canvasHandler, dispose } = setup("auto", true);
    dispose();
    wheel(leaf);
    expect(canvasHandler).toHaveBeenCalledTimes(1);
  });
});
