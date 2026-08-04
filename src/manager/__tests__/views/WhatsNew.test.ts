import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";

import WhatsNew from "../../views/WhatsNew.vue";
import * as releaseCheck from "../../composables/useReleaseCheck";

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "2.13.0";

const NOTES = "Headline.\n\n### Highlights\n\n- **A thing.** detail\n";

function stubRelease(over: Record<string, unknown> = {}) {
  return vi.spyOn(releaseCheck, "useReleaseCheck").mockReturnValue({
    current: "2.13.0",
    latestVersion: ref("2.13.0"),
    hasUpdate: ref(false),
    severity: ref(null),
    releaseBody: ref(NOTES),
    releaseUrl: ref("https://github.com/o/r/releases/tag/v2.13.0"),
    lastChecked: ref(null),
    checking: ref(false),
    rateLimitedUntil: ref(null),
    history: ref([
      { version: "2.13.0", body: NOTES, url: "https://x/13", publishedAt: "2026-08-04T00:00:00Z" },
      { version: "2.12.0", body: "The big one.\n\n- **Nodes 2.0.** yes", url: "https://x/12", publishedAt: "2026-08-03T00:00:00Z" },
      { version: "2.11.0", body: "Older.\n\n- **Held modules.** yes", url: "https://x/11", publishedAt: "2026-07-24T00:00:00Z" },
    ]),
    loadHistory: vi.fn(),
    checkNow: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof releaseCheck.useReleaseCheck>);
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/whats-new", component: WhatsNew }],
  });
  router.push("/whats-new");
  await router.isReady();
  const w = mount(WhatsNew, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("WhatsNew — earlier releases", () => {
  /**
   * 2.12.0 was current for about an hour before 2.13.0 replaced it. Anyone
   * updating from 2.11.0 lands on 2.13.0, so showing only the newest tag makes
   * the largest release in months invisible.
   */
  it("shows the releases behind the current one", async () => {
    stubRelease();
    const w = await mountPage();
    expect(w.find('[data-test="whats-new-older"]').exists()).toBe(true);
    expect(w.find('[data-test="whats-new-older-2.12.0"]').exists()).toBe(true);
    expect(w.find('[data-test="whats-new-older-2.11.0"]').exists()).toBe(true);
  });

  it("does not repeat the release already shown in full above", async () => {
    stubRelease();
    const w = await mountPage();
    expect(w.find('[data-test="whats-new-older-2.13.0"]').exists()).toBe(false);
  });

  it("renders each earlier release's notes, not just its number", async () => {
    stubRelease();
    const w = await mountPage();
    expect(w.find('[data-test="whats-new-older-2.12.0"]').text()).toContain("Nodes 2.0");
  });

  // Collapsed: the newest release is why the page was opened.
  it("keeps earlier releases collapsed", async () => {
    stubRelease();
    const w = await mountPage();
    const el = w.find('[data-test="whats-new-older-2.12.0"]').element as HTMLDetailsElement;
    expect(el.open).toBe(false);
  });

  it("asks for the history on mount", async () => {
    const loadHistory = vi.fn();
    stubRelease({ loadHistory });
    await mountPage();
    expect(loadHistory).toHaveBeenCalled();
  });

  it("skips a release with an empty body rather than showing a bare heading", async () => {
    stubRelease({
      history: ref([
        { version: "2.12.0", body: "   ", url: null, publishedAt: null },
      ]),
    });
    const w = await mountPage();
    expect(w.find('[data-test="whats-new-older"]').exists()).toBe(false);
  });

  it("renders nothing extra when there is no history", async () => {
    stubRelease({ history: ref([]) });
    const w = await mountPage();
    expect(w.find('[data-test="whats-new-older"]').exists()).toBe(false);
  });

  // The button says "All releases".
  it("links to the releases index, not to one release", async () => {
    stubRelease();
    const w = await mountPage();
    const href = w.find('[data-test="whats-new-github"]').attributes("href");
    expect(href).toMatch(/\/releases$/);
    expect(href).not.toContain("/tag/");
  });
});
