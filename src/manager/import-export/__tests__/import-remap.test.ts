import { describe, expect, it } from "vitest";
import { applyImportRemap, buildImportRemapTable } from "../import-remap";

describe("buildImportRemapTable", () => {
  it("maps old→new from rename pairs, skipping identity + empty", () => {
    const t = buildImportRemapTable([
      { oldId: "deadbeef", newId: "0badf00d" },
      { oldId: "facade00", newId: "facade00" }, // identity — skip
      { oldId: "", newId: "feedface" },          // empty old — skip
    ]);
    expect(t).toEqual({ deadbeef: "0badf00d" });
  });
});

describe("applyImportRemap — friend→local follow-through over imported entities", () => {
  it("repoints a constraint's source/target to the renamed local ids", () => {
    const entities = [
      {
        id: "beef0001", type: "constraint",
        payload: { source_wildcard_id: "deadbeef", target_wildcard_id: "facade00", matrix: {} },
      },
    ];
    const out = applyImportRemap(entities, { deadbeef: "0badf00d", facade00: "feedface" }) as typeof entities;
    expect(out[0].payload.source_wildcard_id).toBe("0badf00d");
    expect(out[0].payload.target_wildcard_id).toBe("feedface");
  });

  it("repoints embedded @{} refs in exception values (segments preserved)", () => {
    const entities = [
      {
        id: "beef0001", type: "constraint",
        payload: {
          source_wildcard_id: "deadbeef",
          exceptions: [{ source_value: "@{deadbeef:warm}", target_value: "x", mode: "allow", factor: 1 }],
        },
      },
    ];
    const out = applyImportRemap(entities, { deadbeef: "0badf00d" }) as typeof entities;
    const exc = (out[0].payload.exceptions as Array<{ source_value: string }>)[0];
    expect(exc.source_value).toBe("@{0badf00d:warm}");
  });

  it("leaves entities untouched when the table is empty", () => {
    const entities = [{ id: "beef0001", type: "wildcard", payload: { options: [] } }];
    expect(applyImportRemap(entities, {})).toEqual(entities);
  });

  it("does not rewrite ids absent from the table (refs outside the import)", () => {
    const entities = [{ id: "beef0001", type: "constraint", payload: { source_wildcard_id: "c0ffee00" } }];
    const out = applyImportRemap(entities, { deadbeef: "0badf00d" }) as typeof entities;
    expect(out[0].payload.source_wildcard_id).toBe("c0ffee00");
  });
});
