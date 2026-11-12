import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeWidgetHosts } from "../extension/_stashes";
import { blink, findFlashElement, flashInNode } from "./flash-target";

function host(html: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "wp-widget";
  h.innerHTML = html;
  document.body.appendChild(h);
  return h;
}

describe("Show node blink", () => {
  beforeEach(() => {
    // jsdom lays nothing out; treat every element as visible.
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("finds a Context module by uid before any variable match", () => {
    const h = host('<div data-wp-vars="hair">a</div><div data-uid="m-1">b</div>');
    expect(findFlashElement([h], { uid: "m-1", vars: ["hair"] })?.textContent).toBe("b");
  });

  it("finds another node's field by the variable it writes", () => {
    const h = host('<div data-wp-vars="i i_total">loop</div><div data-wp-vars="i_value">values</div>');
    expect(findFlashElement([h], { vars: ["i_total"] })?.textContent).toBe("loop");
    expect(findFlashElement([h], { vars: ["i_value"] })?.textContent).toBe("values");
    expect(findFlashElement([h], { vars: ["other"] })).toBeNull();
  });

  it("skips hosts that left the page", () => {
    const gone = document.createElement("div");
    gone.innerHTML = '<div data-wp-vars="x">old</div>';
    const h = host('<div data-wp-vars="x">new</div>');
    expect(findFlashElement([gone, h], { vars: ["x"] })?.textContent).toBe("new");
  });

  it("blinks the field once the node is in view", () => {
    vi.useFakeTimers();
    const node = {};
    const h = host('<div data-wp-vars="model_family">Family</div>');
    nodeWidgetHosts.set(node, new Set([h]));
    const el = h.firstElementChild as HTMLElement;
    const animate = vi.fn();
    el.animate = animate as unknown as HTMLElement["animate"];
    flashInNode(node, { vars: ["model_family"] });
    expect(animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does nothing without animate support", () => {
    const el = document.createElement("div");
    expect(() => blink(el)).not.toThrow();
  });
});
