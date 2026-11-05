import { describe, expect, it, vi } from "vitest";
import { installEnvelope } from "../install";
import { checkEnvelopeShapes, parseCheckedPayload } from "../shape-check";
import type { RawPayload } from "../migrations";

import wildcardRow from "@/validators/fixtures/engine-parity/wildcard.json";
import fixedValuesRow from "@/validators/fixtures/engine-parity/fixed_values.json";
import combineRow from "@/validators/fixtures/engine-parity/combine.json";
import derivationRow from "@/validators/fixtures/engine-parity/derivation.json";
import constraintRow from "@/validators/fixtures/engine-parity/constraint.json";

function envelope(over: Partial<RawPayload> = {}): RawPayload {
  return {
    schema_version: 2,
    bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [],
    constraints: [], categories: [], templates: [],
    ...over,
  };
}

const wildcard = (payload: unknown) => ({ id: "aaaa0001", type: "wildcard", name: "Hats", payload });

describe("checkEnvelopeShapes", () => {
  it("accepts every engine-dumped row, with the extra columns exports carry", () => {
    const extra = { created_at: "2026-10-17", snapshot_fingerprint: "x", community_post_slug: null };
    expect(checkEnvelopeShapes(envelope({
      wildcards: [{ ...wildcardRow, ...extra }],
      fixed_values: [{ ...fixedValuesRow, ...extra }],
      combines: [{ ...combineRow, ...extra }],
      derivations: [{ ...derivationRow, ...extra }],
      constraints: [{ ...constraintRow, ...extra }],
    }))).toBeNull();
  });

  it("accepts what the engine defaults (option value / weight, fixed value id / name)", () => {
    expect(checkEnvelopeShapes(envelope({
      wildcards: [wildcard({ options: [{ id: "o1" }] })],
      fixed_values: [{ id: "bbbb0001", payload: { values: [{ value: "x" }] } }],
    }))).toBeNull();
  });

  it("names the row and the field that is wrong", () => {
    const reason = checkEnvelopeShapes(envelope({ wildcards: [wildcard({ options: "oops" })] }));
    expect(reason).toMatch(/^wildcards\[0\] "Hats": payload\.options: /);
  });

  it("refuses a row with no payload, a negative weight, or a non-object row", () => {
    expect(checkEnvelopeShapes(envelope({ wildcards: [{ id: "aaaa0001", name: "Hats" }] }))).toMatch(/payload/);
    expect(checkEnvelopeShapes(envelope({
      wildcards: [wildcard({ options: [{ id: "o1", value: "a", weight: -1 }] })],
    }))).toMatch(/options\.0\.weight/);
    expect(checkEnvelopeShapes(envelope({ combines: ["nope" as unknown as Record<string, unknown>] })))
      .toBe("combines[0]: must be an object");
  });

  it("checks bundle children by bucket, not by the row's own type", () => {
    expect(checkEnvelopeShapes(envelope({ bundles: [{ id: "cccc0001", name: "B" }] }))).toBeNull();
    expect(checkEnvelopeShapes(envelope({ bundles: [{ id: "cccc0001", name: "B", children: [{ type: "wildcard" }] }] })))
      .toMatch(/^bundles\[0\] "B": children\.0\.id/);
    expect(checkEnvelopeShapes(envelope({
      fixed_values: [{ id: "bbbb0001", type: "fixed_value", payload: { values: [] } }],
    }))).toBeNull();
  });
});

describe("a malformed pack never reaches /import/commit", () => {
  const bad = JSON.stringify(envelope({ wildcards: [wildcard({ options: "oops" })] }));

  it("parseCheckedPayload refuses it", () => {
    const result = parseCheckedPayload(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^invalid item: wildcards\[0\] "Hats": payload\.options/);
  });

  it("installEnvelope fails with parse_failed and never commits", async () => {
    const commit = vi.fn();
    const result = await installEnvelope({ raw: bad }, {
      importExport: { commit } as unknown as Parameters<typeof installEnvelope>[1]["importExport"],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("parse_failed");
    expect(commit).not.toHaveBeenCalled();
  });
});
