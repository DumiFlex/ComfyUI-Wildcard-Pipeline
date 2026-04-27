/**
 * CommunityUpload.vue tests.
 *
 * Verifies wizard step navigation, field-level validation gating, and the
 * happy-path submit that lands on the success step.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
vi.mock("../community/mockApi", async () => {
  const actual = await vi.importActual<typeof import("../community/mockApi")>("../community/mockApi");
  return {
    ...actual,
    uploadModule: vi.fn(),
  };
});

import * as mockApi from "../community/mockApi";
import CommunityUpload from "../views/community/CommunityUpload.vue";
import { useCommunityStore } from "../stores/communityStore";

beforeEach(() => {
  setActivePinia(createPinia());
  mockApi._resetForTests();
  vi.mocked(mockApi.uploadModule).mockReset();
});
afterEach(() => vi.clearAllMocks());

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/community/discover", name: "community-discover", component: { template: "<div/>" } },
      { path: "/community/upload", name: "community-upload", component: { template: "<div/>" } },
      { path: "/community/m/:id", name: "community-detail", component: { template: "<div/>" } },
    ],
  });
}

function mountView() {
  return mount(CommunityUpload, {
    global: { plugins: [makeRouter()] },
  });
}

describe("CommunityUpload.vue", () => {
  it("shows sign-in gate when there is no current user", async () => {
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Sign in to publish");
  });

  it("step 1 → step 2 → review path", async () => {
    const store = useCommunityStore();
    await store.signIn();
    const wrap = mountView();
    await flushPromises();

    // Stepper visible at step 1.
    expect(wrap.text()).toContain("What are you publishing?");

    // Click Next to advance to step 2.
    const next1 = wrap.findAll("button").find((b) => b.text().includes("Next"));
    expect(next1).toBeTruthy();
    await next1!.trigger("click");
    await flushPromises();

    // Step 2 is rendered.
    expect(wrap.text()).toContain("Name *");
    expect(wrap.text()).toContain("Tagline *");

    // Fill required fields.
    await wrap.find('input[aria-label="Module name"]').setValue("Hair Color Pro");
    await wrap.find('input[aria-label="Tagline"]').setValue("Best hair colors.");
    await wrap.find('input[aria-label="Tag input"]').setValue("portrait");
    const addTag = wrap.findAll("button").find((b) => b.text().trim() === "Add");
    await addTag!.trigger("click");
    await flushPromises();

    const review = wrap.findAll("button").find((b) => b.text().includes("Review"));
    expect(review).toBeTruthy();
    expect(review!.attributes("disabled")).toBeFalsy();
    await review!.trigger("click");
    await flushPromises();

    expect(wrap.text()).toContain("Review before publishing");
  });

  it("Review → Publish hits the upload API and shows success", async () => {
    vi.mocked(mockApi.uploadModule).mockResolvedValue({
      id: "wc_new123",
      type: "wildcard",
      name: "Test",
      description: "",
      category: "subject",
      tags: ["test"],
      author: { login: "you", avatar_url: "", verified: false },
      versions: [{ version: "1.0.0", published_at: new Date().toISOString() }],
      stars: 0, downloads: 0, rating: 0, rating_count: 0,
      rating_dist: [0, 0, 0, 0, 0],
      nsfw: false,
      engine_min_version: "1.4",
      license: "MIT",
      hero: "linear-gradient(135deg, #000 0%, #111 100%)",
      tagline: "x",
      readme: "",
      updated_at: new Date().toISOString(),
      preview_options: [],
      comments: [],
    });
    const store = useCommunityStore();
    await store.signIn();
    const wrap = mountView();
    await flushPromises();

    // Drive: Next → fill → Review → Publish
    await wrap.findAll("button").find((b) => b.text().includes("Next"))!.trigger("click");
    await flushPromises();
    await wrap.find('input[aria-label="Module name"]').setValue("Test");
    await wrap.find('input[aria-label="Tagline"]').setValue("Tag");
    await wrap.find('input[aria-label="Tag input"]').setValue("test");
    await wrap.findAll("button").find((b) => b.text().trim() === "Add")!.trigger("click");
    await flushPromises();
    await wrap.findAll("button").find((b) => b.text().includes("Review"))!.trigger("click");
    await flushPromises();
    await wrap.findAll("button").find((b) => b.text().includes("Publish"))!.trigger("click");
    await flushPromises();

    expect(vi.mocked(mockApi.uploadModule)).toHaveBeenCalled();
    expect(wrap.text()).toContain("Published!");
  });
});
