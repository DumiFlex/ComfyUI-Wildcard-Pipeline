/**
 * Fuzz tests for TS tokenizer + resolver — 10k random inputs.
 *
 * Same contract as Python: never crash, lossless tokenization invariant.
 * Fixed seed for reproducibility.
 */
import { describe, expect, it } from "vitest";
import { tokenizeRich } from "../../../widgets/richTokenize";
import { resolveTokens } from "../../utils/resolveTokens";
import { mulberry32 } from "./_rng-helper";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ${}@|*#$, \n\t";

function randomInput(rng: { random(): number }, maxLen = 200): string {
  const len = Math.floor(rng.random() * (maxLen + 1));
  let s = "";
  for (let i = 0; i < len; i++) {
    s += ALPHABET.charAt(Math.floor(rng.random() * ALPHABET.length));
  }
  return s;
}

describe("Fuzz: tokenizer is lossless and never crashes", () => {
  it("10k random inputs", () => {
    const rng = mulberry32(0);
    for (let i = 0; i < 10_000; i++) {
      const s = randomInput(rng);
      try {
        const tokens = tokenizeRich(s);
        const joined = tokens.map((t) => t.raw).join("");
        expect(joined).toBe(s);
      } catch (e) {
        throw new Error(
          `tokenizeRich crashed on ${JSON.stringify(s)} (iter ${i}): ${e}`,
        );
      }
    }
  });
});

describe("Fuzz: resolver does not crash on random input", () => {
  it("10k random inputs", () => {
    const inputRng = mulberry32(0);
    for (let i = 0; i < 10_000; i++) {
      const s = randomInput(inputRng);
      const ctx = {
        rng: mulberry32(42),
        maxRefDepth: 8,
        strict: false,
        surface: "wildcard" as const,
        developerMode: false,
        warnings: [],
        vars: {},
        modules: Object.fromEntries(
          Array.from({ length: 8 }, (_, j) => [
            `u${j.toString(16).padStart(8, "0")}`,
            {
              type: "wildcard",
              var_binding: `v${j}`,
              options: [{ value: "leaf", weight: 1 }],
            },
          ]),
        ),
      };
      try {
        resolveTokens(s, ctx);
      } catch (e) {
        // Known SyntaxError-like crashes are NOT acceptable in lenient mode.
        // resolveTokens in lenient mode should never throw.
        throw new Error(
          `resolveTokens crashed on ${JSON.stringify(s)} (iter ${i}): ${e}`,
        );
      }
    }
  });
});
