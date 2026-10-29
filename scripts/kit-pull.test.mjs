// The drift check behind `pnpm kit:check` (see kit-pull.mjs).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KIT_DIR, LOCK, diffLock, hashTree } from "./kit-pull.mjs";

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function tree(files) {
  const d = mkdtempSync(join(tmpdir(), "kit-pull-test-"));
  dirs.push(d);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), text);
  }
  return d;
}

describe("kit pull", () => {
  it("hashes every file but the lock, with / paths and LF endings", () => {
    const lf = hashTree(tree({ "A.vue": "a\nb\n", "__tests__/A.test.ts": "t", [LOCK]: "{}" }));
    expect(Object.keys(lf).sort()).toEqual(["A.vue", "__tests__/A.test.ts"].sort());
    expect(hashTree(tree({ "A.vue": "a\r\nb\r\n", "__tests__/A.test.ts": "t" }))).toEqual(lf);
  });

  it("names added, missing and edited files", () => {
    const locked = hashTree(tree({ "A.vue": "a", "B.vue": "b", "C.ts": "c" }));
    const now = hashTree(tree({ "A.vue": "a", "B.vue": "b2", "D.ts": "d" }));
    expect(diffLock(locked, now)).toEqual(["edited:  B.vue", "missing: C.ts", "added:   D.ts"]);
    expect(diffLock(locked, locked)).toEqual([]);
  });

  it("finds src/kit matching its lock", async () => {
    const { readFileSync } = await import("node:fs");
    const lock = JSON.parse(readFileSync(join(KIT_DIR, LOCK), "utf8"));
    expect(lock.repo).toBe("DumiFlex/wp-kit");
    expect(diffLock(lock.files, hashTree(KIT_DIR))).toEqual([]);
  });
});
