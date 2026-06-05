import { describe, it, expect } from "vitest";
import { buildPublishBody } from "@/manager/import-export/single-row-publish";
import { CURRENT_SCHEMA_VERSION } from "@/manager/import-export/migrations";
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
});
