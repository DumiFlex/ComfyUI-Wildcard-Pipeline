import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useGrowableField } from "../useGrowableField";

/**
 * jsdom has no ResizeObserver and no layout, so these exercise the parts that
 * are pure logic: when auto-grow yields, and — the one that actually bit —
 * that the observer callback itself does no work.
 */

let observerCallback: (() => void) | null = null;
let observedEl: Element | null = null;
let disconnected = false;

class FakeResizeObserver {
  constructor(cb: () => void) { observerCallback = cb; }
  observe(el: Element) { observedEl = el; }
  disconnect() { disconnected = true; }
  unobserve() { /* unused */ }
}

/** Host that wires the composable to a real element, like the real callers. */
function mountField(height = 100) {
  const el = ref<HTMLElement | null>(null);
  let api!: ReturnType<typeof useGrowableField>;
  const Comp = defineComponent({
    setup() {
      api = useGrowableField(() => el.value);
      return () => h("div", {
        ref: (r) => { el.value = r as HTMLElement | null; },
      });
    },
  });
  const wrap = mount(Comp, { attachTo: document.body });
  const node = wrap.element as HTMLElement;
  // jsdom reports 0 for everything; stub the geometry these read.
  node.getBoundingClientRect = () => ({
    height, bottom: height, top: 0, left: 0, right: 0, width: 100, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  // Real callers wire the observer from their own `onMounted`.
  api.attach();
  return { wrap, api, node };
}

beforeEach(() => {
  observerCallback = null;
  observedEl = null;
  disconnected = false;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // Run rAF synchronously so the deferred flush is observable.
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    fn(0); return 0;
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("useGrowableField — auto-grow yields to the drag", () => {
  it("auto-sizes while the user has not touched the handle", () => {
    const { api, node, wrap } = mountField();
    Object.defineProperty(node, "scrollHeight", { value: 240, configurable: true });
    api.autosize();
    expect(node.style.height).toBe("240px");
    wrap.unmount();
  });

  it("STOPS auto-sizing once the user has resized — the collapse-springs-back bug", () => {
    const { api, node, wrap } = mountField();
    Object.defineProperty(node, "scrollHeight", { value: 240, configurable: true });
    api.userResized.value = true;
    node.style.height = "60px";
    api.autosize();
    // Would have been stomped back to 240px before.
    expect(node.style.height).toBe("60px");
    wrap.unmount();
  });

  it("respects a minimum height", () => {
    const el = ref<HTMLElement | null>(null);
    let api!: ReturnType<typeof useGrowableField>;
    const Comp = defineComponent({
      setup() {
        api = useGrowableField(() => el.value, { minHeight: 80 });
        return () => h("div", { ref: (r) => { el.value = r as HTMLElement | null; } });
      },
    });
    const wrap = mount(Comp, { attachTo: document.body });
    const node = wrap.element as HTMLElement;
    api.attach();
    Object.defineProperty(node, "scrollHeight", { value: 20, configurable: true });
    api.autosize();
    expect(node.style.height).toBe("80px");
    wrap.unmount();
  });
});

describe("useGrowableField — the observer callback stays cheap", () => {
  it("does NOT read layout synchronously inside the ResizeObserver callback", () => {
    // The bug: measuring and writing reactive state inside the callback dirties
    // layout in the very callback the browser uses to report it. Chrome
    // throttles that and drops a frame, which feels like the drag seizing up.
    // The callback must only schedule.
    const { wrap, node } = mountField();
    let reads = 0;
    Object.defineProperty(node, "scrollHeight", {
      get() { reads++; return 300; },
      configurable: true,
    });
    // Take rAF away so a deferred flush cannot run — anything measured now
    // would have to have come from the callback itself.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    expect(observerCallback).toBeTypeOf("function");
    observerCallback?.();
    expect(reads).toBe(0);
    wrap.unmount();
  });

  it("observes the element and disconnects on unmount", () => {
    const { wrap, node } = mountField();
    expect(observedEl).toBe(node);
    wrap.unmount();
    expect(disconnected).toBe(true);
  });

  it("flags a user resize once a height change it did not author lands", () => {
    const { wrap, api, node } = mountField(100);
    Object.defineProperty(node, "scrollHeight", { value: 100, configurable: true });
    expect(api.userResized.value).toBe(false);
    node.getBoundingClientRect = () => ({
      height: 60, bottom: 60, top: 0, left: 0, right: 0, width: 100, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    observerCallback?.();
    expect(api.userResized.value).toBe(true);
    wrap.unmount();
  });

  it("does not mistake its OWN autosize write for a user drag", () => {
    const { wrap, api, node } = mountField(100);
    Object.defineProperty(node, "scrollHeight", { value: 300, configurable: true });
    api.autosize();
    node.getBoundingClientRect = () => ({
      height: 300, bottom: 300, top: 0, left: 0, right: 0, width: 100, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    observerCallback?.();
    expect(api.userResized.value).toBe(false);
    wrap.unmount();
  });
});
