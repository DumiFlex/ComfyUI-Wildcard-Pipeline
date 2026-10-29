import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_TOKENS, OPTIONAL_TOKENS, PAGE_PIECES, SHARED_TOKENS } from "./tokens";

const ROOT = resolve(__dirname);
const THEME = join(ROOT, "theme");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.(vue|css|ts)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [join(dir, e.name)] : [],
  );
const reads = (f: string): string[] => [...readFileSync(f, "utf8").matchAll(/var\((--wp-[a-z0-9-]*[a-z0-9])\b/g)].map((m) => m[1]);
const themeDefines = new Set(
  files(THEME).flatMap((f) =>
    [...readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--wp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  ),
);
const pieces = files(ROOT).filter((f) => !f.startsWith(THEME + "/") && !f.endsWith("tokens.ts"));
const page = new Set<string>(PAGE_PIECES);
const rel = (f: string) => f.slice(ROOT.length + 1);

describe("kit token names", () => {
  it("canvas pieces read only the shared names", () => {
    const known = new Set<string>([...SHARED_TOKENS, ...OPTIONAL_TOKENS, ...LOCAL_TOKENS]);
    const stray = pieces
      .filter((f) => !page.has(rel(f)))
      .flatMap((f) => reads(f).filter((n) => !known.has(n)).map((n) => `${rel(f)}: ${n}`));
    expect(stray).toEqual([]);
  });

  it("page pieces read only names src/theme/ defines", () => {
    const known = new Set<string>([...themeDefines, ...LOCAL_TOKENS]);
    const stray = pieces
      .filter((f) => page.has(rel(f)))
      .flatMap((f) => reads(f).filter((n) => !known.has(n)).map((n) => `${rel(f)}: ${n}`));
    expect(stray).toEqual([]);
  });

  it("are all defined by the kit theme", () => {
    expect(SHARED_TOKENS.filter((t) => !themeDefines.has(t))).toEqual([]);
  });

  it("list every page piece as a file that exists", () => {
    const names = new Set(pieces.map(rel));
    expect(PAGE_PIECES.filter((p) => !names.has(p))).toEqual([]);
  });

  it("are listed once", () => {
    const all = [...SHARED_TOKENS, ...OPTIONAL_TOKENS, ...LOCAL_TOKENS];
    expect(all.length).toBe(new Set(all).size);
  });
});
