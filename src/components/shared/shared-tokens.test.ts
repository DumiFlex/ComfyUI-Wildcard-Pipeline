// The token names a kit piece may use (SHARED_TOKENS, src/kit/tokens.ts,
// pulled from wp-kit): both the canvas theme (components/shared/theme.css)
// and the manager (manager/styles/tokens.css) must define every one, so a
// piece reads the same names on both sides and wears each side's colours.
// wp-kit's own tokens.test.ts keeps every kit piece to the list; this file
// checks both hosts define it and the shared pieces left here use it
// (docs/component-standard.md, rule 5).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SHARED_TOKENS } from "../../kit/tokens";

const read = (p: string): string => readFileSync(resolve(__dirname, p), "utf8");
const defined = (css: string): Set<string> =>
  new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--wp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

describe("shared token names", () => {
  const canvas = defined(read("./theme.css"));
  const manager = defined(read("../../manager/styles/tokens.css"));

  it("are defined by the canvas theme", () => {
    expect(SHARED_TOKENS.filter((t) => !canvas.has(t))).toEqual([]);
  });

  it("are defined by the manager", () => {
    expect(SHARED_TOKENS.filter((t) => !manager.has(t))).toEqual([]);
  });

  it("are the only --wp names the shared pieces left here read", () => {
    const shared = new Set<string>(SHARED_TOKENS);
    // Kit pieces are held to the list by wp-kit's tokens.test.ts.
    const files = ["./ConfirmDialog.vue"];
    const stray = files.flatMap((f) =>
      [...read(f).matchAll(/var\((--wp-[a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => !shared.has(n)).map((n) => `${f}: ${n}`),
    );
    expect(stray).toEqual([]);
  });
});
