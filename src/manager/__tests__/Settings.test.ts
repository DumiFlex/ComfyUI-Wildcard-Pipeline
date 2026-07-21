import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Settings from "../views/Settings.vue";
import { useUiStore } from "../stores/uiStore";

// DatabaseCard onMounted calls databaseStore.fetchInfo(), which hits
// api.database.info(). Stub the client so Settings tests don't depend
// on a real /wp/api/database/info endpoint.
vi.mock("../api/client", () => ({
  api: {
    database: { info: vi.fn().mockResolvedValue(null), maintenance: vi.fn() },
  },
  ApiError: class ApiError extends Error {},
}));

// The Updates card calls useReleaseCheck, which otherwise fires a real
// GitHub fetch on mount. Stub it — these tests cover the other cards.
vi.mock("../composables/useReleaseCheck", () => ({
  useReleaseCheck: () => ({
    current: "2.9.0",
    latestVersion: ref(null),
    hasUpdate: ref(false),
    severity: ref(null),
    releaseBody: ref(null),
    releaseUrl: ref(null),
    lastChecked: ref(null),
    checking: ref(false),
    checkNow: vi.fn(),
  }),
}));

const reloadMock = vi.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  reloadMock.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadMock },
  });
});
afterEach(() => vi.clearAllMocks());

describe("Settings.vue", () => {
  it("renders About / Theme / Browser preferences / Database cards", () => {
    const wrap = mount(Settings);
    const text = wrap.text();
    expect(text).toContain("Settings");
    expect(text).toContain("About");
    expect(text).toContain("Theme");
    expect(text).toContain("Browser preferences");
    expect(text).toContain("Database");
  });

  it("mounts BrowserPrefsCard and DatabaseCard", () => {
    const wrap = mount(Settings);
    expect(wrap.findComponent({ name: "BrowserPrefsCard" }).exists()).toBe(true);
    expect(wrap.findComponent({ name: "DatabaseCard" }).exists()).toBe(true);
  });

  it("clearing preferences removes wp.releaseCheck (regression for dot-prefix bug)", async () => {
    localStorage.setItem("wp.releaseCheck", '{"v":"1.0"}');
    localStorage.setItem("wp-theme-mode", "dark");
    localStorage.setItem("Comfy.unrelated", "keep-me");
    const wrap = mount(Settings, { attachTo: document.body });
    const bp = wrap.findComponent({ name: "BrowserPrefsCard" });
    await bp.find("[data-test='browser-prefs-reset']").trigger("click");
    const dialog = bp.findComponent({ name: "ConfirmDialog" });
    dialog.vm.$emit("confirm");
    await wrap.vm.$nextTick();
    expect(localStorage.getItem("wp.releaseCheck")).toBeNull();
    expect(localStorage.getItem("wp-theme-mode")).toBeNull();
    // Non-WP keys must survive
    expect(localStorage.getItem("Comfy.unrelated")).toBe("keep-me");
    wrap.unmount();
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
    // The Input component wraps number inputs in a <div> so the stepper
    // can dock to the right edge. data-test lands on the wrapper —
    // descend to the inner <input> for the typed assertions.
    const wrapper = wrap.get('[data-test="settings-wildcard-max-ref-depth"]');
    const input = wrapper.get<HTMLInputElement>("input");
    expect(input.attributes("type")).toBe("number");
    expect(Number(input.element.value)).toBe(store.maxRefDepth);
  });

  it("changing max_ref_depth updates store and localStorage", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    const input = wrap.get('[data-test="settings-wildcard-max-ref-depth"]').get("input");
    await input.setValue("16");
    await input.trigger("blur");
    expect(store.maxRefDepth).toBe(16);
    expect(localStorage.getItem("wp-wildcard-max-ref-depth")).toBe("16");
  });

  it("max_ref_depth clamps to valid range (1-32)", async () => {
    const wrap = mount(Settings);
    const store = useUiStore();
    const input = wrap.get('[data-test="settings-wildcard-max-ref-depth"]').get("input");

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
