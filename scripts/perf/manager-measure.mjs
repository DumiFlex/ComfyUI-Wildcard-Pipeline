#!/usr/bin/env node
/**
 * Manager performance probe (Playwright, headless Chromium 1440×900). Not shipped (`scripts/`
 * is in `.comfyignore`) and not run by CI.
 *
 * It only reads: it navigates, types into search boxes and into one editor field (never saves)
 * and never sends an AI chat message. Run it against `serve.py` (the real `/wp/api` on a scratch
 * library, no ComfyUI) with a realistic library, e.g. a copy of a real `wildcard-pipeline.db`:
 *
 *   pnpm build:manager
 *   python bench/dev/serve.py --port 8302 --work <scratch folder holding library.db>
 *   node scripts/perf/manager-measure.mjs --base http://127.0.0.1:8302 --throttle 4 \
 *     [--idle 30] [--out manager-perf-4x.json] [--editor hair] [--only boot,search,editor]
 *
 * Measure before and after back-to-back (other work on the machine moves the numbers) at 1× and
 * 4× CPU throttle (`--throttle 4` is roughly a mid laptop). It prints and writes JSON with:
 *
 *   bootWildcards / bootDashboard  cold boot of that page: FCP/LCP, API calls + KB (and which
 *                                  ones were repeated), JS KB as sent, long tasks (count, total
 *                                  and max ms = "blocked main thread"), heap, DOM nodes
 *   nav[]                          sidebar click to each page: API calls, KB, long-task ms, nodes
 *   searchWildcards / searchAll    typing "color hair" (60 ms apart) into the list search:
 *   / searchBundles                API requests + KB, slow key/input event p50/max, long tasks
 *   editorBig                      opening the wildcard named `--editor` (default "hair", 151
 *                                  options in the reference library) then typing " perf" into
 *                                  option 0: open long tasks, typing event p50/max
 *   health                         nav to Health: long tasks, DOM nodes
 *   idle                           requests while a list page sits idle for `--idle` seconds
 *
 * `scripts/perf/manager-sizes.mjs` reports the gzip size of the boot chunk closure.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const BASE = opt("base", "http://127.0.0.1:8302");
const THROTTLE = +opt("throttle", "1");
const IDLE_S = +opt("idle", "0");
const OUT_FILE = opt("out", "");
const EDITOR_NAME = opt("editor", "hair");
const ONLY = new Set(opt("only", "boot,nav,search,editor,health,idle").split(","));
const OUT = { base: BASE, throttle: THROTTLE, at: new Date().toISOString() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.__perf = { longtasks: [], lcp: 0, events: [], cls: 0 };
  const obs = (type, fn, extra = {}) =>
    new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra });
  obs("longtask", (e) => window.__perf.longtasks.push({ start: e.startTime, dur: e.duration }));
  obs("largest-contentful-paint", (e) => (window.__perf.lcp = e.startTime));
  obs("layout-shift", (e) => !e.hadRecentInput && (window.__perf.cls += e.value));
  obs("event", (e) => window.__perf.events.push({ name: e.name, dur: e.duration }), { durationThreshold: 16 });
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

const reqs = [];
page.on("requestfinished", async (req) => {
  const t = req.timing();
  let size = 0;
  try {
    size = (await req.sizes()).responseBodySize;
  } catch {
    /* gone */
  }
  reqs.push({ url: req.url().replace(BASE, ""), type: req.resourceType(), dur: t.responseEnd, size, wall: Date.now() });
});
const since = (w) => reqs.filter((r) => r.wall >= w);
const sum = (a) => a.reduce((x, r) => x + Math.max(0, r.size), 0);
const kb = (n) => +(n / 1024).toFixed(0);
const ltSum = (lt) => +lt.reduce((a, t) => a + t.dur, 0).toFixed(0);
const ltMax = (lt) => +Math.max(0, ...lt.map((t) => t.dur)).toFixed(0);
const isApi = (r) => r.url.includes("/api/");
async function settle(quietMs = 600, maxMs = 20000) {
  const t0 = Date.now();
  let last = reqs.length;
  let lastChange = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(100);
    if (reqs.length !== last) {
      last = reqs.length;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange >= quietMs) break;
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function heap() {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  const m = (await cdp.send("Performance.getMetrics")).metrics;
  const g = (n) => m.find((x) => x.name === n)?.value;
  return { heapMB: +(g("JSHeapUsedSize") / 1048576).toFixed(1), nodes: g("Nodes"), listeners: g("JSEventListeners") };
}
const takeLong = () => page.evaluate(() => { const l = window.__perf.longtasks; window.__perf.longtasks = []; return l; });
const takeEvents = () => page.evaluate(() => { const l = window.__perf.events; window.__perf.events = []; return l; });
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : 0;
};
const booted = () => page.waitForFunction(() => !document.querySelector(".wp-boot"), null, { timeout: 30000 });

async function boot(path) {
  const w0 = Date.now();
  await page.goto(BASE + path, { waitUntil: "load" });
  await booted();
  await settle(1200);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { fcp: Math.round(fcp?.startTime ?? 0), lcp: Math.round(window.__perf.lcp), cls: +window.__perf.cls.toFixed(3), dcl: Math.round(n.domContentLoadedEventEnd) };
  });
  const rs = since(w0);
  const lt = await takeLong();
  const api = rs.filter(isApi);
  const counts = {};
  for (const r of api) {
    const k = r.url.split("?")[0];
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return {
    path, ...nav, requests: rs.length, totalKB: kb(sum(rs)),
    jsKB: kb(sum(rs.filter((r) => r.type === "script"))), jsFiles: rs.filter((r) => r.type === "script").length,
    apiCount: api.length, apiKB: kb(sum(api)),
    apiDup: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 1)),
    apiList: api.map((r) => `${r.url} ${(r.size / 1024).toFixed(1)}KB`),
    longTasks: lt.length, longTaskMs: ltSum(lt), maxLongTask: ltMax(lt), ...(await heap()),
  };
}

async function navTo(p) {
  const link = page.locator(`a[href="/wp/${p}"]`).first();
  if (!(await link.count())) return { page: p, error: "no sidebar link" };
  await settle(400);
  await takeLong();
  const w0 = Date.now();
  await link.click();
  await page.waitForURL(`**/wp/${p}**`);
  await settle(500);
  const rs = since(w0);
  const lt = await takeLong();
  return {
    page: p, apiCalls: rs.filter(isApi).map((r) => r.url.split("?")[0].replace("/wp/api", "")).join(" "),
    KB: kb(sum(rs)), longTasks: lt.length, longTaskMs: ltSum(lt), maxLongTask: ltMax(lt), domNodes: (await heap()).nodes,
  };
}

async function typeSearch(path, text) {
  await page.goto(BASE + path, { waitUntil: "load" });
  await booted();
  await settle(800);
  const input = page.locator("main input[type=search], main input[placeholder*=earch]").first();
  if (!(await input.count())) return { path, error: "no search input" };
  await input.click();
  await takeEvents();
  await takeLong();
  const w0 = Date.now();
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(60);
  }
  await settle(600);
  const ev = (await takeEvents()).filter((e) => /key|input/.test(e.name)).map((e) => e.dur);
  const lt = await takeLong();
  const rs = since(w0).filter(isApi);
  return {
    path, text, apiRequests: rs.length, apiKB: kb(sum(rs)), urls: rs.slice(0, 4).map((r) => r.url),
    slowEvents: ev.length, eventP50: pct(ev, 0.5), eventMax: pct(ev, 1), longTasks: lt.length, longTaskMs: ltSum(lt),
  };
}

async function editor(path, label, fieldSel) {
  await page.goto(BASE + "/wp/settings", { waitUntil: "load" });
  await booted();
  await settle(800);
  await takeLong();
  const w0 = Date.now();
  await page.goto(BASE + path, { waitUntil: "load" });
  await booted();
  await settle(1000);
  const lt = await takeLong();
  const h = await heap();
  const rs = since(w0).filter(isApi);
  let typing = { error: "no field" };
  const field = page.locator(fieldSel).first();
  if (await field.count()) {
    await field.click();
    await page.keyboard.press("End");
    await settle(300);
    await takeEvents();
    await takeLong();
    for (const ch of " perf") {
      await page.keyboard.type(ch);
      await sleep(80);
    }
    await settle(400);
    const ev = (await takeEvents()).filter((e) => /key|input/.test(e.name)).map((e) => e.dur);
    const lt2 = await takeLong();
    typing = { slowEvents: ev.length, eventP50: pct(ev, 0.5), eventMax: pct(ev, 1), longTasks: lt2.length, longTaskMs: ltSum(lt2) };
  }
  return { label, apiCalls: rs.length, apiKB: kb(sum(rs)), longTasks: lt.length, longTaskMs: ltSum(lt), maxLongTask: ltMax(lt), ...h, typing };
}

if (ONLY.has("boot")) {
  OUT.bootWildcards = await boot("/wp/wildcards");
  OUT.bootDashboard = await boot("/wp/dashboard");
}
if (ONLY.has("nav")) {
  await page.goto(BASE + "/wp/wildcards", { waitUntil: "load" });
  await booted();
  OUT.nav = [];
  for (const p of ["all", "wildcards", "bundles", "constraints", "derivations", "tags", "templates", "categories", "dashboard", "wildcards"]) {
    OUT.nav.push(await navTo(p));
  }
}
if (ONLY.has("search")) {
  OUT.searchWildcards = await typeSearch("/wp/wildcards", "color hair");
  OUT.searchAll = await typeSearch("/wp/all", "color hair");
  OUT.searchBundles = await typeSearch("/wp/bundles", "girl");
}
if (ONLY.has("editor")) {
  const list = await (await fetch(`${BASE}/wp/api/modules?type=wildcard`)).json();
  const big = (list.items ?? list).find((m) => m.name === EDITOR_NAME);
  OUT.editorBig = big
    ? await editor(`/wp/wildcards/${big.id}/edit`, `${big.name} (${big.payload?.options?.length} options)`, "[data-test=wc-opt-row-0] [contenteditable=true]")
    : { error: `no wildcard named ${EDITOR_NAME}` };
}
if (ONLY.has("health")) {
  await page.goto(BASE + "/wp/wildcards", { waitUntil: "load" });
  await booted();
  await settle(1000);
  OUT.health = await navTo("health");
}
if (IDLE_S > 0 && ONLY.has("idle")) {
  await page.goto(BASE + "/wp/wildcards", { waitUntil: "load" });
  await settle(1000);
  const w = Date.now();
  await sleep(IDLE_S * 1000);
  const idle = since(w);
  OUT.idle = { seconds: IDLE_S, requests: idle.length, KB: kb(sum(idle)), urls: [...new Set(idle.map((r) => r.url.split("?")[0]))] };
}
OUT.finalHeap = await heap();
if (OUT_FILE) writeFileSync(OUT_FILE, JSON.stringify(OUT, null, 1));
console.log(JSON.stringify(OUT, null, 1));
await browser.close();
