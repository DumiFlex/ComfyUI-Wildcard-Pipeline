import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MaskPainter from "./MaskPainter.vue";

function at(w: ReturnType<typeof mount>, type: string, x: number, y: number): Promise<void> {
  const canvas = w.find("canvas").element as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100, right: 210, bottom: 120, x: 10, y: 20, toJSON: () => ({}) });
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: type !== "pointerenter" && type !== "pointerleave" }));
  return w.vm.$nextTick();
}

describe("MaskPainter brush ring", () => {
  it("follows the pointer at the brush size and hides when it leaves", async () => {
    const w = mount(MaskPainter, { props: { src: "a.png", modelValue: "", size: 30 } });
    expect(w.find('[data-test="image-filter-brush-ring"]').exists()).toBe(false);
    await at(w, "pointerenter", 60, 70);
    await at(w, "pointermove", 110, 70);
    const ring = w.find('[data-test="image-filter-brush-ring"]');
    expect(ring.attributes("style")).toContain("width: 30px");
    // Centred on the pointer: (110 - 10) - 15, (70 - 20) - 15.
    expect(ring.attributes("style")).toContain("translate(85px, 35px)");
    expect(ring.classes()).not.toContain("is-eraser");
    expect(w.find('[data-test="image-filter-brush-soft"]').exists()).toBe(false);
    await w.setProps({ erase: true, size: 50, hardness: 40 });
    expect(w.find('[data-test="image-filter-brush-ring"]').classes()).toContain("is-eraser");
    expect(w.find('[data-test="image-filter-brush-ring"]').attributes("style")).toContain("width: 50px");
    // A soft brush shows where its solid middle ends.
    expect(w.find('[data-test="image-filter-brush-soft"]').attributes("style")).toContain("width: 40%");
    await at(w, "pointerleave", 300, 70);
    expect(w.find('[data-test="image-filter-brush-ring"]').exists()).toBe(false);
  });

  it("the lasso and fill have a crosshair instead of the ring", async () => {
    const w = mount(MaskPainter, { props: { src: "a.png", modelValue: "", tool: "lasso" } });
    await at(w, "pointerenter", 60, 70);
    expect(w.find('[data-test="image-filter-brush-ring"]').exists()).toBe(false);
    expect(w.find("canvas").attributes("data-tool")).toBe("lasso");
    await w.setProps({ tool: "fill" });
    expect(w.find("canvas").classes()).toContain("is-fill");
  });
});
