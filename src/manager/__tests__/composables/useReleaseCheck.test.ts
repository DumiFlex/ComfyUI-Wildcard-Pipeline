import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import { useReleaseCheck, resetReleaseCheckSession } from "../../composables/useReleaseCheck";
import { useUiStore } from "../../stores/uiStore";

// __APP_VERSION__ is injected by vite at build time; vitest doesn't apply
// the define plugin, so we wire it onto globalThis here.
(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "1.7.0";

const STORAGE_KEY = "wp.releaseCheck";

type CheckResult = ReturnType<typeof useReleaseCheck>;
let lastResult: CheckResult | null = null;

function host() {
  lastResult = null;
  return defineComponent({
    setup() {
      const r = useReleaseCheck();
      lastResult = r;
      return () => h("span", r.current);
    },
  });
}

/** Flush onMounted → await fetch → applyLatest → render. */
async function settle() {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

function releaseResponse(tag: string, body = "notes", url = "https://x/releases/v") {
  return { ok: true, json: async () => ({ tag_name: tag, body, html_url: url }) };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  setActivePinia(createPinia());
  resetReleaseCheckSession();
});

describe("useReleaseCheck", () => {
  it("fetches on launch and surfaces version, body, url, lastChecked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.8.0", "## New", "https://x/r/1.8.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastResult!.hasUpdate.value).toBe(true);
    expect(lastResult!.latestVersion.value).toBe("1.8.0");
    expect(lastResult!.releaseBody.value).toBe("## New");
    expect(lastResult!.releaseUrl.value).toBe("https://x/r/1.8.0");
    expect(lastResult!.lastChecked.value).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).latest_version).toBe("1.8.0");
    wrap.unmount();
  });

  it("does NOT fetch on launch when checkOnLaunch is off", async () => {
    setActivePinia(createPinia());
    useUiStore().setCheckOnLaunch(false);
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.8.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lastResult!.hasUpdate.value).toBe(false);
    wrap.unmount();
  });

  it("paints cached value immediately, then refreshes", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest_version: "1.6.5",
      body: "old",
      url: "https://x/r/1.6.5",
    }));
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.9.0", "fresh", "https://x/r/1.9.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await nextTick(); // cache painted before fetch resolves
    expect(lastResult!.latestVersion.value).toBe("1.6.5");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no 24h suppression
    expect(lastResult!.latestVersion.value).toBe("1.9.0");
    wrap.unmount();
  });

  it("session guard: a second mount does not refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.8.0"));
    vi.stubGlobal("fetch", fetchMock);
    const a = mount(host());
    await settle();
    const b = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    a.unmount(); b.unmount();
  });

  it("checkNow() refetches even within the same session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.8.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await lastResult!.checkNow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastResult!.checking.value).toBe(false);
    wrap.unmount();
  });

  it("a legacy/malformed cache blob (no latest_version) does not throw", async () => {
    localStorage.setItem(STORAGE_KEY, '{"v":"1.0"}'); // pre-rework shape
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.8.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await nextTick();
    // Painting the bad cache must not crash; it degrades to no update.
    expect(lastResult!.hasUpdate.value).toBe(false);
    expect(lastResult!.latestVersion.value).toBeNull();
    await settle();
    // The launch refresh still recovers a real version.
    expect(lastResult!.latestVersion.value).toBe("1.8.0");
    wrap.unmount();
  });

  it("network failure leaves hasUpdate false and does not throw", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(lastResult!.hasUpdate.value).toBe(false);
    wrap.unmount();
  });
});
