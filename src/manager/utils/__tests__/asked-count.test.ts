import { describe, expect, it } from "vitest";
import corpus from "../../../../tests/fixtures/asked-count-corpus.json";
import { optionCount } from "../asked-count";

describe("optionCount (shared corpus with engine/ai/asked.py)", () => {
  it.each(corpus.cases as Array<[string, number]>)("%s", (text, count) => {
    expect(optionCount(text)).toBe(count);
  });
});
