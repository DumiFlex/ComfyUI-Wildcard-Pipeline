/**
 * Tests for the community Pinia store.
 *
 * The mock API is the unit under test for state-shape behavior — we exercise
 * it directly through the store's actions and assert the localStorage round-
 * trip + the in-memory Set updates.
 */
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as mockApi from "../community/mockApi";
import { useCommunityStore } from "../stores/communityStore";

beforeEach(() => {
  setActivePinia(createPinia());
  mockApi._resetForTests();
  mockApi.setForceOffline(false);
});
afterEach(() => {
  vi.clearAllMocks();
  mockApi._resetForTests();
});

describe("communityStore", () => {
  it("starts signed-out with empty install + star sets", () => {
    const store = useCommunityStore();
    expect(store.currentUser).toBeNull();
    expect(store.installed.size).toBe(0);
    expect(store.starred.size).toBe(0);
  });

  it("signIn round-trips through localStorage", async () => {
    const store = useCommunityStore();
    await store.signIn();
    expect(store.currentUser).not.toBeNull();
    expect(store.currentUser?.login).toBe("you");
    // Read it back through the API to prove it's persisted.
    const stored = mockApi.getCurrentUser();
    expect(stored?.login).toBe("you");
  });

  it("signOut clears the user", async () => {
    const store = useCommunityStore();
    await store.signIn();
    await store.signOut();
    expect(store.currentUser).toBeNull();
    expect(mockApi.getCurrentUser()).toBeNull();
  });

  it("install adds module id to set + history", async () => {
    const store = useCommunityStore();
    await store.install("wc_haircolor_pro");
    expect(store.installed.has("wc_haircolor_pro")).toBe(true);
    expect(store.installHistory[0].id).toBe("wc_haircolor_pro");
  });

  it("uninstall removes module id from the installed set", async () => {
    const store = useCommunityStore();
    await store.install("wc_haircolor_pro");
    await store.uninstall("wc_haircolor_pro");
    expect(store.installed.has("wc_haircolor_pro")).toBe(false);
  });

  it("toggleStar flips the starred state idempotently", async () => {
    const store = useCommunityStore();
    await store.toggleStar("wc_haircolor_pro");
    expect(store.starred.has("wc_haircolor_pro")).toBe(true);
    await store.toggleStar("wc_haircolor_pro");
    expect(store.starred.has("wc_haircolor_pro")).toBe(false);
  });

  it("search populates feed and clears it on offline", async () => {
    const store = useCommunityStore();
    await store.search({});
    expect(store.feed.length).toBeGreaterThan(0);

    mockApi.setForceOffline(true);
    await store.search({});
    expect(store.feed.length).toBe(0);
    expect(store.apiStatus).toBe("offline");
  });

  it("loadFeatured fills the featured ref", async () => {
    const store = useCommunityStore();
    await store.loadFeatured();
    expect(store.featured.length).toBeGreaterThan(0);
  });

  it("upload appends a module + records it in myUploads", async () => {
    const store = useCommunityStore();
    await store.signIn();
    const result = await store.upload({
      atom: "single",
      type: "wildcard",
      name: "Test Wildcard",
      tagline: "Test tagline.",
      description: "Test description.",
      category: "subject",
      license: "MIT",
      engine_min_version: "1.4",
      nsfw: false,
      tags: ["test"],
      readme: "# Hi",
      version: "1.0.0",
    });
    expect(result.name).toBe("Test Wildcard");
    expect(store.myUploads.has(result.id)).toBe(true);
  });
});
