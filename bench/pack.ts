// The AI bench as a Watchwright pack: the tests on the bench page, clicked through the
// way a person would, against a running ComfyUI with the AI assistant set up. See README.md.
import path from "node:path";
import { pack, StepError } from "watchwright";
import { benchHelpers } from "./bench.js";
import { aiDebug, consoleErrors, failedRequests, resetLibrary } from "./shared.js";
import { MODELS } from "./meta.js";

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
    if (params.reset === true) await resetLibrary(h, path.join(packDir, "bench-library.json"));
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
