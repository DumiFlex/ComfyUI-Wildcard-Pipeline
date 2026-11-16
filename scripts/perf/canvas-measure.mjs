// Canvas perf probe for the Wildcard Pipeline extension (not shipped; `scripts/`
// is in .comfyignore). Drives a running ComfyUI in headless Chromium and
// reports idle script time, workflow-load blocking, pan frame rate and heap
// growth across load/clear cycles.
//
// Run (needs a ComfyUI with this node installed; NEVER point it at a ComfyUI
// whose workflows matter: it loads and clears graphs, but never saves or queues):
//
//   pnpm build:extension
//   JS_DIR=js node scripts/perf/canvas-measure.mjs "example_workflows/4 - Sets and stories.json" stress40
//
// Arguments are workflow JSON files, or `stressN` for the generated N-Context
// chain (`make-stress.mjs`). Env:
//   BASE        ComfyUI URL (default http://127.0.0.1:8199)
//   JS_DIR      serve /extensions/ComfyUI-Wildcard-Pipeline/** from this build
//               dir instead of what the server ships (compare two builds
//               back to back on the same server)
//   RENDER      vue | legacy: set Comfy.VueNodes.Enabled first
//   IDLE_S      seconds per idle window (default 10)
//   STILL=0     skip the "still" idle window (saves ~25 s per workflow)
//   LEAK_LOOPS  extra load+clear cycles of the first workflow (heap trend)
//   SNAPSHOT    write a .heapsnapshot after the leak loops to this path
//   OUT         JSON report path (default .tmp/perf/canvas-report.json)
//
// Targets (P3 of the 2026-11 performance pass):
//   ex4 ("4 - Sets and stories") idle-active script  < 10 ms/s of ours
//   stress40 idle-active script                      < 30 ms/s of ours
//   workflow load long tasks                         < 1 s
//   heap growth per load+clear cycle                 ≪ 100 MB
//   pan frame rate                                   not worse than before
// "ours" = profiler samples with an extension frame on the stack.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { makeStress } from "./make-stress.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8199";
const JS_DIR = process.env.JS_DIR ? path.resolve(process.env.JS_DIR) : null;
const RENDER = process.env.RENDER;
const IDLE_S = Number(process.env.IDLE_S ?? 10);
const STILL = process.env.STILL !== "0";
const OUR = "Wildcard-Pipeline";
const report = { base: BASE, jsDir: JS_DIR, render: RENDER ?? "as-configured", runs: [] };
const log = (...a) => console.log(...a);

function loadWorkflow(arg) {
  const m = /^stress(\d+)$/.exec(arg);
  if (m) return { name: arg, json: makeStress(Number(m[1])) };
  return { name: path.basename(arg), json: JSON.parse(fs.readFileSync(arg, "utf8")) };
}
const workflows = process.argv.slice(2).map(loadWorkflow);

const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

if (JS_DIR) {
  await context.route("**/extensions/ComfyUI-Wildcard-Pipeline/**", async (route) => {
    const u = new URL(route.request().url());
    const rel = decodeURIComponent(u.pathname.replace(/^\/extensions\/[^/]+\//, ""));
    const f = path.join(JS_DIR, rel);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f);
      const type = ext === ".css" ? "text/css" : ext === ".json" ? "application/json"
        : ext === ".woff2" ? "font/woff2" : /\.m?js$/.test(ext) ? "text/javascript" : undefined;
      return route.fulfill({ path: f, contentType: type });
    }
    return route.continue();
  });
}

await context.addInitScript(() => {
  const w = window;
  const st = (w.__perf = { intervals: new Map(), longtasks: [], mo: 0, ro: 0, loadedAt: null });
  const si = w.setInterval.bind(w);
  const ci = w.clearInterval.bind(w);
  w.setInterval = function (fn, ms, ...a) {
    const stack = (new Error().stack ?? "").split("\n").slice(2, 5).map((s) => s.trim()).join(" | ");
    let id = 0;
    const wrapped = function (...x) {
      const t = performance.now();
      try { return typeof fn === "function" ? fn.apply(this, x) : undefined; } finally {
        const rec = st.intervals.get(id);
        if (rec) { rec.ms += performance.now() - t; rec.calls++; }
      }
    };
    id = si(wrapped, ms, ...a);
    st.intervals.set(id, { ms: 0, calls: 0, period: ms, stack });
    return id;
  };
  w.clearInterval = function (id) { st.intervals.delete(id); return ci(id); };
  const MO = w.MutationObserver;
  w.MutationObserver = class extends MO { constructor(cb) { super(cb); st.mo++; } };
  const RO = w.ResizeObserver;
  if (RO) w.ResizeObserver = class extends RO { constructor(cb) { super(cb); st.ro++; } };
  const info = console.info.bind(console);
  console.info = (...a) => {
    if (String(a[0]).includes("[wildcard-pipeline] extension loaded")) st.loadedAt = performance.now();
    return info(...a);
  };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longtasks.push({ start: e.startTime, dur: e.duration }); })
      .observe({ type: "longtask", buffered: true });
  } catch { /* unsupported */ }
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });

async function metrics() {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}
async function perfState() {
  return page.evaluate((OUR) => {
    const st = window.__perf;
    const ours = [...st.intervals.values()].filter((r) => r.stack.includes(OUR));
    return {
      intervalsOurs: ours.length,
      oursMs: ours.reduce((s, r) => s + r.ms, 0),
      mo: st.mo, ro: st.ro,
      longtasks: st.longtasks.length,
      longtaskMs: st.longtasks.reduce((s, l) => s + l.dur, 0),
      domNodes: document.getElementsByTagName("*").length,
    };
  }, OUR);
}
/** Sampled CPU profile of `fn`: busy time, time with one of our frames on the
 *  stack, and our top functions (self and inclusive). */
async function profile(fn) {
  await cdp.send("Profiler.start");
  await fn();
  const { profile: p } = await cdp.send("Profiler.stop");
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const label = (cn) => `${cn.callFrame.functionName || "(anon)"} ${cn.callFrame.url.split("/").pop()}:${cn.callFrame.lineNumber + 1}`;
  let total = 0, idle = 0, oursIncl = 0;
  const topSelf = {}, topIncl = {};
  for (let i = 0; i < p.samples.length; i++) {
    const dt = (p.timeDeltas[i] ?? 0) / 1000;
    const n = byId.get(p.samples[i]);
    total += dt;
    if (n.callFrame.functionName === "(idle)") { idle += dt; continue; }
    if (n.callFrame.url.includes(OUR)) topSelf[label(n)] = (topSelf[label(n)] ?? 0) + dt;
    const seen = new Set();
    let any = false;
    for (let cur = n.id; cur != null; cur = parent.get(cur)) {
      const cn = byId.get(cur);
      if (!cn.callFrame.url.includes(OUR)) continue;
      any = true;
      const l = label(cn);
      if (!seen.has(l)) { seen.add(l); topIncl[l] = (topIncl[l] ?? 0) + dt; }
    }
    if (any) oursIncl += dt;
  }
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, v]) => `${v.toFixed(1)}ms ${l}`);
  return { wallMs: Math.round(total), busyMs: Math.round(total - idle), oursInclMs: Math.round(oursIncl), topSelf: top(topSelf, 10), topIncl: top(topIncl, 15) };
}
async function heapMB() {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(300);
  await cdp.send("HeapProfiler.collectGarbage");
  return +((await metrics()).JSHeapUsedSize / 1048576).toFixed(1);
}
async function idleWindow(label, active) {
  const m0 = await metrics();
  const s0 = await perfState();
  let stop = false;
  // "active": a Shift keydown every 0.7 s marks user activity (keeps every
  // adaptive poll at its base rate, as during editing) and changes nothing.
  const keys = active ? (async () => {
    while (!stop) {
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true })));
      await page.waitForTimeout(700);
    }
  })() : null;
  const prof = await profile(() => page.waitForTimeout(IDLE_S * 1000));
  stop = true;
  await keys;
  const m1 = await metrics();
  const s1 = await perfState();
  const per = (k) => +(((m1[k] - m0[k]) * 1000) / IDLE_S).toFixed(1);
  const r = {
    label,
    scriptMsPerS: per("ScriptDuration"),
    taskMsPerS: per("TaskDuration"),
    layoutMsPerS: per("LayoutDuration"),
    oursMsPerS: +(prof.oursInclMs / IDLE_S).toFixed(1),
    intervalsOurs: s1.intervalsOurs,
    ourIntervalMsPerS: +((s1.oursMs - s0.oursMs) / IDLE_S).toFixed(2),
    longtasks: s1.longtasks - s0.longtasks,
    profile: prof,
  };
  log(`  [${label}] script ${r.scriptMsPerS} ms/s, ours ${r.oursMsPerS} ms/s, layout ${r.layoutMsPerS} ms/s, our intervals ${r.intervalsOurs} (${r.ourIntervalMsPerS} ms/s), longtasks ${r.longtasks}`);
  return r;
}
/** Wait until no long task for 1.5 s. */
async function settle(maxMs = 20000) {
  const t0 = Date.now();
  let last = -1, since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const c = await page.evaluate(() => window.__perf.longtasks.length);
    if (c !== last) { last = c; since = Date.now(); }
    if (Date.now() - since > 1500) break;
    await page.waitForTimeout(250);
  }
}
async function pan(label) {
  const r = await page.evaluate(async (ms) => {
    const c = window.app.canvas;
    const ds = c.ds;
    const ox = ds.offset[0], oy = ds.offset[1];
    const frames = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((res) => {
      const step = (now) => {
        frames.push(now - last); last = now;
        const t = (now - t0) / 1000;
        ds.offset[0] = ox + Math.sin(t * 2) * 600;
        ds.offset[1] = oy + Math.cos(t * 2) * 300;
        c.setDirty(true, true);
        if (now - t0 < ms) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    ds.offset[0] = ox; ds.offset[1] = oy; c.setDirty(true, true);
    frames.shift();
    const s = [...frames].sort((a, b) => a - b);
    const q = (x) => +s[Math.floor(x * (s.length - 1))].toFixed(1);
    return { fps: +(frames.length / (ms / 1000)).toFixed(1), p50: q(0.5), p95: q(0.95), max: q(1), over33: frames.filter((f) => f > 33).length };
  }, 4000);
  log(`  [${label}] pan ${JSON.stringify(r)}`);
  return r;
}
async function loadGraph(json) {
  await page.evaluate(async (wf) => { await window.app.loadGraphData(wf, true, false); }, json);
}
async function clearGraph() {
  await page.evaluate(() => { window.app.graph.clear(); window.app.canvas.setDirty(true, true); });
}

// ── startup ──────────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "load" });
await page.waitForFunction(() => window.__perf?.loadedAt != null && window.app?.graph && window.app?.canvas, null, { timeout: 60000 });
await settle();
report.startup = await page.evaluate((OUR) => {
  const res = performance.getEntriesByType("resource").filter((r) => r.name.includes(OUR));
  return {
    extensionLoadedAtMs: Math.round(window.__perf.loadedAt),
    ourRequests: res.map((r) => ({ name: r.name.replace(/.*\/extensions\/[^/]+\//, ""), start: Math.round(r.startTime), dur: Math.round(r.duration), kb: +(r.decodedBodySize / 1024).toFixed(1) })),
  };
}, OUR);
log("startup", JSON.stringify({ loadedAt: report.startup.extensionLoadedAtMs, requests: report.startup.ourRequests.map((r) => `${r.name}@${r.start}+${r.dur}`) }));
if (RENDER) {
  await page.evaluate(async (vue) => { await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", vue); }, RENDER === "vue");
  await page.waitForTimeout(1500);
}
report.vueNodes = await page.evaluate(() => window.app.extensionManager?.setting?.get?.("Comfy.VueNodes.Enabled") ?? null);

// ── empty canvas ─────────────────────────────────────────────────────────
await clearGraph();
await settle();
report.empty = { heapMB: await heapMB(), idle: await idleWindow("empty-active", true) };
report.empty.pan = await pan("empty");

for (const wf of workflows) {
  log(`\n== ${wf.name} (${wf.json.nodes.length} nodes)`);
  const run = { workflow: wf.name, nodes: wf.json.nodes.length };
  const before = await perfState();
  const t0 = Date.now();
  await loadGraph(wf.json);
  const callMs = Date.now() - t0;
  await settle();
  const after = await perfState();
  const maxTask = await page.evaluate((n) => Math.max(0, ...window.__perf.longtasks.slice(n).map((l) => l.dur)), before.longtasks);
  run.load = { callMs, longtasks: after.longtasks - before.longtasks, longtaskMs: Math.round(after.longtaskMs - before.longtaskMs), maxTaskMs: Math.round(maxTask) };
  log("  load", JSON.stringify(run.load));
  run.state = { mo: after.mo, ro: after.ro, domNodes: after.domNodes };
  run.heapMB = await heapMB();
  run.idleActive = await idleWindow("idle-active", true);
  if (STILL) {
    await page.waitForTimeout(14000); // let the adaptive back-off reach its slowest step
    run.idleStill = await idleWindow("idle-still", false);
  }
  run.pan = await pan("wf");
  await clearGraph();
  await settle();
  run.afterClearHeapMB = await heapMB();
  log("  heap loaded", run.heapMB, "MB, after clear", run.afterClearHeapMB, "MB");
  report.runs.push(run);
}

if (workflows[0] && process.env.LEAK_LOOPS) {
  const heaps = [];
  for (let i = 0; i < Number(process.env.LEAK_LOOPS); i++) {
    await loadGraph(workflows[0].json);
    await settle();
    await clearGraph();
    await settle();
    heaps.push(await heapMB());
  }
  const growth = heaps.length > 1 ? +((heaps[heaps.length - 1] - heaps[0]) / (heaps.length - 1)).toFixed(1) : null;
  report.leak = { heaps, growthPerCycleMB: growth };
  log("leak heaps", heaps.join(", "), "MB; growth/cycle", growth, "MB");
}
if (process.env.SNAPSHOT) {
  const out = fs.createWriteStream(process.env.SNAPSHOT);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", (e) => out.write(e.chunk));
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  out.end();
  log("heap snapshot", process.env.SNAPSHOT);
}
report.errors = errors.slice(0, 20);
const outFile = process.env.OUT ?? ".tmp/perf/canvas-report.json";
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
log("wrote", outFile, "page errors:", errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
