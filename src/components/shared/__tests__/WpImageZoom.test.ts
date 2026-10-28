import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import WpImageZoom from "../WpImageZoom.vue";
import { IDLE_MS } from "../image-zoom";

/** jsdom has no layout: give the stage a size and the image a natural size. */
async function ready(w: ReturnType<typeof mount>, size = { w: 400, h: 200 }, natural = { w: 800, h: 800 }) {
  const stage = w.find('[data-test="imgzoom-stage"]').element as HTMLElement;
  Object.defineProperty(stage, "clientWidth", { value: size.w, configurable: true });
  Object.defineProperty(stage, "clientHeight", { value: size.h, configurable: true });
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: size.w, height: size.h, right: size.w, bottom: size.h, x: 0, y: 0, toJSON: () => ({}) });
  // Re-measure: a resize, as the observer would report.
  await w.setProps({ controls: true });
  const img = w.find("img").element as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: natural.w, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: natural.h, configurable: true });
  await w.find("img").trigger("load");
}

function last(w: ReturnType<typeof mount>): unknown[] | undefined {
  const all = w.emitted("update:zoom");
  return all?.[all.length - 1];
}

describe("WpImageZoom", () => {
  it("opens at Fit and the bar sets real levels", async () => {
    const w = mount(WpImageZoom, { props: { src: "a.png", zoom: null }, attachTo: document.body });
    await ready(w);
    // 800 x 800 in 400 x 200: Fit is 25%.
    expect(w.find('[data-test="imgzoom-level"]').text()).toBe("25%");
    await w.find('[data-test="imgzoom-100"]').trigger("click");
    expect(last(w)).toEqual([1]);
    expect(w.find('[data-test="imgzoom-level"]').text()).toBe("100%");
    await w.find('[data-test="imgzoom-in"]').trigger("click");
    expect(last(w)).toEqual([1.5]);
    await w.find('[data-test="imgzoom-fit"]').trigger("click");
    expect(last(w)).toEqual([null]);
    w.unmount();
  });

  it("keys + 0 1 2 work when it has focus", async () => {
    const w = mount(WpImageZoom, { props: { src: "a.png" }, attachTo: document.body });
    await ready(w);
    const stage = w.find('[data-test="imgzoom-stage"]');
    await stage.trigger("keydown", { key: "2" });
    expect(last(w)).toEqual([2]);
    await stage.trigger("keydown", { key: "-" });
    expect(last(w)).toEqual([1.5]);
    await stage.trigger("keydown", { key: "0" });
    expect(last(w)).toEqual([null]);
    w.unmount();
  });

  it("the wheel zooms in toward the pointer", async () => {
    const w = mount(WpImageZoom, { props: { src: "a.png" }, attachTo: document.body });
    await ready(w);
    w.find('[data-test="imgzoom-stage"]').element.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 100, clientY: 100, cancelable: true }));
    await w.vm.$nextTick();
    const z = Number(last(w)?.[0]);
    expect(z).toBeGreaterThan(0.25);
    w.unmount();
  });

  it("offers Fullscreen only when asked, and F fills the screen with the viewer", async () => {
    const plain = mount(WpImageZoom, { props: { src: "a.png" } });
    expect(plain.find('[data-test="imgzoom-full"]').exists()).toBe(false);
    plain.unmount();

    const w = mount(WpImageZoom, { props: { src: "a.png", fullscreen: true }, attachTo: document.body });
    await ready(w);
    const root = w.element as HTMLElement;
    let asked = 0;
    root.requestFullscreen = () => {
      asked++;
      Object.defineProperty(document, "fullscreenElement", { value: root, configurable: true });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    await w.find('[data-test="imgzoom-stage"]').trigger("keydown", { key: "f" });
    await w.vm.$nextTick();
    expect(asked).toBe(1);
    expect(root.classList.contains("is-full")).toBe(true);
    expect(w.find('[data-test="imgzoom-full"]').attributes("aria-label")).toBe("Leave fullscreen");
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
    await w.vm.$nextTick();
    expect(root.classList.contains("is-full")).toBe(false);
    w.unmount();
  });

  it("shows a mini-map once zoomed past the stage, and a click there moves the view", async () => {
    const w = mount(WpImageZoom, { props: { src: "a.png", minimap: true }, attachTo: document.body });
    await ready(w);
    expect(w.find('[data-test="imgzoom-map"]').exists()).toBe(false);
    await w.find('[data-test="imgzoom-100"]').trigger("click");
    const map = w.find('[data-test="imgzoom-map"]');
    expect(map.exists()).toBe(true);
    // 400 x 200 of an 800 x 800 picture at 100%: the box is half wide, a quarter high, centred.
    const box = map.find('[data-test="imgzoom-map-box"]').attributes("style");
    expect(box).toContain("width: 50%");
    expect(box).toContain("height: 25%");
    const el = map.element as HTMLElement;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 0, clientY: 0, pointerId: 1 }));
    await w.vm.$nextTick();
    const moved = map.find('[data-test="imgzoom-map-box"]').attributes("style");
    expect(moved).toContain("left: 0%");
    expect(moved).toContain("top: 0%");
    w.unmount();
  });

  it("autohide fades the bar after a still spell and a move brings it back", async () => {
    vi.useFakeTimers();
    try {
      const w = mount(WpImageZoom, { props: { src: "a.png", autohide: true, hint: "Drag" }, attachTo: document.body });
      await ready(w);
      expect(w.classes()).not.toContain("is-idle");
      vi.advanceTimersByTime(IDLE_MS + 10);
      await w.vm.$nextTick();
      expect(w.classes()).toContain("is-idle");
      w.element.dispatchEvent(new PointerEvent("pointermove"));
      await w.vm.$nextTick();
      expect(w.classes()).not.toContain("is-idle");
      // Hovering the bar keeps it up.
      await w.find('[role="toolbar"]').trigger("pointerenter");
      vi.advanceTimersByTime(IDLE_MS * 2);
      await w.vm.$nextTick();
      expect(w.classes()).not.toContain("is-idle");
      w.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second picture shares the first one's view, in two half-width panes", async () => {
    const w = mount(WpImageZoom, { props: { src: "a.png", second: "b.png" }, attachTo: document.body });
    await ready(w, { w: 408, h: 200 });
    expect(w.classes()).toContain("is-pair");
    const imgs = w.findAll(".wp-imgzoom__img");
    expect(imgs).toHaveLength(2);
    // Each pane is (408 - 8) / 2 = 200 wide: Fit of 800 x 800 is 25%.
    expect(w.find('[data-test="imgzoom-level"]').text()).toBe("25%");
    await w.find('[data-test="imgzoom-200"]').trigger("click");
    expect(imgs[0].attributes("style")).toEqual(imgs[1].attributes("style"));
    w.unmount();
  });

  it("the fullscreen slot shows only while fullscreen", async () => {
    const w = mount(WpImageZoom, {
      props: { src: "a.png", fullscreen: true },
      slots: { fullscreen: '<span data-test="foot">Keep</span>' },
      attachTo: document.body,
    });
    await ready(w);
    expect(w.find('[data-test="foot"]').exists()).toBe(false);
    const root = w.element as HTMLElement;
    Object.defineProperty(document, "fullscreenElement", { value: root, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
    await w.vm.$nextTick();
    expect(w.find('[data-test="foot"]').exists()).toBe(true);
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    document.dispatchEvent(new Event("fullscreenchange"));
    w.unmount();
  });
});
