import { describe, expect, it } from "vitest";
import corpus from "../../../../tests/fixtures/step-fields-corpus.json";
import { stripStepFields } from "../chat-step-fields";

describe("stripStepFields (shared corpus with engine/ai/step_fields.py)", () => {
  it.each(corpus.cases as Array<[string, string, string]>)("%s", (_name, text, shown) => {
    expect(stripStepFields(text)).toBe(shown);
  });

  it("returns unchanged text as it is", () => {
    expect(stripStepFields("Hi.\n")).toBe("Hi.\n");
  });
});
