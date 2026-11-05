// The AI bench as a Watchwright pack: the tests on the bench page, clicked through the
// way a person would, against a running ComfyUI with the AI assistant set up. See README.md.
import path from "node:path";
import { pack, StepError } from "watchwright";
import { benchHelpers, fakeModel } from "./bench.js";
import { aiDebug, consoleErrors, failedRequests } from "./shared.js";
import { backup, deleteBackup, lifecycleAfterTask, lifecycleSetup, lifecycleTasks, lifecycleTeardown, NOTE, setPinned } from "./lifecycle.js";
import { MODELS } from "./meta.js";

// The backup taken before a test that changes the library for good (see beforeAttempt).
let lastBackup: string | null = null;
const fixture = (packDir: string) => path.join(packDir, "bench-library.json");

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
    reset: { type: "boolean", default: false, description: "Load the bench library (bench-library.json) before the first test. Your library is backed up first either way." },
    putBack: { type: "boolean", default: true, description: "Put your library and AI settings back when the run ends (a stopped run keeps its library for a resume). Off leaves the run's library in place." },
    web: { type: "boolean", default: false, description: "Include the optional web tests (N1 to N5); they need web search set up." },
  },
  flags: {
    "not-saved": "robot",
    "no-card": "robot",
    "model-loop": "finding",
    "deleted-while-off": "finding",
    "build-blocked": "finding",
    "not-installed": "finding",
    "unusable-answer": "finding",
    "problem-fix-did-nothing": "finding",
    "fix-changed-nothing": "finding",
    "dismissed-findings": "info",
    "research-skipped": "info",
    "forced-click": "info",
    "fake-answer": "info",
    "fix-is-plan-change": "info",
  },
  rubric: [
    { id: "correct", title: "Correct", description: "Does the answer work in the app: valid items, right variables, nothing broken?", scale: 5 },
    { id: "follows", title: "Follows", description: "Does it do what the prompt asked, and only that?", scale: 5 },
    { id: "quality", title: "Quality", description: "Would you keep it: good options, sensible weights, readable text?", scale: 5 },
    { id: "ui", title: "UI problems", description: "Anything wrong on screen while it ran.", choices: ["none", "minor", "major"] },
  ],
  // Video only for attempts that fail or break: a run with video on every attempt was 1.1 GB.
  run: { chapters: true, video: "problems" },
  dashboard: {
    filters: ["model"],
    groups: [
      {
        title: "Overview",
        tiles: [{ latest: true }, { outcome: true, width: 2 }, { stat: "passrate", title: "Pass rate" }, { duration: true, width: 2 }, { flags: true, kind: "finding", title: "Findings", width: 2 }],
      },
      {
        title: "Models",
        tiles: [
          { leaderboard: "model", width: 4, columns: ["passrate", "score.correct", "score.follows", "score.quality", "metric.AI s", "flags.finding", "runs"] },
          { scatter: "model", title: "AI time vs quality", x: "metric.AI s", y: "score.quality", width: 2 },
          { metric: "AI calls", of: "median", width: 2 },
        ],
      },
      {
        title: "Sections",
        tiles: [
          { breakdown: "section", measure: "passrate", split: "model", title: "Pass rate by section", width: 2 },
          { breakdown: "section", measure: "score.quality", split: "model", title: "Quality by section", width: 2 },
        ],
      },
      {
        title: "Pack builder",
        tiles: [
          { metric: "Plan s", section: "Pack builder", of: "median" },
          { metric: "Build s", section: "Pack builder", of: "median" },
          { metric: "Fix s", section: "Pack builder", of: "median" },
          { stat: "flags.problem-fix-did-nothing", section: "Pack builder", title: "Fix did nothing", of: "sum" },
        ],
      },
      {
        title: "To look at",
        tiles: [
          { unreviewed: true, width: 2 },
          { lowest: "quality", title: "Lowest quality", width: 2 },
          { lowest: "metric.AI s", title: "Slowest AI", width: 2 },
          { failures: true, width: 2 },
          { flaky: true, width: 2 },
          { links: [{ compare: "last", label: "Compare with the last run" }], width: 2 },
        ],
      },
    ],
  },
  helpers: benchHelpers,
  idle: (page) =>
    page.evaluate(() => {
      const shown = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight || e.getClientRects().length);
      return ![...document.querySelectorAll(".wp-aiw, [aria-busy='true'], [data-test='ai-chat-live'], [data-test='ai-loading']")].some(shown);
    }),
  collectors: [aiDebug, consoleErrors, failedRequests],

  async setup(ctx) {
    const { h, context, params, info } = ctx;
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
    const fake = await h.api("/fake/script").catch(() => null);
    fakeModel.on = fake?.status === 200;
    if (fakeModel.on) info("Fake model", "bench/dev/serve.py: nothing to apply flags fake-answer, not a robot flag");
    if (!cfg.enabled) throw new StepError("The AI assistant is off in Settings.");
    // Your library and AI settings saved (put back by teardown), then the bench library when reset is on.
    await lifecycleSetup(ctx, { fixture });
    // W22 checks the chat can't delete while this is off; the delete tests turn it on for themselves.
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

  teardown: lifecycleTeardown,
  afterTask: lifecycleAfterTask,
  tasks: lifecycleTasks(fixture),

  // A test tagged changes-library deletes or changes items for good. Take a backup first, and keep
  // it (pinned, so later backups don't prune it) only when the attempt didn't pass, so a person can
  // look at (or restore) the library it saw. The pack's Clean up task deletes the kept ones.
  async beforeAttempt({ h, state, test, attempt }) {
    if (!test.tags.includes("changes-library")) return;
    lastBackup = await backup(h, state, `${NOTE}: before ${test.id} #${attempt}`).catch((e: unknown) => {
      h.log(`Couldn't back up the library first: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
  },
  async afterAttempt({ h, test, outcome }) {
    if (!test.tags.includes("changes-library") || !lastBackup) return;
    const name = lastBackup;
    lastBackup = null;
    if (outcome === "passed") await deleteBackup(h, name);
    else {
      await setPinned(h, name, true);
      h.note(`The library before this attempt is kept as backup ${name}, pinned (Settings › Library › Backups).`);
    }
  },
});
