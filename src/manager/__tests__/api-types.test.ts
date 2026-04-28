/**
 * Spec §4.3 — TS twin of canonical Python SnapshotEntry shape. Pinned
 * here so a future refactor on either side surfaces a type error before
 * runtime drift can happen.
 */
import { describe, expect, it } from "vitest";
import type {
  ModuleRow,
  SnapshotEntry,
  WalkOverflow,
  EmbedBundle,
} from "../api/types";
import { api } from "../api/client";

describe("API types", () => {
  it("SnapshotEntry has the seven canonical fields", () => {
    // Compile-time check: this object literal must satisfy the type.
    const entry: SnapshotEntry = {
      snapshot_version: 1,
      uuid: "aabbccdd",
      type: "wildcard",
      name: "color",
      payload: { options: [] },
      payload_hash: "0".repeat(64),
      source: { kind: "user" },
    };
    expect(entry.snapshot_version).toBe(1);
  });

  it("SnapshotEntry source supports kind=dep with parent_uuids", () => {
    const entry: SnapshotEntry = {
      snapshot_version: 1, uuid: "a1b2c3d4", type: "wildcard", name: "x",
      payload: {}, payload_hash: "h".repeat(64),
      source: { kind: "dep", parent_uuids: ["aabbccdd"] },
    };
    expect((entry.source as { kind: "dep"; parent_uuids: string[] }).parent_uuids)
      .toEqual(["aabbccdd"]);
  });

  it("WalkOverflow shape", () => {
    const overflows: WalkOverflow[] = [
      { uuid: "x", reason: "max_depth" },
      { uuid: "y", reason: "cycle_detected" },
      { uuid: "z", reason: "missing_target" },
    ];
    expect(overflows).toHaveLength(3);
  });

  it("EmbedBundle has flat envelope shape", () => {
    const bundle: EmbedBundle = {
      modules: [{ type: "wildcard" }],
      snapshots: {},
      pickOrder: ["aabbccdd"],
      walkOverflow: [],
    };
    expect(bundle.pickOrder).toEqual(["aabbccdd"]);
  });

  it("ModuleRow includes uuid and payload_hash", () => {
    const row: ModuleRow = {
      id: "wc_x_aabbccdd",
      uuid: "aabbccdd",
      type: "wildcard",
      name: "x",
      description: "",
      category_id: null,
      tags: [],
      is_favorite: false,
      payload: {},
      payload_hash: "0".repeat(64),
      version: 1,
      created_at: "2026-04-28T00:00:00.000000Z",
      updated_at: "2026-04-28T00:00:00.000000Z",
    };
    expect(row.uuid).toBe("aabbccdd");
    expect(row.payload_hash).toBeDefined();
  });

  it("client exposes embedBundle and hashes methods", () => {
    expect(typeof api.modules.embedBundle).toBe("function");
    expect(typeof api.modules.hashes).toBe("function");
  });
});
