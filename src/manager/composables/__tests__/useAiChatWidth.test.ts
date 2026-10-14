import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { AI_CHAT_DEFAULT, AI_CHAT_MIN, clampWidth, maxWidth, useAiChatWidth } from "../useAiChatWidth";

function host() {
  let api!: ReturnType<typeof useAiChatWidth>;
  const w = mount(defineComponent({ setup() { api = useAiChatWidth(); return () => h("div"); } }));
  return { w, api };
}

const cssWidth = () => document.documentElement.style.getPropertyValue("--wp-ai-chat-w");

describe("useAiChatWidth", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
  });
  afterEach(() => document.documentElement.style.removeProperty("--wp-ai-chat-w"));

  it("keeps the width between the minimum and what leaves the page room", () => {
    expect(maxWidth(1600)).toBe(840);
    expect(maxWidth(1200)).toBe(440);
    expect(maxWidth(1000)).toBe(AI_CHAT_MIN);
    expect(maxWidth(500)).toBe(AI_CHAT_MIN);
    expect(clampWidth(100, 1600)).toBe(AI_CHAT_MIN);
    expect(clampWidth(5000, 1200)).toBe(440);
    expect(clampWidth(Number.NaN)).toBe(AI_CHAT_DEFAULT);
  });

  it("drags wider to the left and remembers the width", () => {
    const { w, api } = host();
    expect(cssWidth()).toBe("440px");
    api.startDrag(new PointerEvent("pointerdown", { clientX: 1000, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 800 }));
    expect(api.width.value).toBe(640);
    expect(document.documentElement.style.cursor).toBe("col-resize");
    window.dispatchEvent(new PointerEvent("pointerup", {}));
    expect(document.documentElement.style.cursor).toBe("");
    expect(localStorage.getItem("wp-ai-chat-width")).toBe("640");
    w.unmount();
    expect(host().api.width.value).toBe(640);
  });

  it("moves with the arrow keys, Home and End, and resets", () => {
    const { api } = host();
    const key = (k: string, shiftKey = false) => api.onKey(new KeyboardEvent("keydown", { key: k, shiftKey }));
    key("ArrowLeft");
    expect(api.width.value).toBe(456);
    key("ArrowRight", true);
    expect(api.width.value).toBe(392);
    key("End");
    expect(api.width.value).toBe(840);
    key("Home");
    expect(api.width.value).toBe(AI_CHAT_MIN);
    api.reset();
    expect(api.width.value).toBe(AI_CHAT_DEFAULT);
    expect(localStorage.getItem("wp-ai-chat-width")).toBeNull();
  });

  it("fits a smaller window without forgetting the chosen width", () => {
    localStorage.setItem("wp-ai-chat-width", "800");
    const { api } = host();
    expect(api.width.value).toBe(800);
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    window.dispatchEvent(new Event("resize"));
    expect(api.width.value).toBe(440);
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
    window.dispatchEvent(new Event("resize"));
    expect(api.width.value).toBe(800);
  });
});
