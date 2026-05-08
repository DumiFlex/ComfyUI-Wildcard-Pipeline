/**
 * TS tokenizer parity test.
 *
 * Reads `tests/fixtures/syntax-corpus.json` (the SAME file the Python
 * tokenizer test uses) and asserts identical token output. Bumping
 * EXPECTED_CORPUS_VERSION must be done in lockstep with the Python pin.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizeRich, type RichToken } from "../../../widgets/richTokenize";

const EXPECTED_CORPUS_VERSION = 1;

const CORPUS_PATH = path.resolve(
  __dirname,
  "../../../../tests/fixtures/syntax-corpus.json",
);

interface CorpusCase {
  name: string;
  input: string;
  expected_tokens: Array<{
    kind: string;
    raw: string;
    start: number;
    end: number;
    meta: Record<string, unknown>;
  }>;
}

const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf-8")) as {
  version: number;
  cases: CorpusCase[];
};

/** Convert TS tokenizer's `dp-brace` kind to corpus `dp_brace` form. */
function normalizeKind(k: string): string {
  return k.replace(/-/g, "_");
}

function tokenToCorpusShape(t: RichToken): CorpusCase["expected_tokens"][number] {
  return {
    kind: normalizeKind(t.kind),
    raw: t.raw,
    start: t.start,
    end: t.end,
    meta: (t.meta as Record<string, unknown>) ?? {},
  };
}

describe("TS tokenizer parity with Python corpus", () => {
  it("corpus version matches expected", () => {
    expect(corpus.version).toBe(EXPECTED_CORPUS_VERSION);
  });

  for (const c of corpus.cases) {
    it(`tokenize: ${c.name}`, () => {
      const actual = tokenizeRich(c.input).map(tokenToCorpusShape);
      expect(actual).toEqual(c.expected_tokens);
    });
  }

  it("lossless invariant on every corpus input", () => {
    for (const c of corpus.cases) {
      const joined = tokenizeRich(c.input).map((t) => t.raw).join("");
      expect(joined).toBe(c.input);
    }
  });
});