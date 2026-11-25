import { afterEach, describe, it, expect, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flagsOf, heightOwnedAtLoad, resolveSizing, widthBand, widthFloor } from "./node-sizing";
import { createDomWidgetHost, type DomWidget } from "./_shared";

describe("resolveSizing", () => {
  it("defaults to grow with no floor", () => {
    const r = resolveSizing(undefined, {});
    expect(r).toEqual({ minWidth: null, contentWidth: false, height: "grow", narrow: null, wide: null, container: false });
  });

  it("maps the legacy flags, ownSize first", () => {
    expect(resolveSizing(undefined, { autoHeight: true }).height).toBe("content");
    expect(resolveSizing(undefined, { fillHost: true }).height).toBe("fill");
    expect(resolveSizing(undefined, { fitContent: true }).height).toBe("fit");
    expect(resolveSizing(undefined, { ownSize: true, fillHost: true, autoHeight: true }).height).toBe("own");
    expect(resolveSizing(undefined, { fillHost: true, autoHeight: true }).height).toBe("fill");
  });

  it("lets sizing win over the flags", () => {
    const r = resolveSizing({ width: { min: 260, content: true }, height: "grow", breakpoints: { narrow: 300, wide: 520 }, container: true }, { minWidth: 400, autoHeight: true });
    expect(r.minWidth?.()).toBe(260);
    expect(r.contentWidth).toBe(true);
    expect(r.height).toBe("grow");
    expect([r.narrow, r.wide, r.container]).toEqual([300, 520, true]);
  });

  it("keeps a getter floor live", () => {
    let w = 300;
    const r = resolveSizing(undefined, { minWidth: () => w });
    expect(r.minWidth?.()).toBe(300);
    w = 420;
    expect(r.minWidth?.()).toBe(420);
  });

  it("flagsOf gives one flag per mode", () => {
    expect(flagsOf(resolveSizing({ height: "content" }, {}))).toEqual({ autoHeight: true, fillHost: false, fitContent: false, ownSize: false });
    expect(flagsOf(resolveSizing({ height: "grow" }, {}))).toEqual({ autoHeight: false, fillHost: false, fitContent: false, ownSize: false });
    expect(flagsOf(resolveSizing({ height: "own" }, {})).ownSize).toBe(true);
  });
});

describe("widthBand", () => {
  const r = { narrow: 300, wide: 520 };
  it("splits at the breakpoints", () => {
    expect(widthBand(299, r)).toBe("narrow");
    expect(widthBand(300, r)).toBe("normal");
    expect(widthBand(519, r)).toBe("normal");
    expect(widthBand(520, r)).toBe("wide");
  });
  it("is normal without breakpoints", () => {
    expect(widthBand(10, { narrow: null, wide: null })).toBe("normal");
  });
});

describe("widthFloor", () => {
  it("keeps the declared floor when the content is narrower or unknown", () => {
    expect(widthFloor(260, null, 10)).toBe(260);
    expect(widthFloor(260, 0, 10)).toBe(260);
    expect(widthFloor(260, 200, 10)).toBe(260);
  });
  it("raises it to the content plus both insets", () => {
    expect(widthFloor(260, 290.2, 10)).toBe(311);
  });
});

describe("heightOwnedAtLoad", () => {
  it("never for content or own", () => {
    expect(heightOwnedAtLoad("content", 900, 200)).toBe(false);
    expect(heightOwnedAtLoad("own", 900, 200)).toBe(false);
  });
  it("always for fill", () => {
    expect(heightOwnedAtLoad("fill", 100, 200)).toBe(true);
  });
  it("under grow / fit only when taller than the content", () => {
    expect(heightOwnedAtLoad("grow", 400, 200)).toBe(true);
    expect(heightOwnedAtLoad("grow", 200.5, 200)).toBe(false);
    expect(heightOwnedAtLoad("fit", 300, 200)).toBe(true);
  });
});

describe("createDomWidgetHost sizing", () => {
  const Leaf = defineComponent({ setup: () => () => h("span", "leaf") });
  const node = () => ({ id: 7, mode: 0, addDOMWidget: (_n: string, _t: string, el: HTMLElement, opts?: Record<string, unknown>) => ({ element: el, options: opts }) as DomWidget });

  it("makes the host a wp-node container when asked", () => {
    const w = createDomWidgetHost(node(), "w", Leaf, { sizing: { container: true } });
    // jsdom drops `container-type`; the marker stands in for it.
    expect(w.element.parentElement?.dataset.wpContainer).toBe("");
  });

  it("leaves the host alone by default", () => {
    const w = createDomWidgetHost(node(), "w", Leaf);
    expect(w.element.parentElement?.dataset.wpContainer).toBeUndefined();
  });

  it("reports the sizing floor to litegraph", () => {
    const made: { w?: DomWidget & { computeLayoutSize?: () => { minWidth?: number } } } = {};
    const n = { ...node(), addDOMWidget: (_n: string, _t: string, el: HTMLElement, opts?: Record<string, unknown>) => (made.w = { element: el, options: opts } as DomWidget) };
    createDomWidgetHost(n, "w", Leaf, { sizing: { width: { min: 255 } } });
    // Snapped up to the 10 px grid.
    expect(made.w?.computeLayoutSize?.().minWidth).toBe(260);
  });

  describe("while a pointer is held", () => {
    const real = globalThis.ResizeObserver;
    afterEach(() => { globalThis.ResizeObserver = real; });

    it("waits for the release before resizing the node", async () => {
      const fire: Array<(e: ResizeObserverEntry[]) => void> = [];
      globalThis.ResizeObserver = class {
        constructor(cb: (e: ResizeObserverEntry[]) => void) { fire.push(cb); }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as unknown as typeof ResizeObserver;
      const setSize = vi.fn((s: number[]) => { n.size = s; });
      const n = { ...node(), size: [300, 100], computeSize: () => [300, 180], setSize, setDirtyCanvas: () => {} };
      createDomWidgetHost(n, "w", Leaf, { sizing: { height: "content" } });
      await Promise.resolve();
      const grow = (): void => { for (const cb of fire) cb([{ contentRect: { height: 160 } } as unknown as ResizeObserverEntry]); };

      window.dispatchEvent(new Event("pointerdown"));
      grow();
      await Promise.resolve();
      expect(setSize).not.toHaveBeenCalled();

      window.dispatchEvent(new Event("pointerup"));
      await Promise.resolve();
      expect(setSize).toHaveBeenCalledWith([300, 180]);
    });
  });
});
