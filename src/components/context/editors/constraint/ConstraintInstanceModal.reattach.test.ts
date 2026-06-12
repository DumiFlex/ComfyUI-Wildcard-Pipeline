import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import ConstraintInstanceModal from "./ConstraintInstanceModal.vue";

// Preview-resolver lookups MISS so the source uuid reads as dangling.
vi.mock("../../../../extension/preview-resolver", () => ({
  cacheVersion: { value: 0 },
  ensure: vi.fn(),
  lookup: () => undefined,
}));

function moduleWithDanglingSource() {
  return {
    id: "c0ffee00",
    _uid: "u1",
    type: "constraint" as const,
    enabled: true,
    collapsed: false,
    entries: [],
    payload_hash: "h",
    meta: { name: "warm-only", description: "", tags: [] },
    payload: {
      source_wildcard_id: "deadbeef", // missing locally
      target_wildcard_id: "facade00", // present as a sibling below
      matrix: { warm: { rough: { mode: "boost", factor: 2 } } },
      exceptions: [{ source_value: "@{deadbeef:warm}", target_value: "x", mode: "allow", factor: 1 }],
    },
    instance: {},
  };
}

function siblings() {
  return [
    {
      id: "facade00", _uid: "u2", type: "wildcard" as const, enabled: true, collapsed: false,
      entries: [], meta: { name: "texture", description: "", tags: [] },
      payload: { sub_categories: ["rough"], options: [{ id: "o1", value: "matte" }] },
      instance: {},
    },
    {
      id: "beef0001", _uid: "u3", type: "wildcard" as const, enabled: true, collapsed: false,
      entries: [], meta: { name: "colour", description: "", tags: [] },
      payload: { sub_categories: ["warm", "cold"], options: [{ id: "o2", value: "red" }] },
      instance: {},
    },
  ];
}

describe("ConstraintInstanceModal — dangling source reattach", () => {
  beforeEach(() => vi.clearAllMocks());

  it("raises the reattach banner for the dangling source only", () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithDanglingSource(), siblingModules: siblings() },
    });
    expect(w.find("[data-test='reattach-row-source']").exists()).toBe(true);
    expect(w.find("[data-test='reattach-row-target']").exists()).toBe(false);
  });

  it("reattach repoints source_wildcard_id + embedded @{} ref and emits save-to-library", async () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithDanglingSource(), siblingModules: siblings() },
    });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    await w.find("[data-test='reattach-confirm-source']").trigger("click");

    const updates = w.emitted("update");
    expect(updates).toBeTruthy();
    const patch = updates![updates!.length - 1][0] as { payload: Record<string, unknown> };
    expect(patch.payload.source_wildcard_id).toBe("beef0001");
    const exc = (patch.payload.exceptions as Array<{ source_value: string }>)[0];
    expect(exc.source_value).toBe("@{beef0001:warm}"); // segments preserved
    expect(w.emitted("save-to-library")).toBeTruthy();
  });
});
