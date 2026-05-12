import { describe, it, expect, beforeEach, vi } from "vitest";
import { shouldAnimate, captureRects, applyFlip, MOTION_FLIP_MS } from "./flip";

describe("shouldAnimate", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  it("returns true when reduce-motion class is absent", () => {
    expect(shouldAnimate()).toBe(true);
  });

  it("returns false when .wp-a11y-no-motion is on body", () => {
    document.body.classList.add("wp-a11y-no-motion");
    expect(shouldAnimate()).toBe(false);
  });
});

describe("captureRects", () => {
  it("returns a Map keyed by the caller's key function", () => {
    const container = document.createElement("div");
    const a = document.createElement("span");
    a.dataset.uid = "uid-a";
    const b = document.createElement("span");
    b.dataset.uid = "uid-b";
    container.append(a, b);
    document.body.appendChild(container);

    vi.spyOn(a, "getBoundingClientRect").mockReturnValue({
      top: 10, left: 0, right: 100, bottom: 30, width: 100, height: 20, x: 0, y: 10, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(b, "getBoundingClientRect").mockReturnValue({
      top: 40, left: 0, right: 100, bottom: 60, width: 100, height: 20, x: 0, y: 40, toJSON: () => ({}),
    } as DOMRect);

    const result = captureRects(container, el => el.dataset.uid ?? null);

    expect(result.size).toBe(2);
    expect(result.get("uid-a")?.top).toBe(10);
    expect(result.get("uid-b")?.top).toBe(40);

    document.body.removeChild(container);
  });

  it("skips children where the key function returns null", () => {
    const container = document.createElement("div");
    const a = document.createElement("span");
    a.dataset.uid = "uid-a";
    const b = document.createElement("span");
    container.append(a, b);
    document.body.appendChild(container);

    const result = captureRects(container, el => el.dataset.uid ?? null);

    expect(result.size).toBe(1);
    expect(result.has("uid-a")).toBe(true);

    document.body.removeChild(container);
  });
});

describe("applyFlip", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  function makeChild(uid: string, rect: Partial<DOMRect>): HTMLElement {
    const el = document.createElement("div");
    el.dataset.uid = uid;
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
      ...rect,
    } as DOMRect);
    return el;
  }

  it("applies inverse-translate then transitions to identity for moved children", async () => {
    const container = document.createElement("div");
    const a = makeChild("uid-a", { top: 40, left: 0 });
    container.appendChild(a);
    document.body.appendChild(container);

    const before = new Map<string, DOMRect>();
    before.set("uid-a", { top: 10, left: 0 } as DOMRect);

    applyFlip(container, before, el => el.dataset.uid ?? null);

    expect(a.style.transition).toBe("none");
    expect(a.style.transform).toBe("translate(0px, -30px)");

    await new Promise(r => requestAnimationFrame(r));
    expect(a.style.transition).toContain("transform");
    expect(a.style.transition).toContain(`${MOTION_FLIP_MS}ms`);
    expect(a.style.transform).toBe("translate(0, 0)");

    document.body.removeChild(container);
  });

  it("no-ops when reduce-motion is on", () => {
    document.body.classList.add("wp-a11y-no-motion");
    const container = document.createElement("div");
    const a = makeChild("uid-a", { top: 40 });
    container.appendChild(a);
    document.body.appendChild(container);

    const before = new Map<string, DOMRect>();
    before.set("uid-a", { top: 10 } as DOMRect);

    applyFlip(container, before, el => el.dataset.uid ?? null);

    expect(a.style.transition).toBe("");
    expect(a.style.transform).toBe("");

    document.body.removeChild(container);
  });

  it("skips children whose position did not change", () => {
    const container = document.createElement("div");
    const a = makeChild("uid-a", { top: 10, left: 0 });
    container.appendChild(a);
    document.body.appendChild(container);

    const before = new Map<string, DOMRect>();
    before.set("uid-a", { top: 10, left: 0 } as DOMRect);

    applyFlip(container, before, el => el.dataset.uid ?? null);

    expect(a.style.transform).toBe("");
    document.body.removeChild(container);
  });

  it("honors custom duration + ease options", async () => {
    const container = document.createElement("div");
    const a = makeChild("uid-a", { top: 40 });
    container.appendChild(a);
    document.body.appendChild(container);

    const before = new Map<string, DOMRect>();
    before.set("uid-a", { top: 10 } as DOMRect);

    applyFlip(container, before, el => el.dataset.uid ?? null, { duration: 500, ease: "ease-in" });

    await new Promise(r => requestAnimationFrame(r));
    expect(a.style.transition).toContain("500ms");
    expect(a.style.transition).toContain("ease-in");

    document.body.removeChild(container);
  });
});

describe("withEnterAnimation", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  it("calls mutate then adds --arriving + --arrived classes", async () => {
    const { withEnterAnimation } = await import("./flip");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mutate = vi.fn(() => {
      const el = document.createElement("div");
      el.classList.add("wp-module");
      el.dataset.uid = "uid-new";
      container.appendChild(el);
    });

    await withEnterAnimation("uid-new", container, mutate);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    expect(mutate).toHaveBeenCalled();
    const el = container.querySelector<HTMLElement>("[data-uid='uid-new']");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("wp-module--arriving")).toBe(true);
    expect(el?.classList.contains("wp-module--arrived")).toBe(true);

    document.body.removeChild(container);
  });

  it("calls mutate but skips class application when reduce-motion is on", async () => {
    document.body.classList.add("wp-a11y-no-motion");
    const { withEnterAnimation } = await import("./flip");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mutate = vi.fn(() => {
      const el = document.createElement("div");
      el.dataset.uid = "uid-new";
      container.appendChild(el);
    });

    await withEnterAnimation("uid-new", container, mutate);

    expect(mutate).toHaveBeenCalled();
    const el = container.querySelector<HTMLElement>("[data-uid='uid-new']");
    expect(el?.classList.contains("wp-module--arriving")).toBe(false);

    document.body.removeChild(container);
  });
});

describe("withLeaveAnimation", () => {
  beforeEach(() => {
    document.body.className = "";
  });

  it("adds --leaving class, waits MOTION_FADE_MS, then calls mutate", async () => {
    vi.useFakeTimers();
    const { withLeaveAnimation, MOTION_FADE_MS } = await import("./flip");
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.dataset.uid = "uid-old";
    container.appendChild(el);
    document.body.appendChild(container);

    const mutate = vi.fn(() => {
      container.removeChild(el);
    });

    const promise = withLeaveAnimation("uid-old", container, mutate);

    expect(el.classList.contains("wp-module--leaving")).toBe(true);
    expect(mutate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MOTION_FADE_MS);
    await promise;
    expect(mutate).toHaveBeenCalled();

    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it("calls mutate immediately when reduce-motion is on", async () => {
    document.body.classList.add("wp-a11y-no-motion");
    const { withLeaveAnimation } = await import("./flip");
    const container = document.createElement("div");
    const el = document.createElement("div");
    el.dataset.uid = "uid-old";
    container.appendChild(el);
    document.body.appendChild(container);

    const mutate = vi.fn();
    await withLeaveAnimation("uid-old", container, mutate);

    expect(mutate).toHaveBeenCalled();
    expect(el.classList.contains("wp-module--leaving")).toBe(false);

    document.body.removeChild(container);
  });
});
