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

  it("renders Wildcard card with max_ref_depth field", () => {
    const wrap = mount(Settings);
    const text = wrap.text();
    expect(text).toContain("Wildcard");
    expect(text).toContain("Ref recursion limit");
    expect(wrap.find('[data-test="settings-wildcard-max-ref-depth"]').exists()).toBe(true);
  });

  it("max_ref_depth field has correct type and default value", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    const input = wrap.get<HTMLInputElement>('[data-test="settings-wildcard-max-ref-depth"]');
    expect(input.attributes("type")).toBe("number");
    expect(Number(input.element.value)).toBe(store.maxRefDepth);
  });

  it("changing max_ref_depth updates store and localStorage", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    const input = wrap.get('[data-test="settings-wildcard-max-ref-depth"]');
    await input.setValue("16");
    await input.trigger("blur");
    expect(store.maxRefDepth).toBe(16);
    expect(localStorage.getItem("wp-wildcard-max-ref-depth")).toBe("16");
  });

  it("max_ref_depth clamps to valid range (1-32)", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    const input = wrap.get('[data-test="settings-wildcard-max-ref-depth"]');

    // Test clamping to min
    await input.setValue("0");
    await input.trigger("blur");
    expect(store.maxRefDepth).toBe(1);

    // Test clamping to max
    await input.setValue("100");
    await input.trigger("blur");
    expect(store.maxRefDepth).toBe(32);

    // Test valid value in range
    await input.setValue("15");
    await input.trigger("blur");
    expect(store.maxRefDepth).toBe(15);
  });
});
