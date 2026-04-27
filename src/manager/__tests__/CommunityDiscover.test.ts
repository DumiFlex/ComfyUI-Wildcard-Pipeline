/**
 * CommunityDiscover.vue tests.
 *
 * Mocks the mock API at the module boundary so we can drive deterministic
 * results, then assert that filter / sort / kind controls forward the right
 * query options to the store.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
vi.mock("../community/mockApi", async () => {
  const actual = await vi.importActual<typeof import("../community/mockApi")>("../community/mockApi");
  return {
    ...actual,
    searchModules: vi.fn(),
    getFeatured: vi.fn().mockResolvedValue([]),
    getApiStatus: vi.fn().mockResolvedValue("online"),
  };
});

import * as mockApi from "../community/mockApi";
import CommunityDiscover from "../views/community/CommunityDiscover.vue";

const seedAtom = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "wildcard",
  name: `Module ${id}`,
  description: "",
  category: "subject",
  tags: ["portrait"],
  author: { login: "u", avatar_url: "", verified: false },
  versions: [{ version: "1.0.0", published_at: new Date().toISOString() }],
  stars: 10,
  downloads: 100,
  rating: 4.5,
  rating_count: 5,
  rating_dist: [3, 1, 1, 0, 0],
  nsfw: false,
  engine_min_version: "1.4",
  license: "MIT",
  hero: "linear-gradient(135deg, #000 0%, #111 100%)",
  tagline: `Tagline ${id}`,
  readme: "# Hi",
  updated_at: new Date().toISOString(),
  preview_options: [],
  comments: [],
  ...overrides,
});

beforeEach(() => {
  setActivePinia(createPinia());
  mockApi._resetForTests();
  vi.mocked(mockApi.searchModules).mockReset();
  vi.mocked(mockApi.searchModules).mockResolvedValue([]);
  vi.mocked(mockApi.getFeatured).mockReset();
  vi.mocked(mockApi.getFeatured).mockResolvedValue([]);
  vi.mocked(mockApi.getApiStatus).mockReset();
  vi.mocked(mockApi.getApiStatus).mockResolvedValue("online");
});
afterEach(() => vi.clearAllMocks());

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/community/discover", name: "community-discover", component: { template: "<div/>" } },
      { path: "/community/upload", name: "community-upload", component: { template: "<div/>" } },
      { path: "/community/profile", name: "community-profile", component: { template: "<div/>" } },
      { path: "/community/offline", name: "community-offline", component: { template: "<div/>" } },
      { path: "/community/m/:id", name: "community-detail", component: { template: "<div/>" } },
    ],
  });
}

function mountView() {
  return mount(CommunityDiscover, {
    global: { plugins: [makeRouter()] },
  });
}

describe("CommunityDiscover.vue", () => {
  it("renders the hero title + Publish button", async () => {
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Community");
    expect(wrap.text()).toContain("Publish");
  });

  it("renders a card per result", async () => {
    vi.mocked(mockApi.searchModules).mockResolvedValue([
      seedAtom("a"),
      seedAtom("b"),
      seedAtom("c"),
    ] as never);
    const wrap = mountView();
    await flushPromises();
    expect(wrap.findAll(".wp-comm-card").length).toBe(3);
  });

  it("forwards search query to the API", async () => {
    const wrap = mountView();
    await flushPromises();

    const input = wrap.find('input[aria-label="Search community"]');
    await input.setValue("hair");
    await flushPromises();

    const calls = vi.mocked(mockApi.searchModules).mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last?.q).toBe("hair");
  });

  it("renders the empty state when feed is empty", async () => {
    vi.mocked(mockApi.searchModules).mockResolvedValue([]);
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Nothing to show");
  });
});
