import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

import UpdateDialog from "../../components/UpdateDialog.vue";
import * as managerUpdate from "../../composables/useComfyManagerUpdate";
import * as releaseCheck from "../../composables/useReleaseCheck";

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "2.9.0";

function stubRelease(over: Partial<ReturnType<typeof releaseCheck.useReleaseCheck>> = {}) {
  vi.spyOn(releaseCheck, "useReleaseCheck").mockReturnValue({
    current: "2.9.0",
    latestVersion: ref("2.10.0"),
    hasUpdate: ref(true),
    severity: ref("minor"),
    releaseBody: ref("## What's new\n- Cool thing"),
    releaseUrl: ref("https://github.com/x/releases/2.10.0"),
    lastChecked: ref(new Date().toISOString()),
    checking: ref(false),
    checkNow: vi.fn(),
    ...over,
  } as ReturnType<typeof releaseCheck.useReleaseCheck>);
}

function stubManager(over: Partial<ReturnType<typeof managerUpdate.useComfyManagerUpdate>> = {}) {
  const base = {
    phase: ref<managerUpdate.UpdatePhase>("idle"),
    errorKind: ref<managerUpdate.UpdateErrorKind>(null),
    errorMessage: ref<string | null>(null),
    probe: vi.fn().mockResolvedValue("available" as const),
    runUpdate: vi.fn(),
    reboot: vi.fn(),
    managerUiUrl: "/manager",
  };
  const merged = { ...base, ...over };
  vi.spyOn(managerUpdate, "useComfyManagerUpdate").mockReturnValue(
    merged as ReturnType<typeof managerUpdate.useComfyManagerUpdate>,
  );
  return merged;
}

function mountDialog() {
  return mount(UpdateDialog, {
    props: { open: true },
    global: { stubs: { teleport: true } },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
});

describe("UpdateDialog", () => {
  it("shows the version delta and rendered notes", async () => {
    stubRelease();
    stubManager();
    const wrap = mountDialog();
    await flushPromises();
    expect(wrap.text()).toContain("2.9.0");
    expect(wrap.text()).toContain("2.10.0");
    expect(wrap.find(".wpc-relnotes").html()).toContain("<li>Cool thing</li>");
  });

  it("Update Now button calls runUpdate when available + idle", async () => {
    stubRelease();
    const mgr = stubManager();
    const wrap = mountDialog();
    await flushPromises();
    await wrap.get('[data-test="update-now"]').trigger("click");
    expect(mgr.runUpdate).toHaveBeenCalled();
  });

  it("shows Restart button only in staged phase and calls reboot", async () => {
    stubRelease();
    const mgr = stubManager({ phase: ref("staged") });
    const wrap = mountDialog();
    await flushPromises();
    expect(wrap.find('[data-test="update-now"]').exists()).toBe(false);
    await wrap.get('[data-test="update-restart"]').trigger("click");
    expect(mgr.reboot).toHaveBeenCalled();
  });

  it("shows the fallback card when Manager is absent", async () => {
    stubRelease();
    stubManager({ probe: vi.fn().mockResolvedValue("absent" as const) });
    const wrap = mountDialog();
    await flushPromises();
    expect(wrap.find('[data-test="update-fallback"]').exists()).toBe(true);
    expect(wrap.find('[data-test="update-now"]').exists()).toBe(false);
  });

  it("shows the fallback card on a forbidden error", async () => {
    stubRelease();
    stubManager({ phase: ref("error"), errorKind: ref("forbidden") });
    const wrap = mountDialog();
    await flushPromises();
    expect(wrap.find('[data-test="update-fallback"]').exists()).toBe(true);
  });

  it("emits close from the Later button", async () => {
    stubRelease();
    stubManager();
    const wrap = mountDialog();
    await flushPromises();
    await wrap.get('[data-test="update-later"]').trigger("click");
    expect(wrap.emitted("close")).toBeTruthy();
  });
});
