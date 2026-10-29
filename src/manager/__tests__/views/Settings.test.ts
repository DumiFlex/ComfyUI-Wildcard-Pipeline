import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

import Settings from "../../views/Settings.vue";
import * as releaseCheck from "../../composables/useReleaseCheck";
import { settingsRouter } from "../helpers/settingsRouter";
import { useUiStore } from "../../stores/uiStore";

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "2.9.0";
(globalThis as unknown as { __APP_LICENSE__: string }).__APP_LICENSE__ = "MIT";

const checkNow = vi.fn();

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  checkNow.mockClear();
  vi.spyOn(releaseCheck, "useReleaseCheck").mockReturnValue({
    current: "2.9.0",
    latestVersion: ref("2.10.0"),
    hasUpdate: ref(true),
    severity: ref("minor"),
    releaseBody: ref(null),
    releaseUrl: ref(null),
    lastChecked: ref("2026-07-21T10:00:00.000Z"),
    checking: ref(false),
    rateLimitedUntil: ref(null),
    history: ref([]),
    loadHistory: vi.fn(),
    checkNow,
  } as ReturnType<typeof releaseCheck.useReleaseCheck>);
});

async function mountSettings() {
  const router = await settingsRouter("general");
  return mount(Settings, {
    props: { section: "general" },
    global: { plugins: [router], stubs: { Icon: true, BrowserPrefsCard: true, DatabaseCard: true } },
  });
}

describe("Settings › General › Updates", () => {
  it("toggling check-on-launch calls setCheckOnLaunch", async () => {
    const wrap = await mountSettings();
    const ui = useUiStore();
    const spy = vi.spyOn(ui, "setCheckOnLaunch");
    // The data-test falls through to the Toggle's role="switch" root.
    await wrap.get('[data-test="settings-check-on-launch"]').trigger("click");
    expect(spy).toHaveBeenCalledWith(false);
  });

  it("Check now button calls checkNow", async () => {
    const wrap = await mountSettings();
    await wrap.get('[data-test="settings-check-now"]').trigger("click");
    await flushPromises();
    expect(checkNow).toHaveBeenCalled();
  });

  it("shows an update-available status line", async () => {
    const wrap = await mountSettings();
    expect(wrap.get('[data-test="settings-update-status"]').text()).toContain("2.10.0");
  });
});

describe("Settings › About", () => {
  it("shows the version and a support link for each way to donate", async () => {
    const router = await settingsRouter("about");
    const wrap = mount(Settings, {
      props: { section: "about" },
      global: { plugins: [router], stubs: { Icon: true } },
    });
    expect(wrap.text()).toContain("2.9.0");
    const links = wrap.findAll('[data-test="settings-support"] a');
    expect(links.map((a) => a.attributes("href"))).toEqual([
      "https://github.com/sponsors/DumiFlex",
      "https://buymeacoffee.com/dumiflex",
      "https://paypal.me/DumiFlex",
    ]);
    for (const a of links) expect(a.attributes("rel")).toBe("noopener");
  });
});
