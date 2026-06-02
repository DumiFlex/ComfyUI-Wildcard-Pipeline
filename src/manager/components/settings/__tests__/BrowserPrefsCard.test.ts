import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import BrowserPrefsCard from "../BrowserPrefsCard.vue";

const reloadMock = vi.fn();

describe("BrowserPrefsCard", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadMock.mockClear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
  });

  it("renders the bulleted list of what gets reset", () => {
    const wrapper = mount(BrowserPrefsCard);
    const items = wrapper.findAll("[data-test='reset-item']");
    expect(items.length).toBeGreaterThanOrEqual(7);
    const text = wrapper.text().toLowerCase();
    expect(text).toContain("theme");
    expect(text).toContain("density");
    expect(text).toContain("recent");
  });

  it("clears both wp- and wp. prefix localStorage keys on confirm", async () => {
    localStorage.setItem("wp-theme-mode", "dark");
    localStorage.setItem("wp-density-mode", "compact");
    localStorage.setItem("wp.releaseCheck", '{"v":"1.0"}');
    localStorage.setItem("Comfy.unrelated", "keep-me");

    const wrapper = mount(BrowserPrefsCard);
    await wrapper.find("[data-test='browser-prefs-reset']").trigger("click");
    // Drive the confirm through the ConfirmDialog child's `confirm` event
    // rather than reaching for an internal data-test attribute that may
    // not exist on ConfirmDialog's built-in buttons.
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    dialog.vm.$emit("confirm");
    await wrapper.vm.$nextTick();

    expect(localStorage.getItem("wp-theme-mode")).toBeNull();
    expect(localStorage.getItem("wp-density-mode")).toBeNull();
    expect(localStorage.getItem("wp.releaseCheck")).toBeNull();
    // Non-WP keys must survive
    expect(localStorage.getItem("Comfy.unrelated")).toBe("keep-me");
    expect(reloadMock).toHaveBeenCalled();
  });

  it("does NOT clear keys when the user cancels the confirm dialog", async () => {
    localStorage.setItem("wp-theme-mode", "dark");
    const wrapper = mount(BrowserPrefsCard);
    await wrapper.find("[data-test='browser-prefs-reset']").trigger("click");
    const dialog = wrapper.findComponent({ name: "ConfirmDialog" });
    dialog.vm.$emit("cancel");
    await wrapper.vm.$nextTick();
    expect(localStorage.getItem("wp-theme-mode")).toBe("dark");
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
