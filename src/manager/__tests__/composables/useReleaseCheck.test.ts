import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";

import { useReleaseCheck } from "../../composables/useReleaseCheck";

// __APP_VERSION__ is injected by vite at build time; vitest doesn't
// apply the define plugin, so we wire it onto globalThis here.
(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "1.7.0";

const STORAGE_KEY = "wp.releaseCheck";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function host() {
  return defineComponent({
    setup() {
      const r = useReleaseCheck();
      return () => h("span", { "data-test": "version" }, r.current);
    },
  });
}

describe("useReleaseCheck", () => {
  it("flags hasUpdate when GitHub returns a newer tag", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v1.8.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    // Two ticks: onMounted -> await fetch -> applyLatest mutation -> render.
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();
    expect(fetchMock).toHaveBeenCalled();
    // Verify it persisted to localStorage so a re-mount uses the cache.
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      latest_version: string;
    };
    expect(cached.latest_version).toBe("1.8.0");
    wrap.unmount();
  });

  it("uses cached value within TTL — no fetch", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        checked_at: new Date().toISOString(),
        latest_version: "1.6.5",
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await nextTick();
    expect(fetchMock).not.toHaveBeenCalled();
    wrap.unmount();
  });

  it("refetches once cache is older than 24h", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ checked_at: stale, latest_version: "1.6.5" }),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v1.7.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await nextTick();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalled();
    wrap.unmount();
  });

  it("silently no-ops when GitHub is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const wrap = mount(host());
    await nextTick();
    await Promise.resolve();
    // No exception bubbled; no cache written.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    wrap.unmount();
  });
});
