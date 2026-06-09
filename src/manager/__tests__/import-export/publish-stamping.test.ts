import { describe, it, expect } from "vitest";
import { buildPublishBody, schemaVersionForPayload } from "@/manager/import-export/single-row-publish";
import { CURRENT_SCHEMA_VERSION, SP2B_SCHEMA_VERSION } from "@/manager/import-export/migrations";
import wildcardFixture from "@/validators/fixtures/v1/module-wildcard.json";

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
});
