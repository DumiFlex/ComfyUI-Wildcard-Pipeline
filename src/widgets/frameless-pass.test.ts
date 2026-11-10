import { afterEach, describe, expect, it } from "vitest";
import { passPointerThrough } from "./_frameless";

function mountWrap(): { wrap: HTMLElement; el: HTMLElement } {
  const wrap = document.createElement("div");
  wrap.className = "dom-widget";
  wrap.style.pointerEvents = "auto";
  const el = document.createElement("div");
  wrap.appendChild(el);
  document.body.appendChild(wrap);
  return { wrap, el };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("passPointerThrough", () => {
  it("forces the wrapper to let clicks through", () => {
    const { wrap, el } = mountWrap();
    const pass = passPointerThrough(el);
    expect(wrap.style.getPropertyValue("pointer-events")).toBe("none");
    expect(wrap.style.getPropertyPriority("pointer-events")).toBe("important");
    pass?.stop();
  });

  it("gives the pointer back while `when` is false and takes it again after", () => {
    const { wrap, el } = mountWrap();
    let editing = false;
    const pass = passPointerThrough(el, () => !editing);
    expect(wrap.style.getPropertyValue("pointer-events")).toBe("none");
    editing = true;
    pass?.refresh();
    expect(wrap.style.getPropertyValue("pointer-events")).toBe("");
    editing = false;
    pass?.refresh();
    expect(wrap.style.getPropertyValue("pointer-events")).toBe("none");
    pass?.stop();
  });

  it("leaves ComfyUI's own value alone while `when` is false", () => {
    const { wrap, el } = mountWrap();
    const pass = passPointerThrough(el, () => false);
    expect(wrap.style.getPropertyValue("pointer-events")).toBe("auto");
    pass?.stop();
  });

  it("returns null without a wrapper", () => {
    expect(passPointerThrough(document.createElement("div"))).toBeNull();
  });
});
