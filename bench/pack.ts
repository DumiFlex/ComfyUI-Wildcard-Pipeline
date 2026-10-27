// The AI bench as a Watchwright pack: the tests on the bench page, clicked through the
// way a person would, against a running ComfyUI with the AI assistant set up. See README.md.
import path from "node:path";
import { pack, StepError, type Collector, type Helpers } from "watchwright";
import { benchHelpers, trackerFor } from "./bench.js";
import { MODELS } from "./meta.js";

interface DebugRow {
  id: string;
  route?: string;
  label?: string;
  started?: string;
  seconds?: number;
  status?: string;
  error?: string | null;
  calls?: number;
  failed?: number;
  tokens?: unknown;
}

/** Reads one of the app's API routes from the page (same origin, so the AI guard lets it through). */
async function fetchText(page: Helpers["page"], url: string): Promise<{ status: number; text: string }> {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, text: await r.text() };
  }, url);
}

async function debugRows(page: Helpers["page"]): Promise<DebugRow[]> {
  const r = await fetchText(page, "/wp/api/ai/debug").catch(() => null);
  if (!r || r.status >= 400) return [];
  const json = JSON.parse(r.text) as { records?: DebugRow[] };
  return json.records ?? [];
}

// Debug records already saved with an attempt, so a parent doesn't save its child's again.
const savedDebugs = new Set<string>();
const debugBefore = new Map<string, Set<string>>();

/**
 * The AI debug log (turned on for the bench's browser): every AI call an attempt made, saved with
 * it as Markdown and JSON, with the number of calls and their seconds as metrics.
 */
const aiDebug: Collector = {
  name: "ai-debug",
  attach(context) {
    trackerFor(context);
  },
  async beginAttempt(a) {
    debugBefore.set(a.attemptId, new Set((await debugRows(a.page)).map((x) => x.id)));
  },
  async endAttempt(a) {
    const before = debugBefore.get(a.attemptId) ?? new Set<string>();
    debugBefore.delete(a.attemptId);
    const rows = (await debugRows(a.page)).filter((x) => !before.has(x.id) && !savedDebugs.has(x.id));
    rows.sort((x, y) => String(x.started).localeCompare(String(y.started)));
    let seconds = 0;
    for (const [i, row] of rows.entries()) {
      savedDebugs.add(row.id);
      const n = String(i + 1).padStart(2, "0");
      const slug = String(row.label ?? row.route ?? "ai")
        .replace(/[^a-z0-9]+/gi, "-")
        .slice(0, 40);
      const md = await fetchText(a.page, `/wp/api/ai/debug/${row.id}?format=md`);
      const json = await fetchText(a.page, `/wp/api/ai/debug/${row.id}`);
      a.file(`debug-${n}-${slug}.md`, md.text, "text/markdown");
      a.file(`debug-${n}-${slug}.json`, json.text, "application/json");
      a.record({ file: `debug-${n}-${slug}.md`, route: row.route, label: row.label, seconds: row.seconds, status: row.status, error: row.error, calls: row.calls, failed: row.failed, tokens: row.tokens });
      seconds += row.seconds ?? 0;
    }
    a.metric("AI calls", rows.length);
    a.metric("AI s", Math.round(seconds), "s");
  },
};

/** Errors the manager wrote to the browser console. */
const consoleErrors: Collector = {
  name: "console-errors",
  attach(context, record) {
    const watch = (page: Helpers["page"]) =>
      page.on("console", (m) => {
        if (m.type() === "error") record({ text: m.text().slice(0, 2000), url: page.url() });
      });
    context.pages().forEach(watch);
    context.on("page", watch);
  },
};

/** Requests to the manager's API that failed or were refused (404s aside: lookups miss on purpose). */
const failedRequests: Collector = {
  name: "failed-requests",
  attach(context, record) {
    context.on("requestfailed", (r) => {
      if (r.url().includes("/wp/api/")) record({ url: r.url(), method: r.method(), failure: r.failure()?.errorText ?? null });
    });
    context.on("response", (r) => {
      if (!r.url().includes("/wp/api/") || r.status() < 400 || r.status() === 404) return;
      const entry = { url: r.url(), method: r.request().method(), status: r.status() };
      void r.text().then(
        (text) => record({ ...entry, answer: text.slice(0, 500) }),
        () => record(entry),
      );
    });
  },
};

/** Empties the library (after a backup) and imports bench-library.json through the Import page. */
async function resetLibrary(h: Helpers, packDir: string): Promise<void> {
  const backup = await h.api("/wp/api/database/backups", { method: "POST", body: {} });
  if (backup.status >= 300) throw new StepError(`The backup failed (${backup.status}): ${backup.text.slice(0, 200)}`);
  h.log(`Backed up the library first: ${backup.json?.name ?? "done"}.`);
  const lib = await h.library();
  for (const x of lib.bundles) await h.api(`/wp/api/bundles/${x.id}`, { method: "DELETE" });
  for (const x of lib.templates) await h.api(`/wp/api/templates/${x.id}`, { method: "DELETE" });
  for (const type of ["constraint", "derivation", "combine", "fixed_values", "wildcard"])
    for (const x of lib.modules.filter((m) => m.type === type)) await h.api(`/wp/api/modules/${x.id}`, { method: "DELETE" });
  const cats = await h.api("/wp/api/categories");
  const catList = (cats.json?.items ?? cats.json ?? []) as { id: string }[];
  for (const c of catList) await h.api(`/wp/api/categories/${c.id}`, { method: "DELETE" });
  h.log("Emptied the library; importing the bench library.");
  await h.visit("import-export");
  await h.tap("io-tab-import");
  await h.page.setInputFiles('[data-test="import-file-input"]', path.join(packDir, "bench-library.json"));
  await h.wait(2500);
  await h.tap("import-preset-all");
  await h.tap("import-picker-continue");
  await h.wait(2500);
  await h.tapOn(h.page.locator('[data-test*="commit"], button:has-text("Import")').last(), "import-commit");
  await h.wait(3000);
  const after = await h.library();
  h.log(`Imported: ${after.modules.length} modules, ${after.bundles.length} bundle(s), ${after.templates.length} template(s).`);
  if (after.modules.length < 20) throw new StepError("The bench library didn't import (fewer than 20 modules).");
}

// The backup taken before a test that changes the library for good (see beforeAttempt).
let lastBackup: string | null = null;

export default pack({
  name: "Wildcard Pipeline AI bench",
  description: "The AI assistant's bench: wildcards, fixed values, combines, derivations, constraints, templates, bundles, library tidying, chat and the pack builder, run against one model.",
  site: { key: "wildcard-pipeline", baseURL: "http://127.0.0.1:8189/wp/" },
  browser: {
    // Firefox, like the bench's own runs; WP_BENCH_BROWSER=chromium for a machine without it.
    name: process.env.WP_BENCH_BROWSER === "chromium" ? "chromium" : "firefox",
    viewport: { width: 1600, height: 960 },
    context: { colorScheme: "dark" },
  },
  params: {
    model: {
      choices: MODELS.map((m) => m.key),
      default: "q9",
      labels: Object.fromEntries(MODELS.map((m) => [m.key, m.name])),
      description: "The model set up in Settings › AI assistant. It picks how many attempts each test gets (and the Fable subset).",
    },
    reset: { type: "boolean", default: false, description: "Back up the database, empty the library and import bench-library.json before the first test." },
    web: { type: "boolean", default: false, description: "Include the optional web tests (N1 to N5); they need web search set up." },
  },
  flags: {
    "not-saved": "robot",
    "no-card": "robot",
    "model-loop": "finding",
    "deleted-while-off": "finding",
    "build-blocked": "finding",
    "not-installed": "finding",
    "problem-fix-did-nothing": "finding",
    "fix-changed-nothing": "finding",
    "dismissed-findings": "info",
    "research-skipped": "info",
    "forced-click": "info",
  },
  rubric: [
    { id: "correct", title: "Correct", description: "Does the answer work in the app: valid items, right variables, nothing broken?", scale: 5 },
    { id: "follows", title: "Follows", description: "Does it do what the prompt asked, and only that?", scale: 5 },
    { id: "quality", title: "Quality", description: "Would you keep it: good options, sensible weights, readable text?", scale: 5 },
    { id: "ui", title: "UI problems", description: "Anything wrong on screen while it ran.", choices: ["none", "minor", "major"] },
  ],
  run: { chapters: true },
  helpers: benchHelpers,
  idle: (page) =>
    page.evaluate(() => {
      const shown = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight || e.getClientRects().length);
      return ![...document.querySelectorAll(".wp-aiw, [aria-busy='true'], [data-test='ai-chat-live'], [data-test='ai-loading']")].some(shown);
    }),
  collectors: [aiDebug, consoleErrors, failedRequests],

  async setup({ h, context, params, packDir, info }) {
    // The AI debug log is a browser setting; the bench reads it after every attempt.
    await context.addInitScript(() => {
      try {
        localStorage.setItem("wp-ai-debug", "1");
      } catch {
        /* private mode */
      }
    });
    context.on("page", (p) => p.on("dialog", (d) => void d.accept().catch(() => undefined)));
    h.page.on("dialog", (d) => void d.accept().catch(() => undefined));
    await h.visit("wildcards");
    const cfg = await h.aiConfig();
    info("AI model", `${String(cfg.provider ?? "?")} · ${String(cfg.model ?? "?")}`);
    if (!cfg.enabled) throw new StepError("The AI assistant is off in Settings.");
    if (params.reset === true) await resetLibrary(h, packDir);
    // W22 checks the chat can't delete while this is off; W23 and Z16 turn it on for themselves.
    await h.setAiConfig({ allow_delete: false, auto_apply: false });
    // The first AI call loads the model, which would land in the first test's time: test the
    // connection twice first (the first loads it, the second shows it answers warm).
    for (let i = 1; i <= 2; i++) {
      const started = Date.now();
      const r = await h.api("/wp/api/ai/test", { method: "POST" });
      const d = (r.json?.data ?? r.json ?? {}) as { json_ok?: boolean; error?: string };
      h.log(`Warm-up ${i}: ${((Date.now() - started) / 1000).toFixed(1)} s, ${d.json_ok ? "answered" : `failed (${r.status} ${String(d.error ?? r.text).slice(0, 120)})`}.`);
      if (i === 2 && !d.json_ok) throw new StepError("The AI connection test failed twice: check the model in Settings › AI assistant.");
    }
  },

  // A test tagged changes-library deletes or changes items for good. Take a backup first, and keep
  // it only when the attempt didn't pass, so a person can look at (or restore) the library it saw.
  async beforeAttempt({ h, test }) {
    if (!test.tags.includes("changes-library")) return;
    const r = await h.api("/wp/api/database/backups", { method: "POST", body: {} });
    lastBackup = r.status < 300 ? ((r.json?.name as string | undefined) ?? null) : null;
    if (!lastBackup) h.log(`Couldn't back up the library first (${r.status}).`);
  },
  async afterAttempt({ h, test, outcome }) {
    if (!test.tags.includes("changes-library") || !lastBackup) return;
    const name = lastBackup;
    lastBackup = null;
    if (outcome === "passed") await h.api(`/wp/api/database/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
    else h.note(`The library before this attempt is kept as backup ${name} (Settings › Database).`);
  },
});
