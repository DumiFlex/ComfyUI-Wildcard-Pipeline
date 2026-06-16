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

// Same dangling source, but a TWO-ROW matrix: `warm` survives under
// candidate beef0001 (subs ["warm","cold"]) while `cool` VANISHES, so a
// source reattach to beef0001 drops every cell in the `cool` row (2 cells).
function moduleWithDroppingSource() {
  return {
    id: "c0ffee01",
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
      matrix: {
        warm: { rough: { mode: "boost", factor: 2 } }, // survives → 0 dropped
        cool: { rough: { mode: "ban", factor: 0 }, smooth: { mode: "boost", factor: 2 } }, // vanishes → 2 cells dropped
      },
      exceptions: [],
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

  it("previews the per-cell dropped count for a non-surviving source pick (pre-confirm)", async () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithDroppingSource(), siblingModules: siblings() },
    });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    // Select candidate beef0001 (subs ["warm","cold"]) WITHOUT confirming:
    // the `cool` row (2 cells) vanishes, `warm` (1 cell) survives → 2 dropped.
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");

    const dropped = w.find("[data-test='reattach-dropped-source']");
    expect(dropped.exists()).toBe(true);
    expect(dropped.text()).toContain("2 cells dropped");
  });

  // A dangling ref makes the whole constraint a read-only snapshot: the
  // modal threads `stranded` into both the matrix + exceptions sections so
  // they render their read-only treatment (muted/locked matrix, static
  // colored exception chips), mirroring the SPA's stranded read-only view.
  it("marks the matrix + exceptions sections stranded when a ref is dangling", () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithDanglingSource(), siblingModules: siblings() },
    });
    expect(w.findComponent({ name: "MatrixSection" }).props("stranded")).toBe(true);
    expect(w.findComponent({ name: "ExceptionsSection" }).props("stranded")).toBe(true);
    // The rendered read-only affordances surface too.
    expect(w.find("[data-test='mx-readonly-lock']").exists()).toBe(true);
  });
});

// ── Cached source/target ref NAME (display-only, additive) ─────────
//
// The constraint payload caches the source/target wildcard display name
// (`source_wildcard_name`/`target_wildcard_name`) so the broken-reference
// banner reads "Source wildcard 'Starter subject' (deadbeef)" even after the
// wildcard is deleted (the live lookup misses → name unrecoverable otherwise).

/** Dangling source, but the payload carries the cached display name. The
 *  preview-resolver lookup MISSES (mock returns undefined) and the wildcard
 *  is not a sibling, so `wildcardName` yields "" — the banner must fall back
 *  to the payload's cached `source_wildcard_name`. */
function moduleWithCachedSourceName() {
  return {
    id: "c0ffee02",
    _uid: "u1",
    type: "constraint" as const,
    enabled: true,
    collapsed: false,
    entries: [],
    payload_hash: "h",
    meta: { name: "warm-only", description: "", tags: [] },
    payload: {
      source_wildcard_id: "deadbeef", // missing locally → dangling
      target_wildcard_id: "facade00", // present sibling
      source_wildcard_name: "Starter subject", // cached on write
      matrix: { warm: { rough: { mode: "boost", factor: 2 } } },
      exceptions: [],
    },
    instance: {},
  };
}

describe("ConstraintInstanceModal — cached source ref name", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the cached source name + uuid in the dangling banner", () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithCachedSourceName(), siblingModules: siblings() },
    });
    const row = w.find("[data-test='reattach-row-source']");
    expect(row.exists()).toBe(true);
    const txt = row.text();
    expect(txt).toContain("Starter subject"); // cached name survives deletion
    expect(txt).toContain("deadbeef"); // alongside the uuid prefix
  });

  it("reattach stamps source_wildcard_name from the emitted newName", async () => {
    const w = mount(ConstraintInstanceModal, {
      props: { module: moduleWithCachedSourceName(), siblingModules: siblings() },
    });
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    await w.find("[data-test='reattach-confirm-source']").trigger("click");

    const updates = w.emitted("update");
    expect(updates).toBeTruthy();
    const patch = updates![updates!.length - 1][0] as { payload: Record<string, unknown> };
    expect(patch.payload.source_wildcard_id).toBe("beef0001");
    // The repointed name is the picked candidate's name ("colour").
    expect(patch.payload.source_wildcard_name).toBe("colour");
  });
});
