#!/usr/bin/env node
/**
 * Side-by-side table of `manager-measure.mjs` result files (not shipped, not run by CI):
 *
 *   node scripts/perf/manager-compare.mjs before-1x.json after-1x.json [more.json …]
 *
 * One column per file, one row per headline number (boot long tasks + API traffic, search
 * requests + per-key event times, editor open + typing, Health page).
 */
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);
const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const ROWS = [
  ["boot /wildcards long-task ms", "bootWildcards.longTaskMs"],
  ["boot /wildcards max long task", "bootWildcards.maxLongTask"],
  ["boot /wildcards API calls", "bootWildcards.apiCount"],
  ["boot /wildcards API KB", "bootWildcards.apiKB"],
  ["boot /wildcards JS KB (raw)", "bootWildcards.jsKB"],
  ["boot /wildcards FCP", "bootWildcards.fcp"],
  ["boot /dashboard long-task ms", "bootDashboard.longTaskMs"],
  ["boot /dashboard API calls", "bootDashboard.apiCount"],
  ["boot /dashboard API KB", "bootDashboard.apiKB"],
  ["search Wildcards requests", "searchWildcards.apiRequests"],
  ["search Wildcards KB", "searchWildcards.apiKB"],
  ["search Wildcards key p50", "searchWildcards.eventP50"],
  ["search Wildcards key max", "searchWildcards.eventMax"],
  ["search Wildcards long-task ms", "searchWildcards.longTaskMs"],
  ["search All requests", "searchAll.apiRequests"],
  ["search All KB", "searchAll.apiKB"],
  ["search All key p50", "searchAll.eventP50"],
  ["search All key max", "searchAll.eventMax"],
  ["search All long-task ms", "searchAll.longTaskMs"],
  ["search Bundles requests", "searchBundles.apiRequests"],
  ["editor open long-task ms", "editorBig.longTaskMs"],
  ["editor open max long task", "editorBig.maxLongTask"],
  ["editor open API calls", "editorBig.apiCalls"],
  ["editor DOM nodes", "editorBig.nodes"],
  ["editor typing key p50", "editorBig.typing.eventP50"],
  ["editor typing key max", "editorBig.typing.eventMax"],
  ["Health nav long-task ms", "health.longTaskMs"],
  ["Health DOM nodes", "health.domNodes"],
  ["Health nav API", "health.apiCalls"],
  ["idle requests", "idle.requests"],
];
const w = 34;
console.log("".padEnd(w) + files.map((f) => f.split(/[\\/]/).pop().slice(0, 18).padStart(20)).join(""));
for (const [label, path] of ROWS) {
  console.log(label.padEnd(w) + runs.map((r) => String(get(r, path) ?? "-").slice(0, 18).padStart(20)).join(""));
}
for (const r of runs) {
  if (!r.nav) continue;
  console.log(`nav (${r.throttle}x): ` + r.nav.map((n) => `${n.page} ${n.longTaskMs}ms/${n.apiCalls?.split(" ").filter(Boolean).length ?? "?"}req`).join(", "));
}
