import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import AiPointer from "../AiPointer.vue";
import { clearPointer, pointers } from "../../../composables/useAiActions";

function part(top: number, left: number, width = 200, height = 24): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("AiPointer", () => {
  afterEach(() => {
    clearPointer();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps captions of parts under each other from landing on one another", async () => {
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 800);
    // Each caption measures 160 × 30; jsdom gives 0 otherwise.
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 160 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 30 });
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const w = mount(AiPointer, { attachTo: document.body });
    // Three rows 28 px apart: a caption under row 1 would cover row 2's.
    pointers.value = [
      { el: part(100, 40), caption: "Pick the model here", key: "a" },
      { el: part(128, 40), caption: "Save keeps the choice", key: "b" },
      { el: part(156, 40), caption: "Then test it", key: "c" },
    ];
    await nextTick();
    // The watcher placed them once; run the tracker again now that the
    // captions exist and measure.
    pointers.value = [...pointers.value];
    await nextTick();
    // The pointer teleports to the body.
    const caps = [...document.querySelectorAll<HTMLElement>('[data-test="ai-pointer-caption"]')];
    expect(caps).toHaveLength(3);
    const boxes = caps.map((c) => ({ top: parseFloat(c.style.top), left: parseFloat(c.style.left) }));
    // Each caption sits clear of the ones before it.
    for (let i = 1; i < boxes.length; i++) {
      for (let j = 0; j < i; j++) {
        const apart = boxes[i].top >= boxes[j].top + 30 || boxes[i].left >= boxes[j].left + 160
          || boxes[j].top >= boxes[i].top + 30 || boxes[j].left >= boxes[i].left + 160;
        expect(apart, `caption ${i + 1} overlaps ${j + 1}`).toBe(true);
      }
    }
    // The first one is where it always was: under its part.
    expect(boxes[0]).toEqual({ top: 100 + 24 + 8, left: 40 });
    clearPointer();
    await nextTick();
    w.unmount();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  });
});
