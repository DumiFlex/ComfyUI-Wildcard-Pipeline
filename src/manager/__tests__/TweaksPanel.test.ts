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
  document.documentElement.removeAttribute("data-wp-palette");
  document.documentElement.removeAttribute("data-wp-look");
  localStorage.clear();
});

describe("TweaksPanel.vue", () => {
  it("renders the theme's own swatch, 5 presets and the custom swatch", () => {
    const wrap = mount(TweaksPanel);
    const swatches = wrap.findAll('[data-test^="tweaks-accent-"]');
    expect(swatches).toHaveLength(7);
    expect(wrap.find('[data-test="tweaks-accent-theme"]').exists()).toBe(true);
    // Custom swatch sits at the end of the row.
    expect(wrap.find('[data-test="tweaks-accent-custom"]').exists()).toBe(true);
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
    await wrap.find('[data-test="tweaks-density-compact"]').trigger("click");
    expect(tweaks.density).toBe("compact");
    expect(document.documentElement.classList.contains("wp-density-compact")).toBe(true);

    await wrap.find('[data-test="tweaks-density-comfortable"]').trigger("click");
    expect(tweaks.density).toBe("comfortable");
    expect(document.documentElement.classList.contains("wp-density-compact")).toBe(false);
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
    expect(tweaks.accent).toBe("theme");
    expect(tweaks.density).toBe("comfortable");
  });

  it("sidebar toggle drives ui.sidebarCollapsed", async () => {
    const wrap = mount(TweaksPanel);
    const ui = useUiStore();
    const tweaks = useTweaksStore();
    expect(ui.sidebarCollapsed).toBe(false);
    // Click the underlying switch button rendered by Toggle.
    const switchBtn = wrap.find('[data-test="tweaks-sidebar-toggle"]');
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

describe("TweaksPanel.vue — colours and look", () => {
  it("shows 6 colour themes and 7 looks, and picking one applies it", async () => {
    const wrap = mount(TweaksPanel);
    expect(wrap.findAll('[data-test^="tweaks-palette-"]')).toHaveLength(6);
    expect(wrap.findAll('[data-test^="tweaks-look-"]')).toHaveLength(7);
    await wrap.find('[data-test="tweaks-palette-nebula"]').trigger("click");
    await wrap.find('[data-test="tweaks-look-soft"]').trigger("click");
    expect(document.documentElement.getAttribute("data-wp-palette")).toBe("nebula");
    expect(document.documentElement.getAttribute("data-wp-look")).toBe("soft");
    expect(wrap.find('[data-test="tweaks-palette-nebula"]').attributes("aria-checked")).toBe("true");
  });

  it("hides the accent swatches under High contrast", async () => {
    const wrap = mount(TweaksPanel);
    await wrap.find('[data-test="tweaks-palette-contrast"]').trigger("click");
    expect(wrap.find('[data-test="tweaks-accent-violet"]').exists()).toBe(false);
    expect(wrap.text()).toContain("High contrast keeps its own accent");
  });
});
