import { describe, it, expect } from "vitest";
import { buildExtractEnvelope } from "../views/BundleEditor.vue";
import type { ExtractedModule } from "../../components/context/bundles/extract-to-library";

/**
 * Locks the GROUPING + envelope shape produced by `buildExtractEnvelope`.
 * Remap correctness (fresh ids, intra-bundle ref rewrite) is already
 * covered by extract-to-library.test.ts — here we only assert that the
 * extracted modules land in the right install-envelope buckets, keyed by
 * their engine `type`, and that the envelope matches what `installEnvelope`
 * accepts (top-level `schema_version` + plural per-type arrays).
 */
describe("buildExtractEnvelope", () => {
  it("groups modules into install-envelope buckets by type", () => {
    const modules: ExtractedModule[] = [
      { id: "new1", type: "wildcard", name: "wc-a", payload: { options: [] } },
      { id: "new2", type: "wildcard", name: "wc-b", payload: { options: [] } },
      {
        id: "new3",
        type: "constraint",
        name: "pair",
        payload: {
          source_wildcard_id: "new1",
          target_wildcard_id: "new2",
          matrix: {},
          exceptions: [],
        },
      },
    ];

    const envelope = buildExtractEnvelope(modules);

    // Top-level shape installEnvelope/parsePayload expects.
    expect(envelope.schema_version).toBeTypeOf("number");
    expect(envelope.fixed_values).toEqual([]);
    expect(envelope.combines).toEqual([]);
    expect(envelope.derivations).toEqual([]);
    expect(envelope.bundles).toEqual([]);
    expect(envelope.categories).toEqual([]);
    expect(envelope.templates).toEqual([]);

    // Both wildcards land in the wildcards bucket.
    expect(envelope.wildcards).toHaveLength(2);
    expect(envelope.wildcards.map((w) => w.id)).toEqual(["new1", "new2"]);
    expect(envelope.wildcards[0]).toMatchObject({
      id: "new1",
      type: "wildcard",
      name: "wc-a",
    });

    // The constraint lands in the constraints bucket with refs intact.
    expect(envelope.constraints).toHaveLength(1);
    expect(envelope.constraints[0]).toMatchObject({
      id: "new3",
      type: "constraint",
      name: "pair",
    });
    const cpayload = envelope.constraints[0].payload as Record<string, unknown>;
    expect(cpayload.source_wildcard_id).toBe("new1");
    expect(cpayload.target_wildcard_id).toBe("new2");
  });

  it("carries description + tags onto the entity when present", () => {
    const modules: ExtractedModule[] = [
      {
        id: "new1",
        type: "fixed_values",
        name: "fv",
        description: "a note",
        tags: ["x", "y"],
        payload: { values: [] },
      },
    ];
    const envelope = buildExtractEnvelope(modules);
    expect(envelope.fixed_values).toHaveLength(1);
    expect(envelope.fixed_values[0]).toMatchObject({
      id: "new1",
      type: "fixed_values",
      name: "fv",
      description: "a note",
      tags: ["x", "y"],
    });
  });
});
