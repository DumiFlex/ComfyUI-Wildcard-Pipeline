import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import LocationSection from "../LocationSection.vue";
import { useDatabaseStore } from "../../../stores/databaseStore";
import type { DatabaseConfig, DatabaseInfo } from "../../../api/types";

vi.mock("../../../api/client", () => ({
  api: {
    database: {
      info: vi.fn(),
      maintenance: vi.fn(),
      config: vi.fn(),
      setConfig: vi.fn(),
      clearPendingMove: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const sampleInfo: DatabaseInfo = {
  path: "/home/user/.comfyui/wildcard-pipeline.db",
  source: "global",
  size_bytes: 1024 * 1024,
  mtime_iso: "2026-06-02T14:23:11+00:00",
  counts: {
    wildcards: 5, fixed_values: 2, combines: 1, derivations: 1,
    constraints: 0, bundles: 0, templates: 1, categories: 3,
  },
  migration: { current_version: 11, applied: [] },
  pragma: { journal_mode: "wal", foreign_keys: 1, page_size: 4096, page_count: 256, freelist_count: 0 },
};

const baseConfig: DatabaseConfig = {
  preference: "global",
  pending_move: null,
  locations: {
    user:   { path: "/comfy/user/wildcard-pipeline.db", exists: false, size_bytes: null },
    global: { path: "/home/user/.comfyui/wildcard-pipeline.db", exists: true, size_bytes: 1024 * 1024 },
    root:   { path: "/plugin/db/wildcard-pipeline.db", exists: false, size_bytes: null },
  },
  env_locked: false,
};

describe("LocationSection", () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it("renders three location options", async () => {
    const wrapper = mount(LocationSection);
    const store = useDatabaseStore();
    store.config = { ...baseConfig };
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test='location-option-user']").exists()).toBe(true);
    expect(wrapper.find("[data-test='location-option-global']").exists()).toBe(true);
    expect(wrapper.find("[data-test='location-option-root']").exists()).toBe(true);
  });

  it("marks current preference as 'current' chip", async () => {
    const wrapper = mount(LocationSection);
    const store = useDatabaseStore();
    store.config = { ...baseConfig };
    await wrapper.vm.$nextTick();
    const globalOption = wrapper.find("[data-test='location-option-global']");
    expect(globalOption.text()).toContain("current");
  });

  it("Apply button is disabled when selection matches current preference", async () => {
    const wrapper = mount(LocationSection);
    const store = useDatabaseStore();
    store.config = { ...baseConfig };
    await wrapper.vm.$nextTick();
    const btn = wrapper.find("[data-test='location-apply']");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("clicking a different option enables Apply", async () => {
    const wrapper = mount(LocationSection, { attachTo: document.body });
    const store = useDatabaseStore();
    store.config = { ...baseConfig };
    store.info = { ...sampleInfo };
    await wrapper.vm.$nextTick();
    const userRadio = wrapper.find("[data-test='location-option-user'] input[type='radio']");
    await userRadio.setValue();
    await wrapper.vm.$nextTick();
    const btn = wrapper.find("[data-test='location-apply']");
    expect(btn.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("env-locked disables radio + apply", async () => {
    const wrapper = mount(LocationSection);
    const store = useDatabaseStore();
    store.config = { ...baseConfig, env_locked: true };
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test='location-env-locked']").exists()).toBe(true);
    const btn = wrapper.find("[data-test='location-apply']");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("shows pending banner when pending_move is set", async () => {
    const wrapper = mount(LocationSection);
    const store = useDatabaseStore();
    store.config = {
      ...baseConfig,
      pending_move: { from: "/a.db", to: "/b.db", mode: "copy" },
    };
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test='location-pending-banner']").exists()).toBe(true);
  });

  it("Cancel button on pending banner calls cancelPendingMove", async () => {
    const wrapper = mount(LocationSection);
    const store = useDatabaseStore();
    store.config = {
      ...baseConfig,
      pending_move: { from: "/a.db", to: "/b.db", mode: "move" },
    };
    const spy = vi.spyOn(store, "cancelPendingMove").mockResolvedValue();
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test='location-cancel-pending']").trigger("click");
    expect(spy).toHaveBeenCalled();
  });

  it("clicking Apply with conflict opens conflict modal", async () => {
    const wrapper = mount(LocationSection, { attachTo: document.body });
    const store = useDatabaseStore();
    // Source is user (no data), target root HAS data.
    store.config = {
      ...baseConfig,
      preference: "user",
      locations: {
        user:   { path: "/u.db", exists: false, size_bytes: null },
        global: { path: "/g.db", exists: false, size_bytes: null },
        root:   { path: "/r.db", exists: true,  size_bytes: 2048 },
      },
    };
    store.info = { ...sampleInfo };
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test='location-option-root'] input[type='radio']").setValue();
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test='location-apply']").trigger("click");
    await wrapper.vm.$nextTick();
    // Modal teleports to body
    expect(document.querySelector("[data-test='location-use-existing']")).not.toBeNull();
    wrapper.unmount();
  });

  it("clicking Apply with empty destination + existing source opens transfer modal", async () => {
    const wrapper = mount(LocationSection, { attachTo: document.body });
    const store = useDatabaseStore();
    store.config = {
      ...baseConfig,
      preference: "global",  // source global has data
      locations: {
        user:   { path: "/u.db", exists: false, size_bytes: null },
        global: { path: "/g.db", exists: true,  size_bytes: 1024 },
        root:   { path: "/r.db", exists: false, size_bytes: null },
      },
    };
    store.info = { ...sampleInfo };
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test='location-option-user'] input[type='radio']").setValue();
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test='location-apply']").trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.querySelector("[data-test='location-confirm-transfer']")).not.toBeNull();
    wrapper.unmount();
  });
});
