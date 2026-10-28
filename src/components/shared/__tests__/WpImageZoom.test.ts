import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import WpImageZoom from "../WpImageZoom.vue";

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
});
