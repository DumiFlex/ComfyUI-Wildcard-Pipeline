import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

import Settings from "../../views/Settings.vue";
import * as releaseCheck from "../../composables/useReleaseCheck";
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
    checkNow,
  } as ReturnType<typeof releaseCheck.useReleaseCheck>);
});

function mountSettings() {
  return mount(Settings, {
    global: { stubs: { Icon: true, BrowserPrefsCard: true, DatabaseCard: true } },
  });
}

describe("Settings Updates card", () => {
  it("toggling check-on-launch calls setCheckOnLaunch", async () => {
    const wrap = mountSettings();
    const ui = useUiStore();
    const spy = vi.spyOn(ui, "setCheckOnLaunch");
    // The Toggle's clickable control is an inner <button role="switch">;
    // the data-test attribute falls through to the outer <label>.
    await wrap.get('[data-test="settings-check-on-launch"]').get("button").trigger("click");
    expect(spy).toHaveBeenCalledWith(false);
  });

  it("Check now button calls checkNow", async () => {
    const wrap = mountSettings();
    await wrap.get('[data-test="settings-check-now"]').trigger("click");
    await flushPromises();
    expect(checkNow).toHaveBeenCalled();
  });

  it("shows an update-available status line", () => {
    const wrap = mountSettings();
    expect(wrap.get('[data-test="settings-update-status"]').text()).toContain("2.10.0");
  });
});
