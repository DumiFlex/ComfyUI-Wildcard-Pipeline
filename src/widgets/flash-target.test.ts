import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeWidgetHosts } from "../extension/_stashes";
import { REVEAL_EVENT, askReveal, blink, findFlashElement, flashInNode, revealTarget } from "./flash-target";

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
    vi.advanceTimersByTime(300);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("asks the widgets to unfold what hides the row before it looks", () => {
    vi.useFakeTimers();
    const node = {};
    const h = host('<div data-wp-reveal><div data-uid="m-9" hidden>child</div></div>');
    nodeWidgetHosts.set(node, new Set([h]));
    const wrap = h.firstElementChild as HTMLElement;
    const child = wrap.firstElementChild as HTMLElement;
    const seen: unknown[] = [];
    wrap.addEventListener(REVEAL_EVENT, (ev) => {
      seen.push(revealTarget(ev));
      child.hidden = false;
    });
    const animate = vi.fn();
    child.animate = animate as unknown as HTMLElement["animate"];
    flashInNode(node, { uid: "m-9" });
    vi.advanceTimersByTime(170);
    expect(seen).toEqual([{ uid: "m-9" }]);
    expect(animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });

  it("sends the reveal only to marked elements of live hosts", () => {
    const gone = document.createElement("div");
    gone.innerHTML = "<div data-wp-reveal></div>";
    const h = host("<div data-wp-reveal></div><div></div>");
    const hits: string[] = [];
    for (const [name, root] of [["gone", gone], ["live", h]] as const) {
      for (const el of root.querySelectorAll("div")) el.addEventListener(REVEAL_EVENT, () => hits.push(name));
    }
    askReveal([gone, h], { vars: ["x"] });
    expect(hits).toEqual(["live"]);
    expect(revealTarget(new Event("click"))).toBeNull();
  });

  it("does nothing without animate support", () => {
    const el = document.createElement("div");
    expect(() => blink(el)).not.toThrow();
  });
});
