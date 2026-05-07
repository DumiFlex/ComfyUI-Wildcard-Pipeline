import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import LibraryRoundTripActions from "./LibraryRoundTripActions.vue";
import { hashes, _resetForTests as _resetDriftStore } from "../../drift-store";
import type { ModuleEntry } from "../../../../widgets/_shared";

const libraryTrackedModule: ModuleEntry = {
  id: "abc12345", type: "wildcard", enabled: true,
  meta: { name: "x" }, entries: [],
  payload: { options: [] },
  payload_hash: "hash-current",
};

const inlineModule: ModuleEntry = {
  ...libraryTrackedModule,
  payload_hash: undefined,
};

describe("LibraryRoundTripActions", () => {
  beforeEach(() => _resetDriftStore?.());

  it("hides all 3 buttons for inline-created modules", () => {
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: inlineModule, isLibraryTracked: false, isDrifted: false },
    });
    expect(wrapper.find('[data-test="lrt-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="lrt-reset"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="lrt-save"]').exists()).toBe(false);
  });

  it("shows only Open in SPA when library-tracked but not drifted", () => {
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: libraryTrackedModule, isLibraryTracked: true, isDrifted: false },
    });
    expect(wrapper.find('[data-test="lrt-open"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="lrt-reset"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="lrt-save"]').exists()).toBe(false);
  });

  it("shows all 3 buttons when library-tracked AND drifted", () => {
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: libraryTrackedModule, isLibraryTracked: true, isDrifted: true },
    });
    expect(wrapper.find('[data-test="lrt-open"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="lrt-reset"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="lrt-save"]').exists()).toBe(true);
  });

  it("Open in SPA opens correct route per kind", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: libraryTrackedModule, isLibraryTracked: true, isDrifted: false },
    });
    await wrapper.find('[data-test="lrt-open"]').trigger("click");
    expect(openSpy).toHaveBeenCalledWith(
      "/wp/manager/wildcards/abc12345/edit", "_blank", "noopener",
    );
    openSpy.mockRestore();
  });

  it("Reset confirms then emits reset-from-library with refreshed module", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    // Stub the embed-bundle endpoint that refreshModule calls under the hood.
    // (The plan's vi.doMock approach can't work because the component statically
    // imports refreshModule before the mock is registered.)
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        snapshots: {
          abc12345: {
            snapshot_version: 1,
            uuid: "abc12345",
            type: "wildcard",
            name: "x",
            payload: { options: [] },
            payload_hash: "hash-new",
            source: { kind: "user" },
          },
        },
        pickOrder: ["abc12345"],
      }), { status: 200 }),
    );
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: libraryTrackedModule, isLibraryTracked: true, isDrifted: true },
    });
    await wrapper.find('[data-test="lrt-reset"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    const events = wrapper.emitted("reset-from-library");
    expect(events).toBeTruthy();
    fetchSpy.mockRestore();
  });

  it("Reset bails when user cancels confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: libraryTrackedModule, isLibraryTracked: true, isDrifted: true },
    });
    await wrapper.find('[data-test="lrt-reset"]').trigger("click");
    expect(wrapper.emitted("reset-from-library")).toBeUndefined();
  });

  it("Save sends PUT, updates hash via setLibraryHash, emits saved-to-library", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, new_hash: "hash-new" }), { status: 200 }),
    );
    const wrapper = mount(LibraryRoundTripActions, {
      props: { module: libraryTrackedModule, isLibraryTracked: true, isDrifted: true },
    });
    await wrapper.find('[data-test="lrt-save"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/wp/api/modules/abc12345/payload",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(hashes.value?.["abc12345"]).toBe("hash-new");
    expect(wrapper.emitted("saved-to-library")).toBeTruthy();
    fetchSpy.mockRestore();
  });
});
