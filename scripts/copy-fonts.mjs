#!/usr/bin/env node
// Copy the webfont directory verbatim from src/assets/fonts/ to
// js/assets/fonts/, so ComfyUI serves it under
// /extensions/<package>/assets/fonts/.
//
// These files deliberately do NOT go through Vite. Library mode always
// base64-inlines assets — `build.assetsInlineLimit` is documented as ignored
// when `build.lib` is set — so a woff2 reachable from the module graph ends up
// ~33% larger, inside a JS chunk, parsed as JavaScript. Copying sidesteps the
// bundler entirely; `src/extension/fonts.ts` <link>s the stylesheet at runtime
// and the browser resolves the woff2 URLs relative to it.
//
// Run as part of `pnpm build:extension`, alongside copy-help-docs.mjs.

import { readdirSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src", "assets", "fonts");
const DST = join(ROOT, "js", "assets", "fonts");

try {
  rmSync(DST, { recursive: true, force: true });
  mkdirSync(DST, { recursive: true });
  const files = readdirSync(SRC);
  if (!files.some((f) => f.endsWith(".css"))) {
    // A missing stylesheet is silent at runtime — the <link> 404s and text
    // quietly falls back to the system stack. Fail the build instead.
    throw new Error(`no stylesheet in ${SRC}; fonts.ts expects wp-fonts.css`);
  }
  for (const name of files) {
    copyFileSync(join(SRC, name), join(DST, name));
    console.log(`  src/assets/fonts/${name} → js/assets/fonts/${name}`);
  }
  console.log(`Copied ${files.length} font file(s).`);
} catch (err) {
  console.error("[copy-fonts] failed:", err);
  process.exit(1);
}
