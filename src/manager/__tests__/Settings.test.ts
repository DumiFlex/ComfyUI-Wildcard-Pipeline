import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Settings from "../views/Settings.vue";
import { useUiStore } from "../stores/uiStore";

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => vi.clearAllMocks());

describe("Settings.vue", () => {
  it("renders About / Theme / Storage cards", () => {
    const wrap = mount(Settings);
    const text = wrap.text();
    expect(text).toContain("Settings");
    expect(text).toContain("About");
    expect(text).toContain("Theme");
    expect(text).toContain("Storage");
  });

  it("clicking a theme chip swaps uiStore.themeMode", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    expect(store.themeMode).toBeDefined();
    await wrap.get('[data-test="settings-theme-light"]').trigger("click");
    expect(store.themeMode).toBe("light");
    await wrap.get('[data-test="settings-theme-auto"]').trigger("click");
    expect(store.themeMode).toBe("auto");
    await wrap.get('[data-test="settings-theme-dark"]').trigger("click");
    expect(store.themeMode).toBe("dark");
  });

  it("active theme chip carries data-active='true'", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    store.setThemeMode("light");
    await wrap.vm.$nextTick();
    const lightChip = wrap.get('[data-test="settings-theme-light"]');
    const darkChip = wrap.get('[data-test="settings-theme-dark"]');
    expect(lightChip.attributes("data-active")).toBe("true");
    expect(darkChip.attributes("data-active")).toBe("false");
  });
});
