/**
 * `note-assets.json` lists the pictures a note can show from the extension:
 * the note pictures plus every docs screenshot, with their pixel sizes (so a
 * note lays out before they load). It must match the files on disk; run
 * `pnpm notes:assets` after adding, removing or re-shooting a picture
 * (labels already in the file are kept, so they can be written by hand).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import listed from "./note-assets.json";

interface Asset { id: string; label: string; file: string; w: number; h: number }

const ROOT = resolve(__dirname, "../../../public/images");
const FOLDERS = ["note", "docs"];
const JSON_PATH = resolve(__dirname, "note-assets.json");

function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
/** "wp-context-loop-grid.png" → "WP Context Loop grid". */
function labelFor(stem: string): string {
  const words = stem.split(/[-_]+/).filter(Boolean);
  const out = words.map((w, i) => (w === "wp" ? "WP" : i === 0 ? w[0]?.toUpperCase() + w.slice(1) : w));
  return out.join(" ");
}

function onDisk(old: readonly Asset[]): Asset[] {
  const labels = new Map(old.map((a) => [a.file, a.label]));
  const out: Asset[] = [];
  for (const folder of FOLDERS) {
    for (const name of readdirSync(resolve(ROOT, folder)).sort()) {
      if (!name.endsWith(".png")) continue;
      const stem = name.replace(/\.png$/, "");
      const file = `${folder}/${name}`;
      const id = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      out.push({ id, label: labels.get(file) ?? labelFor(stem), file, ...pngSize(resolve(ROOT, file)) });
    }
  }
  return out;
}

describe("note-assets.json", () => {
  it("lists every note and docs picture with its size", () => {
    const want = onDisk(listed);
    if (process.env.WP_WRITE_NOTE_ASSETS) writeFileSync(JSON_PATH, `${JSON.stringify(want, null, 2)}\n`);
    else expect(listed, "note-assets.json is stale: run `pnpm notes:assets`").toEqual(want);
  });

  it("gives every picture a unique id a note can name", () => {
    const ids = listed.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,64}$/);
  });
});
