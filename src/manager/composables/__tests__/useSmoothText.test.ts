import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { nextCut, step, useSmoothText } from "../useSmoothText";

describe("nextCut", () => {
  it("cuts at the end of the word, keeping the spaces after it", () => {
    expect(nextCut("one two three", 0)).toBe(4);
    expect(nextCut("one two three", 4)).toBe(8);
    expect(nextCut("one two three", 8)).toBe(13);
  });
  it("stops at a line break", () => {
    expect(nextCut("one\ntwo", 0)).toBe(3);
  });
});

describe("step", () => {
  it("shows one word a frame when little is waiting", () => {
    expect(step("one two three", 0)).toBe(4);
  });
  it("shows more a frame when a lot is waiting, so it catches up", () => {
    const long = "word ".repeat(200);
    expect(step(long, 0)).toBeGreaterThan(50);
  });
  it("shows everything once caught up", () => {
    expect(step("done", 4)).toBe(4);
  });
});

describe("useSmoothText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reveals new words over frames, and a rewrite at once", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const src = ref("");
    const shown = useSmoothText(() => src.value);
    src.value = "one two three";
    await nextTick();
    expect(shown.value).toBe("");
    frames.shift()?.(0);
    expect(shown.value).toBe("one ");
    while (frames.length) frames.shift()?.(0);
    expect(shown.value).toBe("one two three");
    src.value = "something else";
    await nextTick();
    expect(shown.value).toBe("something else");
  });

  it("shows everything at once with reduced motion", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const src = ref("");
    const shown = useSmoothText(() => src.value);
    src.value = "one two three";
    await nextTick();
    expect(shown.value).toBe("one two three");
  });
});
