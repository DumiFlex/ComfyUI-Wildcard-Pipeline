import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import DatabaseCard from "../DatabaseCard.vue";
import { useDatabaseStore } from "../../../stores/databaseStore";
import type { DatabaseInfo } from "../../../api/types";

vi.mock("../../../api/client", () => ({
  api: {
    database: { info: vi.fn(), maintenance: vi.fn() },
  },
  ApiError: class ApiError extends Error {},
}));

const sampleInfo: DatabaseInfo = {
  path: "/Users/test/.comfyui/wildcard-pipeline.db",
  source: "global",
  size_bytes: 1024 * 1024,
  mtime_iso: "2026-06-02T14:23:11+00:00",
  counts: {
    wildcards: 5, fixed_values: 2, combines: 1, derivations: 1,
    constraints: 0, bundles: 0, templates: 1, categories: 3,
  },
  migration: {
    current_version: 11,
    applied: [{ version: 1, name: "001_initial", applied_at: "2026-04-26T00:00:00" }],
  },
  pragma: {
    journal_mode: "wal", foreign_keys: 1,
    page_size: 4096, page_count: 256, freelist_count: 0,
  },
};

describe("DatabaseCard", () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it("renders path, source, size, row counts when info is loaded", async () => {
    const wrapper = mount(DatabaseCard);
    const store = useDatabaseStore();
    store.info = sampleInfo;
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain("wildcard-pipeline.db");
    expect(text).toContain("global");
    expect(text).toContain("5"); // wildcards count
    expect(text).toContain("11"); // migration version
  });

  it("shows loading state when store.loading is true and info is null", async () => {
    const wrapper = mount(DatabaseCard);
    const store = useDatabaseStore();
    store.loading = true;
    store.info = null;
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-test='database-loading']").exists()).toBe(true);
  });

  it("shows error banner when store.lastError is set", async () => {
    const wrapper = mount(DatabaseCard);
    const store = useDatabaseStore();
    store.lastError = "network down";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("network down");
  });

  it("calls fetchInfo when the refresh button is clicked", async () => {
    const wrapper = mount(DatabaseCard);
    const store = useDatabaseStore();
    store.info = sampleInfo;
    await wrapper.vm.$nextTick();
    const spy = vi.spyOn(store, "fetchInfo").mockResolvedValue();
    await wrapper.find("[data-test='database-refresh']").trigger("click");
    expect(spy).toHaveBeenCalled();
  });

  it("opens the maintenance modal in confirm phase when a Run button is clicked", async () => {
    const wrapper = mount(DatabaseCard, { attachTo: document.body });
    const store = useDatabaseStore();
    store.info = sampleInfo;
    await wrapper.vm.$nextTick();
    await wrapper.find("[data-test='database-run-vacuum']").trigger("click");
    await wrapper.vm.$nextTick();
    // MaintenanceOpModal uses <Teleport to="body">; query document.
    expect(document.querySelector("[data-test='maintop-confirm']")).not.toBeNull();
    wrapper.unmount();
  });

  it("disables other op buttons while runningOp is set", async () => {
    const wrapper = mount(DatabaseCard);
    const store = useDatabaseStore();
    store.info = sampleInfo;
    store.runningOp = "vacuum";
    await wrapper.vm.$nextTick();
    const integrityBtn = wrapper.find("[data-test='database-run-integrity']");
    // Button component should propagate disabled attribute to underlying <button>.
    const hasDisabled = integrityBtn.attributes("disabled") !== undefined
      || integrityBtn.element.hasAttribute("disabled");
    expect(hasDisabled).toBe(true);
  });
});
