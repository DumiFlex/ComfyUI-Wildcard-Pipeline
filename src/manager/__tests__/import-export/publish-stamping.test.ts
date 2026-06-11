import { describe, it, expect } from "vitest";
import { buildPublishBody, schemaVersionForPayload } from "@/manager/import-export/single-row-publish";
import {
  CURRENT_SCHEMA_VERSION,
  SP2B_SCHEMA_VERSION,
  SP3_REACH_SCHEMA_VERSION,
} from "@/manager/import-export/migrations";
import wildcardFixture from "@/validators/fixtures/v1/module-wildcard.json";

/** Minimal engine-row constraint module carrying a `target_select`. Carries
 *  every `moduleRowBase` required field so it also passes strict v2
 *  validation inside `buildPublishBody`. The reach selector lives at
 *  `payload.target_select` (library default) — see `ConstraintPayload` in
 *  `manager/api/types.ts`. */
function constraintRow(targetSelect?: unknown): Record<string, unknown> {
  return {
    id: "cn-001abc",
    type: "constraint",
    name: "mood-constraint",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {
      source_wildcard_id: "wc-aaa",
      target_wildcard_id: "wc-bbb",
      matrix: {},
      exceptions: [],
      ...(targetSelect === undefined ? {} : { target_select: targetSelect }),
    },
  };
}

// Re-import the version constant from package.json so this test
// stays in sync if the version is bumped.
import { version as PKG_VERSION } from "../../../../package.json";

describe("publish body stamping", () => {
  it("stamps schema_version = CURRENT_SCHEMA_VERSION", () => {
    const body = buildPublishBody({
      payload: wildcardFixture as Record<string, unknown>,
      name: "demo",
      description: "",
    });
    expect(body.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("stamps producer_engine_version from package.json", () => {
    const body = buildPublishBody({
      payload: wildcardFixture as Record<string, unknown>,
      name: "demo",
      description: "",
    });
    expect(body.producer_engine_version).toBe(PKG_VERSION);
  });

  it("throws on payloads that fail strict v1 validation", () => {
    const broken = { ...wildcardFixture, mystery_field: 42 } as Record<string, unknown>;
    expect(() => buildPublishBody({ payload: broken, name: "demo", description: "" }))
      .toThrowError(/structural validation/);
  });

  it("identifies kind=bundle when children array is present", () => {
    const bundlePayload = {
      id: "bd-001abc",
      name: "starter-bundle",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [],
    } as Record<string, unknown>;
    const body = buildPublishBody({ payload: bundlePayload, name: "demo", description: "" });
    expect(body.schema_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("forwards name + description verbatim", () => {
    const body = buildPublishBody({
      payload: wildcardFixture as Record<string, unknown>,
      name: "my-thing",
      description: "long description",
    });
    expect(body.name).toBe("my-thing");
    expect(body.description).toBe("long description");
  });

  // --- SP2b: stamp the higher catalog version ONLY when the payload TEXT
  //     uses the new range / independent multi-pick grammar ---

  it("schemaVersionForPayload keeps CURRENT for a plain fixed-count multi-pick", () => {
    // `{N$$…}` has existed since SP2a — not an SP2b shape.
    expect(schemaVersionForPayload({ template: "{2$$, $$a|b}" })).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("schemaVersionForPayload bumps to SP2B for a range count", () => {
    expect(schemaVersionForPayload({ template: "{2-4$$, $$a|b}" })).toBe(SP2B_SCHEMA_VERSION);
  });

  it("schemaVersionForPayload bumps to SP2B for the independent `~` flag", () => {
    expect(schemaVersionForPayload({ template: "{3~$$, $$a|b}" })).toBe(SP2B_SCHEMA_VERSION);
  });

  it("schemaVersionForPayload keeps CURRENT when there is no multi-pick at all", () => {
    expect(schemaVersionForPayload({ template: "a {red|blue} c" })).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("finds the SP2b marker nested deep in the engine-row payload", () => {
    const deep = { id: "x", payload: { options: [{ value: "{0-2~$$ $$@{aabbccdd}}" }] } };
    expect(schemaVersionForPayload(deep)).toBe(SP2B_SCHEMA_VERSION);
  });

  it("buildPublishBody stamps the SP2B version when an option value uses range/independent", () => {
    const sp2b = JSON.parse(JSON.stringify(wildcardFixture)) as Record<string, unknown>;
    (sp2b.payload as { options: Array<{ value: string }> }).options[0].value =
      "{2-4~$$, $$@{aabbccdd}|warm}";
    const body = buildPublishBody({ payload: sp2b, name: "demo", description: "" });
    expect(body.schema_version).toBe(SP2B_SCHEMA_VERSION);
  });

  // --- SP3: stamp catalog v4 ONLY when a constraint's `target_select`
  //     reach selector is NON-DEFAULT (mode != "all" / non-empty picks /
  //     a count). An absent selector or the default `{mode:"all"}` does
  //     NOT bump — those are byte-identical to a pre-SP3 payload. ---

  it("schemaVersionForPayload bumps to SP3_REACH for a non-default `next` selector", () => {
    expect(schemaVersionForPayload(constraintRow({ mode: "next", count: 2 }))).toBe(
      SP3_REACH_SCHEMA_VERSION,
    );
  });

  it("schemaVersionForPayload bumps to SP3_REACH for a `first` selector", () => {
    expect(schemaVersionForPayload(constraintRow({ mode: "first" }))).toBe(
      SP3_REACH_SCHEMA_VERSION,
    );
  });

  it("schemaVersionForPayload bumps to SP3_REACH for a non-empty `pick` selector", () => {
    expect(
      schemaVersionForPayload(
        constraintRow({ mode: "pick", picks: [{ kind: "direct", uid: "row-1" }] }),
      ),
    ).toBe(SP3_REACH_SCHEMA_VERSION);
  });

  it("schemaVersionForPayload keeps CURRENT for the default `{mode:'all'}` selector", () => {
    expect(schemaVersionForPayload(constraintRow({ mode: "all" }))).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("schemaVersionForPayload keeps CURRENT when there is no target_select at all", () => {
    expect(schemaVersionForPayload(constraintRow())).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("schemaVersionForPayload bumps for a `pick` selector even with empty picks", () => {
    // `mode:"pick"` is itself a non-default mode — a pre-SP3 consumer can't
    // parse the `pick` shape at all, so it must bump regardless of picks
    // length (mode !== "all" is the deciding clause).
    expect(schemaVersionForPayload(constraintRow({ mode: "pick", picks: [] }))).toBe(
      SP3_REACH_SCHEMA_VERSION,
    );
  });

  it("finds a non-default target_select nested in a bundle child", () => {
    const bundle = {
      id: "bd-001abc",
      name: "reach-bundle",
      children: [
        { id: "wc-x", type: "wildcard", payload: { options: [] } },
        constraintRow({ mode: "next", count: 3 }),
      ],
    } as Record<string, unknown>;
    expect(schemaVersionForPayload(bundle)).toBe(SP3_REACH_SCHEMA_VERSION);
  });

  it("finds a non-default target_select in a constraint INSTANCE override", () => {
    // Per-instance reach lives at `instance.target_select` (full TargetSelect,
    // `pick` allowed). The deep scan must catch it wherever it sits.
    const row = {
      id: "cn-001abc",
      type: "constraint",
      payload: { target_wildcard_id: "wc-bbb", matrix: {}, exceptions: [] },
      instance: { target_select: { mode: "first" } },
    } as Record<string, unknown>;
    expect(schemaVersionForPayload(row)).toBe(SP3_REACH_SCHEMA_VERSION);
  });

  it("stamps SP3_REACH (4) when a payload uses BOTH range syntax AND non-default reach", () => {
    // range-only -> 3, reach-only -> 4, both -> max(3, 4) = 4.
    const row = constraintRow({ mode: "next", count: 2 });
    (row.payload as Record<string, unknown>).note = "{2-4~$$, $$a|b}";
    expect(schemaVersionForPayload(row)).toBe(SP3_REACH_SCHEMA_VERSION);
  });

  it("keeps SP2B (3) for range syntax when reach is absent/default", () => {
    const row = constraintRow({ mode: "all" });
    (row.payload as Record<string, unknown>).note = "{2-4~$$, $$a|b}";
    expect(schemaVersionForPayload(row)).toBe(SP2B_SCHEMA_VERSION);
  });

  it("buildPublishBody stamps SP3_REACH for a published constraint with non-default reach", () => {
    const body = buildPublishBody({
      payload: constraintRow({ mode: "next", count: 2 }),
      name: "demo",
      description: "",
    });
    expect(body.schema_version).toBe(SP3_REACH_SCHEMA_VERSION);
  });
});
