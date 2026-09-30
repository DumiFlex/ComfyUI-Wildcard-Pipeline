import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SECTIONS, SETTING_ENTRIES, canvasKey, searchSettings } from "../settings-index";
import { CANVAS_SETTINGS } from "../../../../extension/settings-catalog";

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

describe("settings index", () => {
  it("every entry points at a known section, and keys are unique", () => {
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const e of SETTING_ENTRIES) expect(ids.has(e.section)).toBe(true);
    const keys = SETTING_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every setting-key used on a row is searchable", () => {
    const files = [
      ...readdirSync(dir("../sections")).map((f) => dir(`../sections/${f}`)),
      dir("../BackupsPanel.vue"),
      dir("../DatabaseCard.vue"),
    ];
    const indexed = new Set(SETTING_ENTRIES.map((e) => e.key));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:setting-key|data-setting)="([a-z0-9-]+)"/g)) {
        expect(indexed, `${m[1]} in ${f}`).toContain(m[1]);
      }
    }
  });

  it("indexes every canvas setting", () => {
    const keys = new Set(SETTING_ENTRIES.map((e) => e.key));
    for (const s of CANVAS_SETTINGS) expect(keys).toContain(canvasKey(s.id));
  });

  it("search matches labels, hints and keywords, label hits first", () => {
    expect(searchSettings("")).toEqual([]);
    const backup = searchSettings("backup").map((e) => e.key);
    expect(backup[0]).toMatch(/^backups-/);
    expect(searchSettings("danbooru").map((e) => e.key)).toContain("ac-tags");
    expect(searchSettings("depth recursion").map((e) => e.key)).toContain("ref-depth");
    expect(searchSettings("zzzz")).toEqual([]);
  });
});
