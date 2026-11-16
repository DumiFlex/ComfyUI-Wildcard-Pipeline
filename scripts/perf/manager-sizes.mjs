#!/usr/bin/env node
/**
 * Gzip sizes of a manager build and of what its entry loads statically (the "boot chunk"
 * closure: the shell's <script>/<link> plus every chunk they `import` without `import()`).
 * Not shipped, not run by CI.
 *
 *   pnpm build:manager
 *   node scripts/perf/manager-sizes.mjs [web] [--top 25]
 *
 * Prints total JS/CSS, the boot closure (files + gzip KB, largest first) and the largest chunks.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--")) ?? "web";
const topIdx = args.indexOf("--top");
const TOP = topIdx >= 0 ? +args[topIdx + 1] : 25;
const assets = join(dir, "assets");
const files = readdirSync(assets).filter((f) => /\.(js|css)$/.test(f));
const info = new Map();
for (const f of files) {
  const buf = readFileSync(join(assets, f));
  info.set(f, { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length, src: buf.toString("utf8") });
}
const shell = ["index.html", "manager.html", "src/manager.html"].map((p) => join(dir, p)).find(existsSync);
const html = readFileSync(shell, "utf8");
const entry = [...html.matchAll(/assets\/([^"]+\.(?:js|css))/g)].map((m) => m[1]);
const seen = new Set();
function walk(f) {
  if (seen.has(f) || !info.has(f)) return;
  seen.add(f);
  for (const m of info.get(f).src.matchAll(/(?:import|from)\s*["']\.\/([^"']+)["']/g)) walk(m[1]);
}
entry.forEach(walk);
const kb = (n) => (n / 1024).toFixed(1);
const sum = (arr, k) => arr.reduce((a, f) => a + info.get(f)[k], 0);
const js = files.filter((f) => f.endsWith(".js"));
const css = files.filter((f) => f.endsWith(".css"));
const boot = [...seen];
const bootJs = boot.filter((f) => f.endsWith(".js"));
console.log(`all JS:  ${js.length} files, raw ${kb(sum(js, "raw"))} KB, gzip ${kb(sum(js, "gz"))} KB`);
console.log(`all CSS: ${css.length} files, raw ${kb(sum(css, "raw"))} KB, gzip ${kb(sum(css, "gz"))} KB`);
console.log(`BOOT JS: ${bootJs.length} files, raw ${kb(sum(bootJs, "raw"))} KB, gzip ${kb(sum(bootJs, "gz"))} KB`);
console.log(`BOOT all: ${boot.length} files, gzip ${kb(sum(boot, "gz"))} KB`);
for (const f of boot.sort((a, b) => info.get(b).gz - info.get(a).gz)) {
  console.log(`  boot ${f.padEnd(48)} gz ${kb(info.get(f).gz).padStart(6)} KB  raw ${kb(info.get(f).raw)} KB`);
}
console.log(`largest ${TOP} chunks (gzip):`);
for (const f of [...files].sort((a, b) => info.get(b).gz - info.get(a).gz).slice(0, TOP)) {
  console.log(`  ${f.padEnd(48)} gz ${kb(info.get(f).gz).padStart(6)} KB  raw ${kb(info.get(f).raw)} KB`);
}
