// What the bench and the smoke pack share: the collectors every attempt keeps, and the library
// reset. See README.md and smoke/README.md.
import { StepError, type Collector, type Helpers } from "watchwright";
import { trackerFor } from "./bench.js";

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
export const aiDebug: Collector = {
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
export const consoleErrors: Collector = {
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
export const failedRequests: Collector = {
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

/** Empties the library (after a backup) and imports `fixture` (a library export) through the Import page. */
export async function resetLibrary(h: Helpers, fixture: string): Promise<void> {
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
  await h.page.setInputFiles('[data-test="import-file-input"]', fixture);
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
