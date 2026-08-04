import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

import { useReleaseCheck, resetReleaseCheckSession, LAUNCH_TTL_MS } from "../../composables/useReleaseCheck";
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

  it("paints a STALE cached value immediately, then refreshes", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date(Date.now() - LAUNCH_TTL_MS - 1000).toISOString(),
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastResult!.latestVersion.value).toBe("1.9.0");
    wrap.unmount();
  });

  // The in-memory session guard dies with the page, so before this the real
  // cadence was one GitHub request per RELOAD — and anonymous callers get 60
  // an hour per IP. A reload-heavy afternoon exhausted the quota.
  it("does NOT hit the network when the persisted check is still fresh", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest_version: "1.8.0",
      body: "cached",
      url: "https://x/r/1.8.0",
    }));
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.9.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    // ...and the cached answer is still fully painted.
    expect(lastResult!.latestVersion.value).toBe("1.8.0");
    expect(lastResult!.hasUpdate.value).toBe(true);
    expect(lastResult!.releaseBody.value).toBe("cached");
    wrap.unmount();
  });

  it("a fresh cache does not block an explicit checkNow()", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date().toISOString(),
      latest_version: "1.8.0",
    }));
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.9.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    await lastResult!.checkNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastResult!.latestVersion.value).toBe("1.9.0");
    wrap.unmount();
  });
});

describe("useReleaseCheck — rate limiting", () => {
  function limitedResponse(resetEpochSec: number) {
    return {
      ok: false,
      status: 403,
      headers: {
        get: (h: string) =>
          h === "X-RateLimit-Remaining" ? "0"
            : h === "X-RateLimit-Reset" ? String(resetEpochSec)
            : null,
      },
      json: async () => ({ message: "API rate limit exceeded" }),
    };
  }

  it("records the reset window GitHub hands back and stops retrying inside it", async () => {
    const resetAt = Math.floor((Date.now() + 30 * 60 * 1000) / 1000);
    const fetchMock = vi.fn().mockResolvedValue(limitedResponse(resetAt));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastResult!.rateLimitedUntil.value).toBe(resetAt * 1000);
    // Even an explicit check must not spend a request we know will be refused.
    await lastResult!.checkNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    wrap.unmount();
  });

  it("keeps the previously cached release when a check is rate limited", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date(Date.now() - LAUNCH_TTL_MS - 1000).toISOString(),
      latest_version: "1.8.0",
      body: "known",
      url: "https://x/r/1.8.0",
    }));
    const fetchMock = vi.fn().mockResolvedValue(limitedResponse(Math.floor(Date.now() / 1000) + 600));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(lastResult!.latestVersion.value).toBe("1.8.0");
    expect(lastResult!.releaseBody.value).toBe("known");
    // The lockout is persisted alongside it, so the next reload knows.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).rate_limited_until).toBeGreaterThan(Date.now());
    wrap.unmount();
  });

  it("restores a lockout across a reload, so the next page does not spend a request", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date(Date.now() - LAUNCH_TTL_MS - 1000).toISOString(),
      latest_version: "1.8.0",
      rate_limited_until: Date.now() + 20 * 60 * 1000,
    }));
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.9.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    wrap.unmount();
  });

  it("resumes checking once the window has passed", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      checked_at: new Date(Date.now() - LAUNCH_TTL_MS - 1000).toISOString(),
      latest_version: "1.8.0",
      rate_limited_until: Date.now() - 1000, // expired
    }));
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.9.0"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  // The topbar pill, the Dashboard and Settings all mount together. The guard
  // used to be set only once a response LANDED, so all three read it as false
  // and each opened its own request — one page load, three quota units.
  it("consumers mounting in the same tick share ONE request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v1.8.0"));
    vi.stubGlobal("fetch", fetchMock);
    const a = mount(host());
    const b = mount(host());
    const c = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastResult!.latestVersion.value).toBe("1.8.0");
    a.unmount(); b.unmount(); c.unmount();
  });

  it("a failed launch attempt does not free every other consumer to retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const a = mount(host());
    const b = mount(host());
    await settle();
    const c = mount(host());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    a.unmount(); b.unmount(); c.unmount();
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

  it("shares state across consumers: checkNow on one lights the other's pill", async () => {
    // Two independent consumers (like the topbar + Settings). checkOnLaunch
    // off so only the manual check drives state.
    setActivePinia(createPinia());
    useUiStore().setCheckOnLaunch(false);
    const fetchMock = vi.fn().mockResolvedValue(releaseResponse("v2.10.1"));
    vi.stubGlobal("fetch", fetchMock);

    const topbar = mount(host());
    const topbarResult = lastResult!;
    const settings = mount(host());
    const settingsResult = lastResult!;
    await settle();

    expect(topbarResult.hasUpdate.value).toBe(false);
    // Manual check from the "settings" consumer...
    await settingsResult.checkNow();
    // ...must reflect in the "topbar" consumer without a remount/reload.
    expect(topbarResult.hasUpdate.value).toBe(true);
    expect(topbarResult.latestVersion.value).toBe("2.10.1");

    topbar.unmount(); settings.unmount();
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
