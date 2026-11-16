#!/usr/bin/env node
/**
 * What is inside a manager chunk, from the dump `vite.manager-analyze.mts` writes. Not shipped.
 *
 *   node scripts/perf/manager-modules.mjs [entry|<chunk name part>] [top=40]
 *
 * Prints the chunk's rendered size grouped by package / source folder, then its largest modules.
 */
import { readFileSync } from "node:fs";

const dump = JSON.parse(readFileSync(".tmp/perf/manager-analyze/modules.json", "utf8"));
const pick = process.argv[2] ?? "entry";
const top = +(process.argv[3] ?? 40);
for (const [name, c] of Object.entries(dump)) {
  if (pick === "entry" ? !c.isEntry : !name.includes(pick)) continue;
  const total = c.modules.reduce((a, m) => a + m[1], 0);
  console.log(`${name}: ${c.modules.length} modules, rendered ${(total / 1024).toFixed(0)} KB; imports ${c.imports.length}, dynamic ${c.dynamicImports.length}`);
  const groups = {};
  for (const [id, n] of c.modules) {
    const g = id.startsWith("node_modules")
      ? id.replace(/^node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, "").split("/").slice(0, id.includes("/@") ? 2 : 1).join("/")
      : id.split("/").slice(0, 3).join("/");
    groups[g] = (groups[g] ?? 0) + n;
  }
  for (const [g, n] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`   [group] ${g.padEnd(56)} ${(n / 1024).toFixed(1)} KB`);
  }
  for (const [id, n] of c.modules.slice(0, top)) console.log(`   ${id.padEnd(86)} ${(n / 1024).toFixed(1)} KB`);
}
