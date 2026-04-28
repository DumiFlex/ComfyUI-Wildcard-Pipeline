import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import TweaksPanel from "../components/TweaksPanel.vue";
import { useTweaksStore, ACCENT_PALETTES } from "../stores/tweaksStore";
import { useUiStore } from "../stores/uiStore";

beforeEach(() => {
  setActivePinia(createPinia());
  document.documentElement.style.cssText = "";
  document.documentElement.removeAttribute("data-accent");
  localStorage.clear();
});

describe("TweaksPanel.vue", () => {
  it("renders 5 accent swatches", () => {
    const wrap = mount(TweaksPanel);
    const swatches = wrap.findAll('[data-test^="tweaks-accent-"]');
    expect(swatches).toHaveLength(5);
  });

  it("clicking the violet swatch calls setAccent('violet') and writes the palette", async () => {
    const wrap = mount(TweaksPanel);
    const tweaks = useTweaksStore();
    // Start from a non-default accent so the click materially changes things.
    tweaks.setAccent("amber");
    await wrap.find('[data-test="tweaks-accent-violet"]').trigger("click");
    expect(tweaks.accent).toBe("violet");
    expect(document.documentElement.style.getPropertyValue("--wp-accent-500")).toBe(
      ACCENT_PALETTES.violet["--wp-accent-500"],
    );
  });

  it("each swatch updates the store accent", async () => {
    const wrap = mount(TweaksPanel);
    const tweaks = useTweaksStore();
    for (const name of ["indigo", "teal", "rose", "amber"] as const) {
      await wrap.find(`[data-test="tweaks-accent-${name}"]`).trigger("click");
      expect(tweaks.accent).toBe(name);
    }
  });

  it("density radio toggles setDensity", async () => {
    const wrap = mount(TweaksPanel);
    const tweaks = useTweaksStore();
    expect(tweaks.density).toBe("comfortable");
    await wrap.find('[data-test="tweaks-density-compact"]').trigger("change");
    expect(tweaks.density).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--wp-input-h")).toBe("34px");

    await wrap.find('[data-test="tweaks-density-comfortable"]').trigger("change");
    expect(tweaks.density).toBe("comfortable");
    expect(document.documentElement.style.getPropertyValue("--wp-input-h")).toBe("38px");
  });

  it("close button calls closePanel", async () => {
    const wrap = mount(TweaksPanel);
    const tweaks = useTweaksStore();
    tweaks.togglePanel();
    expect(tweaks.panelOpen).toBe(true);
    await wrap.find('[data-test="tweaks-close"]').trigger("click");
    expect(tweaks.panelOpen).toBe(false);
  });

  it("reset button restores defaults", async () => {
    const wrap = mount(TweaksPanel);
    const tweaks = useTweaksStore();
    tweaks.setAccent("rose");
    tweaks.setDensity("compact");
    await wrap.find('[data-test="tweaks-reset"]').trigger("click");
    expect(tweaks.accent).toBe("violet");
    expect(tweaks.density).toBe("comfortable");
  });

  it("sidebar toggle drives ui.sidebarCollapsed", async () => {
    const wrap = mount(TweaksPanel);
    const ui = useUiStore();
    const tweaks = useTweaksStore();
    expect(ui.sidebarCollapsed).toBe(false);
    // Click the underlying switch button rendered by Toggle.
    const switchBtn = wrap.find('[data-test="tweaks-sidebar-toggle"] .wp-toggle');
    await switchBtn.trigger("click");
    expect(ui.sidebarCollapsed).toBe(true);
    expect(tweaks.sidebarMode).toBe("collapsed");
  });

  it("backdrop only renders when panel is open", async () => {
    const wrap = mount(TweaksPanel);
    const tweaks = useTweaksStore();
    expect(wrap.find('[data-test="tweaks-backdrop"]').exists()).toBe(false);
    tweaks.togglePanel();
    await wrap.vm.$nextTick();
    expect(wrap.find('[data-test="tweaks-backdrop"]').exists()).toBe(true);
  });
});
