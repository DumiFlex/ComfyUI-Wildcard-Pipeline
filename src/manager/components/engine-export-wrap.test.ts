import { describe, it, expect } from "vitest";
import { wrapAsEngineExport } from "./engine-export-wrap";
import { parsePayload } from "../import-export/parse";

describe("wrapAsEngineExport", () => {
  it("stamps the downloaded version's schema_version, not a pinned constant", () => {
    const env = wrapAsEngineExport({
      kind: "module",
      subtype: "wildcard",
      payload: { id: "aabb0001", type: "wildcard" },
      schema_version: 5,
    });
    expect(env.schema_version).toBe(5);
    expect(env.wildcards).toEqual([{ id: "aabb0001", type: "wildcard" }]);
  });

  it("routes a bundle into the bundles bucket", () => {
    const env = wrapAsEngineExport({
      kind: "bundle",
      subtype: null,
      payload: { id: "bbbb0001", children: [] },
      schema_version: 2,
    });
    expect(env.bundles).toHaveLength(1);
    expect(env.wildcards).toHaveLength(0);
  });

  it("a v2+ pack installs without re-running the v1→v2 migration", () => {
    // The old pinned stamp of 1 sent every community update through
    // migrateV1ToV2 again. At the pack's own version nothing migrates.
    const env = wrapAsEngineExport({
      kind: "module",
      subtype: "wildcard",
      payload: {
        id: "aabb0001",
        type: "wildcard",
        name: "outfit",
        payload: {
          sub_categories: ["boots"],
          tag_groups: { SHOES: ["boots"] },
          tag_group_kinds: { SHOES: "accepts" },
          options: [{ id: "o1", value: "hiker", weight: 1, sub_categories: ["boots"] }],
        },
      },
      schema_version: 5,
    });
    const parsed = parsePayload(JSON.stringify(env));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migratedEntityCount).toBe(0);
    expect(parsed.payload.schema_version).toBe(5);
  });
});
