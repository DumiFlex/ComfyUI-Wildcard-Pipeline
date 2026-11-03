// The library safety pack: backups, pins, pruning, live restore with Undo, and the Library health
// page, clicked through the way a person would. No AI. It runs on the fake server
// (bench/dev/serve.py) or a real ComfyUI: every test puts back what it changed, and the pack's
// teardown puts your library back on top of that. See README.md.
import path from "node:path";
import { pack } from "watchwright";
import { benchHelpers } from "../bench.js";
import { consoleErrors, failedRequests } from "../shared.js";
import { lifecycleAfterTask, lifecycleSetup, lifecycleTasks, lifecycleTeardown } from "../lifecycle.js";
import { fakeUp } from "../smoke/smoke.js";

const fixture = (packDir: string) => path.join(packDir, "..", "bench-library.json");

export default pack({
  name: "Wildcard Pipeline library safety",
  description: "Backups with notes, pins, pruning that keeps pins, live restore from Settings › Library with the toast's Undo, a refused restore, and the Library health page.",
  // The bench's site key, so this never runs while a bench or smoke run changes the library.
  site: { key: "wildcard-pipeline", baseURL: "http://127.0.0.1:8189/wp/" },
  browser: {
    name: process.env.WP_BENCH_BROWSER === "firefox" ? "firefox" : "chromium",
    viewport: { width: 1600, height: 960 },
    context: { colorScheme: "dark" },
  },
  params: {
    reset: {
      type: "boolean",
      default: false,
      description: "Load the bench library first (fake server only: on a real ComfyUI it refuses). Off, the tests run on the library as it is.",
    },
    putBack: { type: "boolean", default: true, description: "Put the library back when the run ends." },
  },
  flags: {
    "check-failed": "finding",
    "not-saved": "robot",
    "forced-click": "info",
  },
  run: { chapters: true, pauseLimitMinutes: 5, testTimeout: 5 * 60_000, video: "problems" },
  dashboard: {
    tiles: [{ latest: true }, { outcome: true, width: 2 }, { duration: true }, { matrix: true, width: 4 }, { failures: true, width: 2 }, { flaky: true, width: 2 }],
  },
  helpers: benchHelpers,
  collectors: [consoleErrors, failedRequests],

  async setup(ctx) {
    const { h, context } = ctx;
    context.on("page", (p) => p.on("dialog", (d) => void d.accept().catch(() => undefined)));
    h.page.on("dialog", (d) => void d.accept().catch(() => undefined));
    await h.visit("wildcards");
    await lifecycleSetup(ctx, { fixture, canReset: fakeUp });
  },
  teardown: lifecycleTeardown,
  afterTask: lifecycleAfterTask,
  tasks: lifecycleTasks(fixture),
});
