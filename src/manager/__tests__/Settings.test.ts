import { flushPromises, mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Settings from "../views/Settings.vue";
import { useUiStore } from "../stores/uiStore";
import { useTweaksStore } from "../stores/tweaksStore";
import { _resetServerSettingsForTesting } from "../composables/useServerSettings";
import { settingsRouter } from "./helpers/settingsRouter";

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "2.9.0";
(globalThis as unknown as { __APP_LICENSE__: string }).__APP_LICENSE__ = "MIT";

const serverSettings = { max_ref_depth: 8, backups: { enabled: true, keep: 7, daily: true } };
const updateServer = vi.fn(async (patch: { max_ref_depth?: number }) => {
  Object.assign(serverSettings, patch);
  return { ...serverSettings };
});

// Sections load data on mount. Stub the client so these tests exercise the
// page, not endpoints.
vi.mock("../api/client", () => ({
  api: {
    database: {
      info: vi.fn().mockResolvedValue(null),
      config: vi.fn().mockResolvedValue(null),
      maintenance: vi.fn(),
      backups: vi.fn().mockResolvedValue({ dir: "/db/backups", backups: [], pending_restore: null }),
      createBackup: vi.fn(),
    },
    serverSettings: {
      get: vi.fn(async () => ({ ...serverSettings })),
      update: (patch: { max_ref_depth?: number }) => updateServer(patch),
    },
    tags: { status: vi.fn().mockResolvedValue({ available: false, path: "/tags.csv", tag_count: 0, has_categories: false }) },
    models: { status: vi.fn().mockResolvedValue({ sources: [{ kind: "lora", count: 3 }, { kind: "embedding", count: 0 }] }) },
  },
  ApiError: class ApiError extends Error {},
}));

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
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ "wildcardPipeline.display.density": "compact" })));

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  _resetServerSettingsForTesting();
  serverSettings.max_ref_depth = 8;
  reloadMock.mockClear();
  updateServer.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadMock },
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function mountAt(section: string, hash = "") {
  const router = await settingsRouter(section, hash);
  const wrap = mount(Settings, {
    props: { section },
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrap, router };
}

describe("Settings layout", () => {
  it("lists every section in the nav and marks the active one", async () => {
    const { wrap } = await mountAt("appearance");
    for (const id of ["general", "appearance", "editing", "autocomplete", "canvas", "test-runner", "library", "advanced"]) {
      expect(wrap.find(`[data-test="settings-nav-${id}"]`).exists()).toBe(true);
    }
    expect(wrap.get('[data-test="settings-nav-appearance"]').attributes("data-active")).toBe("true");
    expect(wrap.get('[data-test="settings-nav-general"]').attributes("data-active")).toBe("false");
    wrap.unmount();
  });

  it("falls back to General for an unknown section", async () => {
    const { wrap } = await mountAt("nope");
    expect(wrap.text()).toContain("Check for updates on launch");
    wrap.unmount();
  });

  it("search lists matching settings across sections and opens one", async () => {
    const { wrap, router } = await mountAt("general");
    await wrap.get('[data-test="settings-search"]').setValue("seed");
    const results = wrap.get('[data-test="settings-results"]').text();
    expect(results).toContain("Test Runner");
    expect(results).toContain("First seed");
    await wrap.get('[data-test="settings-result-tr-from"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.section).toBe("test-runner");
    expect(router.currentRoute.value.hash).toBe("#tr-from");
    wrap.unmount();
  });
});

describe("Settings › General", () => {
  it("usage stats default on and the toggle remembers off", async () => {
    const { wrap } = await mountAt("general");
    const store = useUiStore();
    const toggle = wrap.get('[data-test="settings-usage-stats"]').get("button");
    expect(store.usageStats).toBe(true);
    expect(toggle.attributes("aria-checked")).toBe("true");
    await toggle.trigger("click");
    expect(store.usageStats).toBe(false);
    expect(localStorage.getItem("wp-usage-stats")).toBe("0");
    setActivePinia(createPinia());
    expect(useUiStore().usageStats).toBe(false);
    wrap.unmount();
  });
});

describe("Settings › Appearance", () => {
  it("theme segments swap uiStore.themeMode and mark the active one", async () => {
    const { wrap } = await mountAt("appearance");
    const store = useUiStore();
    await wrap.get('[data-test="settings-theme-light"]').trigger("click");
    expect(store.themeMode).toBe("light");
    expect(wrap.get('[data-test="settings-theme-light"]').attributes("data-active")).toBe("true");
    expect(wrap.get('[data-test="settings-theme-dark"]').attributes("data-active")).toBe("false");
    wrap.unmount();
  });

  it("density is one three-way setting shared with the Tweaks panel", async () => {
    const { wrap } = await mountAt("appearance");
    await wrap.get('[data-test="settings-density-cozy"]').trigger("click");
    expect(useUiStore().density).toBe("cozy");
    expect(useTweaksStore().density).toBe("cozy");
    expect(document.documentElement.classList.contains("wp-density-cozy")).toBe(true);
    expect(localStorage.getItem("wp-density-mode")).toBe("cozy");
    wrap.unmount();
  });

  it("accent swatches set the accent", async () => {
    const { wrap } = await mountAt("appearance");
    await wrap.get('[data-test="settings-accent-teal"]').trigger("click");
    expect(useTweaksStore().accent).toBe("teal");
    wrap.unmount();
  });

  it("reduce motion puts a class on <html>", async () => {
    const { wrap } = await mountAt("appearance");
    await wrap.get('[data-test="settings-motion-reduce"]').trigger("click");
    expect(document.documentElement.classList.contains("wp-reduce-motion")).toBe(true);
    expect(localStorage.getItem("wp-motion")).toBe("reduce");
    wrap.unmount();
  });
});

describe("Settings › Canvas", () => {
  it("shows canvas values read from ComfyUI's settings", async () => {
    const { wrap } = await mountAt("canvas");
    expect(fetchMock).toHaveBeenCalledWith("/api/settings");
    expect(wrap.text()).toContain("Module density");
    expect(wrap.text()).toContain("Compact");
    wrap.unmount();
  });

  it("ref recursion limit saves to the server, clamped to 1–32", async () => {
    const { wrap } = await mountAt("canvas");
    const input = wrap.get('[data-test="settings-wildcard-max-ref-depth"]').get("input");
    expect(Number(input.element.value)).toBe(8);
    await input.setValue("100");
    await input.trigger("blur");
    await flushPromises();
    expect(updateServer).toHaveBeenCalledWith({ max_ref_depth: 32 });
    expect(useUiStore().maxRefDepth).toBe(32);
    wrap.unmount();
  });

  it("carries a changed legacy localStorage limit to the server once", async () => {
    localStorage.setItem("wp-wildcard-max-ref-depth", "12");
    const { wrap } = await mountAt("canvas");
    expect(updateServer).toHaveBeenCalledWith({ max_ref_depth: 12 });
    expect(localStorage.getItem("wp-wildcard-max-ref-depth")).toBeNull();
    wrap.unmount();
  });
});

describe("Settings › Test Runner", () => {
  it("stores the defaults a new scenario starts with", async () => {
    const { wrap } = await mountAt("test-runner");
    await wrap.get('[data-test="settings-tr-count"]').get("input").setValue("25");
    expect(useUiStore().testRunnerDefaults.count).toBe(25);
    expect(JSON.parse(localStorage.getItem("wp-test-runner-defaults") ?? "{}").count).toBe(25);
    wrap.unmount();
  });
});

describe("Settings › Advanced", () => {
  it("resetting preferences removes wp.releaseCheck (regression for dot-prefix bug)", async () => {
    localStorage.setItem("wp.releaseCheck", '{"v":"1.0"}');
    localStorage.setItem("wp-theme-mode", "dark");
    localStorage.setItem("Comfy.unrelated", "keep-me");
    const { wrap } = await mountAt("advanced");
    const bp = wrap.findComponent({ name: "BrowserPrefsCard" });
    await bp.find("[data-test='browser-prefs-reset']").trigger("click");
    bp.findComponent({ name: "ConfirmDialog" }).vm.$emit("confirm");
    await wrap.vm.$nextTick();
    expect(localStorage.getItem("wp.releaseCheck")).toBeNull();
    expect(localStorage.getItem("wp-theme-mode")).toBeNull();
    expect(localStorage.getItem("Comfy.unrelated")).toBe("keep-me");
    wrap.unmount();
  });
});
