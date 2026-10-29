import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_TOKENS, OPTIONAL_TOKENS, SHARED_TOKENS } from "./tokens";

const ROOT = resolve(__dirname);
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(vue|css|ts)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [join(dir, e.name)] : [],
  );

describe("kit token names", () => {
  it("are the only --wp names a piece reads", () => {
    const known = new Set<string>([...SHARED_TOKENS, ...OPTIONAL_TOKENS, ...LOCAL_TOKENS]);
    const stray = files(ROOT).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/var\((--wp-[a-z0-9-]*[a-z0-9])\b/g)]
        .map((m) => m[1])
        .filter((n) => !known.has(n))
        .map((n) => `${f.slice(ROOT.length + 1)}: ${n}`),
    );
    expect(stray).toEqual([]);
  });

  it("are listed once", () => {
    const all = [...SHARED_TOKENS, ...OPTIONAL_TOKENS, ...LOCAL_TOKENS];
    expect(all.length).toBe(new Set(all).size);
  });
});
