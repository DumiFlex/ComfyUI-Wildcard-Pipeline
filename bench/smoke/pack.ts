// The AI smoke pack: every AI entry point of the manager once, checked pass or fail, in a few
// minutes. On the fake model (bench/dev/serve.py) chat tests script the model's exact answer and
// check the card, Apply and Undo it leads to; on a real model the unscripted tests still run.
// See README.md.
import path from "node:path";
import { pack, StepError } from "watchwright";
import { benchHelpers } from "../bench.js";
import { aiDebug, consoleErrors, failedRequests, resetLibrary } from "../shared.js";
import { clearScript, fakeQueue, fakeUp } from "./smoke.js";

export default pack({
  name: "Wildcard Pipeline AI smoke",
  description: "Every AI flow of the manager once, pass or fail: editor panels, chat cards with Apply and Undo, deleting, questions, mentions, the pack builder and the safety guard.",
  // The same site key as the bench, so a smoke run and a bench run never change the library at once.
  site: { key: "wildcard-pipeline", baseURL: "http://127.0.0.1:8189/wp/" },
  browser: {
    name: process.env.WP_BENCH_BROWSER === "firefox" ? "firefox" : "chromium",
    viewport: { width: 1600, height: 960 },
    context: { colorScheme: "dark" },
  },
  params: {
    fake: {
      type: "boolean",
      default: true,
      description: "The manager is bench/dev/serve.py: chat tests script the fake model's answers. Off, scripted tests skip and the rest run on the model in Settings › AI assistant.",
    },
    reset: {
      type: "boolean",
      default: true,
      description: "Import bench-library.json into an emptied library before the first test (after a backup). Only on the fake server: on a real ComfyUI it refuses, so turn it off there.",
    },
    format: {
      choices: ["auto", "native", "json"],
      default: "auto",
      labels: { auto: "Auto", native: "Native tool calls", json: "JSON steps" },
      description: "How the chat talks to the model (Settings › AI assistant › Advanced › Tool format). Run the chat tests once with each.",
    },
  },
  flags: {
    // The bench helpers raise these.
    "not-saved": "robot",
    "no-card": "finding",
    "model-loop": "finding",
    "forced-click": "info",
    // The smoke checks.
    "ai-error": "finding",
    "no-answer": "finding",
    "wrong-card": "finding",
    "apply-did-nothing": "finding",
    "undo-left-changes": "finding",
    "deleted-while-off": "finding",
    "guard-missed": "finding",
    "script-left-over": "info",
  },
  run: { chapters: true, pauseLimitMinutes: 5, testTimeout: 10 * 60_000 },
  helpers: benchHelpers,
  idle: (page) =>
    page.evaluate(() => {
      const shown = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight || e.getClientRects().length);
      return ![...document.querySelectorAll(".wp-aiw, [aria-busy='true'], [data-test='ai-chat-live'], [data-test='ai-loading']")].some(shown);
    }),
  collectors: [aiDebug, consoleErrors, failedRequests],

  async setup({ h, context, params, packDir, info }) {
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
    if (!cfg.enabled) throw new StepError("The AI assistant is off in Settings.");
    const fake = await fakeUp(h);
    info("AI model", fake ? "fake (bench/dev/serve.py)" : `${String(cfg.provider ?? "?")} · ${String(cfg.model ?? "?")}`);
    if (params.fake === true && !fake) throw new StepError("fake is on, but the manager isn't bench/dev/serve.py (no /fake/script). Start it, or turn fake off for a real model.");
    if (params.reset === true) {
      if (!fake) throw new StepError("reset would empty a real library. Turn reset off on a real ComfyUI.");
      await resetLibrary(h, path.join(packDir, "..", "bench-library.json"));
    }
    await h.setAiConfig({ allow_delete: false, auto_apply: false, tool_format: params.format });
    info("Tool format", String(params.format));
  },

  async beforeAttempt({ h, params }) {
    if (params.fake === true) await clearScript(h);
  },
  // A scripted answer nobody asked for means the app called the model fewer times than the test
  // expected: worth a look even when the checks passed.
  async afterAttempt({ h, params }) {
    if (params.fake !== true) return;
    const left = await fakeQueue(h);
    if (left.length) h.flag("script-left-over", `${left.length} scripted answer(s) were never asked for.`);
  },
});
