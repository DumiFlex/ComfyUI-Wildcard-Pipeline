import { afterEach, describe, expect, it } from "vitest";
import { caretAnchor, followAnchor } from "./anchors";

function box(el: HTMLElement, r: { left: number; top: number; width: number; height: number }): void {
  el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect;
}

afterEach(() => { document.body.innerHTML = ""; window.getSelection()?.removeAllRanges(); });

describe("followAnchor", () => {
  it("reads the element's box live while it is on the page", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    box(el, { left: 10, top: 20, width: 30, height: 12 });
    const a = followAnchor(el);
    box(el, { left: 15, top: 40, width: 30, height: 12 });
    expect(a.getBoundingClientRect()).toEqual({ left: 15, top: 40, width: 30, height: 12 });
  });

  it("keeps the last box once the element has left the page", () => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    box(el, { left: 10, top: 20, width: 30, height: 12 });
    const a = followAnchor(el);
    el.remove();
    box(el, { left: 0, top: 0, width: 0, height: 0 });
    expect(a.getBoundingClientRect()).toEqual({ left: 10, top: 20, width: 30, height: 12 });
  });
});

describe("caretAnchor", () => {
  it("falls back to the field when the caret is elsewhere", () => {
    const host = document.createElement("div");
    const field = document.createElement("div");
    document.body.append(host, field);
    box(field, { left: 5, top: 6, width: 200, height: 30 });
    expect(caretAnchor(host, field, 1).getBoundingClientRect()).toEqual({ left: 5, top: 6, width: 200, height: 30 });
  });

  it("uses the caret's box, moved back to the trigger", () => {
    const host = document.createElement("div");
    host.textContent = "a @Pa";
    document.body.appendChild(host);
    const text = host.firstChild as Text;
    const sel = window.getSelection();
    sel?.collapse(text, 5);
    let start = -1;
    const proto = Range.prototype as Range & { getBoundingClientRect?: () => DOMRect };
    const had = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: Range) {
      start = this.startOffset;
      return { left: 40, top: 50, width: 0, height: 14, right: 40, bottom: 64, x: 40, y: 50, toJSON: () => null } as DOMRect;
    };
    try {
      const r = caretAnchor(host, host, 3).getBoundingClientRect();
      expect(r).toEqual({ left: 40, top: 50, width: 0, height: 14 });
      expect(start).toBe(2);
    } finally {
      if (had) proto.getBoundingClientRect = had;
      else Reflect.deleteProperty(proto, "getBoundingClientRect");
    }
  });
});
