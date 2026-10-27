// The shapes most bench tests share: make an item with an editor's AI panel, describe one, edit
// one, one chat turn, Organize with AI, and the pack builder. Each returns a test body; `bench()`
// declares a test from meta.json with one of them.
import { existsSync } from "node:fs";
import path from "node:path";
import { test, StepError, type Helpers, type TestContext, type TestMeta } from "watchwright";
import { ModelLoop, PANEL, sel, type ItemKind } from "./bench.js";
import { prompt, testMeta } from "./meta.js";

/** What a bench test body gets: Watchwright's context plus its id and its prompt. */
export interface BenchContext extends TestContext {
  id: string;
  /** The prompt a person types for this test (from meta.json). */
  P: string;
}

export type BenchBody = (t: BenchContext) => Promise<void>;

/** Declares a bench test: its metadata from meta.json, its body from a shape or its own steps. */
export function bench(id: string, body: BenchBody, extra: Partial<TestMeta> = {}): void {
  test(id, testMeta(id, extra), async (ctx) => {
    try {
      await body({ ...ctx, id, P: prompt(id) });
    } catch (err) {
      // The model stopped making progress: `aiIdle` raised the `model-loop` finding and took a
      // shot, so the attempt ends failed (a finding), not broken.
      if (err instanceof ModelLoop) return;
      throw err;
    }
  });
}

/** A reference image next to the pack (`images/sfw.png`, …), or the attempt skips itself. */
export function image(t: BenchContext, kind: "sfw" | "nsfw"): string {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const file = path.join(t.packDir, "images", kind + ext);
    if (existsSync(file)) return file;
  }
  return t.h.skip(`No ${kind.toUpperCase()} reference image: put one at bench/images/${kind}.png (see images/README.md).`);
}

const sfw = (t: BenchContext) => [image(t, "sfw")];
const nsfwImage = (t: BenchContext) => [image(t, "nsfw")];
export { sfw, nsfwImage };

// ---- editors ------------------------------------------------------------------------------------

export interface MakeOptions {
  mode?: string;
  name: string;
  varName?: string;
  setup?: (h: Helpers) => Promise<void>;
  apply?: string;
  nsfw?: boolean;
}

/** A new item from an editor's AI panel; on the last attempt it is applied and saved. */
export function make(route: string, button: string, { mode, name, varName, setup, apply = "ai-apply", nsfw = false }: MakeOptions): BenchBody {
  return async (t) => {
    const { h } = t;
    await h.step("open the editor", async () => {
      await h.visit(`${route}/new`);
      if (nsfw) await h.nsfw();
      if (setup) await setup(h);
    });
    await h.step("ask", () => h.panel(button, { ...(mode ? { mode } : {}), prompt: t.P }));
    await h.step("keep the answer", async () => {
      await h.keep("answer", PANEL);
      await h.panelShot("answer");
    });
    if (button === "cn-ai") await h.step("show the constraint", () => constraintShots(h));
    if (!t.last) return;
    await h.step("save", async () => {
      if (button !== "cn-ai") {
        if (!(await h.shows(apply, 5000))) {
          h.flag("not-saved", `Nothing to apply, so ${name} wasn't saved (later tests that use it will fail).`);
          return;
        }
        await h.tap(apply);
      }
      if (varName) await h.setVar(varName);
      await h.setName(name);
      await h.shot("before-save");
      await h.saveItem();
      h.log(`Saved as ${name}.`);
    });
  };
}

/**
 * A constraint answer lives in three places (rule matrix, exceptions, preview). Applies it to the
 * editor (nothing is saved here), then shoots the editor top to bottom, every tab and the preview.
 */
export async function constraintShots(h: Helpers): Promise<void> {
  if (await h.shows("ai-apply")) {
    await h.tap("ai-apply");
    await h.wait(1200);
    h.log("Applied to the editor (not saved) to show the grid.");
  }
  await h.pageScrollShots("editor");
  const tabs = h.page.locator('main [role="tab"]:visible');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const label = ((await tabs.nth(i).innerText().catch(() => "")) || `tab-${i + 1}`)
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .slice(0, 24);
    await tabs
      .nth(i)
      .click()
      .catch(() => undefined);
    await h.wait(600);
    await h.shot(`tab-${label}`);
  }
  if (await h.shows("constraint-preview")) await h.snap("preview", '[data-test="constraint-preview"]');
  await h.keep("editor", "main");
}

/** Identity card › Describe on an item; Apply and save on the last attempt when `apply`. */
export function describe(kind: ItemKind, name: string, { apply = true }: { apply?: boolean } = {}): BenchBody {
  return async (t) => {
    const { h } = t;
    await h.step("open", () => h.open(kind, name));
    await h.step("describe", () => h.panel("identity-ai"));
    await h.step("keep the answer", async () => {
      await h.keep("answer", PANEL);
      await h.panelShot("answer");
    });
    if (apply && t.last) {
      await h.step("apply and save", async () => {
        await h.tap("ai-apply");
        await h.saveItem();
        h.log("Applied and saved.");
      });
    }
  };
}

/** An edit through an existing item's AI panel; never saved. */
export function edit(
  kind: ItemKind,
  name: string,
  button: string,
  { mode, prepare, images }: { mode?: string; prepare?: (h: Helpers) => Promise<void>; images?: (t: BenchContext) => string[] } = {},
): BenchBody {
  return async (t) => {
    const { h } = t;
    const files = images ? images(t) : [];
    await h.step("open", async () => {
      await h.open(kind, name);
      if (prepare) await prepare(h);
    });
    await h.step("ask", () => h.panel(button, { ...(mode ? { mode } : {}), prompt: t.P, images: files }));
    await h.step("keep the answer", async () => {
      await h.keep("answer", PANEL);
      await h.panelShot("answer");
    });
    if (button === "cn-ai") await h.step("show the constraint", () => constraintShots(h));
  };
}

// ---- chat ---------------------------------------------------------------------------------------

export interface ChatOptions {
  /**
   * After the turn: "apply-undo" (apply, shoot, undo), "apply" (keep), "apply-last" (keep on the
   * last attempt; earlier ones just look), "delete" (confirm), or nothing (just look).
   */
  after?: "apply-undo" | "apply" | "apply-last" | "delete";
  /** The page the chat starts on (a route, or one worked out from the library). */
  from?: string | ((h: Helpers) => Promise<string>);
  /** Shoot what the turn did on the page itself. */
  page?: boolean;
  /** Answer the assistant's questions with "Decide for me". */
  decide?: boolean;
  images?: (t: BenchContext) => string[];
}

/** One chat turn from the top bar's AI drawer. */
export function chat({ after, from = "wildcards", page = false, decide = false, images }: ChatOptions = {}): BenchBody {
  return async (t) => {
    const { h } = t;
    const files = images ? images(t) : [];
    await h.step("open the page", async () => h.visit(typeof from === "function" ? await from(h) : from));
    await h.step("send", () => h.chat(t.P, { images: files }));
    if (decide) {
      await h.step("answer the questions", async () => {
        await h.chatShot("questions");
        await h.answerAsk();
      });
    }
    await h.step("keep the answer", async () => {
      await h.chatShot("answer");
      if (page) await h.pageShots();
    });
    if (after === "apply-undo") {
      await h.step("apply and undo", async () => {
        if (await h.applyCard()) {
          await h.chatShot("applied");
          await h.undoCard();
        }
      });
    } else if (after === "apply" || after === "delete" || (after === "apply-last" && t.last)) {
      await h.step(after === "delete" ? "delete" : "apply", async () => {
        if (await h.applyCard()) await h.chatShot("applied");
      });
    }
  };
}

// ---- library ------------------------------------------------------------------------------------

/** Ticks the wildcard options whose text is one of `values` (for a rewrite of some options). */
export async function tickOptions(h: Helpers, values: string[]): Promise<void> {
  await h.tap("wc-bulk-toggle");
  const rows = h.page.locator('[data-test^="wc-opt-row-"]');
  const n = await rows.count();
  let ticked = 0;
  for (let i = 0; i < n; i++) {
    const v = await h.page
      .locator(`[data-test="wc-opt-row-${i}"] textarea, [data-test="wc-opt-row-${i}"] input[type="text"], [data-test="wc-opt-row-${i}"] [contenteditable]`)
      .first()
      .evaluate((e) => (e as HTMLInputElement).value ?? e.textContent)
      .catch(() => "");
    if (values.some((x) => String(v).trim() === x)) {
      await h.tap(`wc-opt-check-${i}`);
      ticked++;
    }
  }
  if (ticked !== values.length) h.log(`Ticked ${ticked} of ${values.length} options.`);
}

/** Wildcards list › select (all, or by name) › Organize with AI, then Apply and Undo. */
export function organize({ names, after = "apply-undo" }: { names?: (h: Helpers) => Promise<string[]>; after?: "apply-undo" | "look" } = {}): BenchBody {
  return async (t) => {
    const { h } = t;
    await h.step("select", async () => {
      await h.visit("wildcards");
      if (names) {
        for (const n of await names(h)) await h.tap(`row-select-${await h.idOf("wildcards", n)}`);
      } else await h.tap('[aria-label="Select all"]');
      await h.tap("bulk-ai-organize");
    });
    await h.step("ask", () => h.panel("bulk-ai-organize", { prompt: t.P }));
    await h.step("keep the answer", async () => {
      await h.keep("answer", PANEL);
      await h.panelShot("answer");
    });
    if (after === "apply-undo") {
      await h.step("apply and undo", async () => {
        await h.tap("ai-apply");
        await h.wait(1500);
        await h.shot("applied");
        const undo = h.page.locator('button:has-text("Undo")').last();
        if (await undo.isVisible().catch(() => false)) {
          await h.tapOn(undo, "undo");
          await h.wait(1500);
          h.log("Undone.");
        } else h.log("No Undo button after Organize.");
      });
    }
  };
}

// ---- pack builder -------------------------------------------------------------------------------

/**
 * Between a pack test and P12 (which runs inside the first pack test whose check shows problems):
 * the parent says which round it is, P12 says it ran. A parent that finds P12 already run elsewhere
 * presses Fix all itself.
 */
export const fixRound = { label: "before-build", ran: false };

/** A pending web-search offer greys out Build and Update plan: skip it (only N5 tests research). */
export async function skipResearch(h: Helpers): Promise<void> {
  for (const skip of ["pack-research-skip", "ai-research-skip"]) {
    if (await h.shows(skip)) {
      await h.shot("research-offered");
      await h.tap(skip);
      h.flag("research-skipped", "The planner offered a web search; skipped it.");
      await h.aiIdle({ quiet: 1500, start: 500 });
    }
  }
}

/** True when Build can be pressed. With `allowResearch`, a pending web search is run first (N5). */
async function buildReady(h: Helpers, allowResearch: boolean): Promise<boolean> {
  if (allowResearch && (await h.shows("pack-research-allow"))) {
    await h.tap("pack-research-allow");
    h.log("Allowed the web search.");
    await h.aiIdle({ expect: true, timeout: 30 * 60_000 });
    await h.pageScrollShots("research");
    // The results wait for a pick ("Use what fits and update the plan"), which runs the update.
    if (await h.shows("ai-found-fits")) {
      await h.keep("found", '[data-test="ai-found"]');
      await h.tap("ai-found-fits", { done: () => h.busy() });
      h.log("Used what fits from the search.");
      await h.aiIdle({ expect: true, timeout: 40 * 60_000 });
      await h.pageScrollShots("plan-after-research");
    } else {
      if (await h.shows("ai-found-error")) h.log(`The search failed: ${await h.page.locator('[data-test="ai-found-error"]').first().innerText().catch(() => "")}`);
      else h.log("The search found nothing to pick.");
      if (await h.shows("ai-found-none")) await h.tap("ai-found-none");
      const refine = h.page.locator(sel("pack-refine")).first();
      if (await refine.isEnabled().catch(() => false)) {
        await h.tap("pack-refine");
        await h.aiIdle({ expect: true, timeout: 40 * 60_000 });
        await h.pageScrollShots("plan-after-research");
      }
    }
  }
  await skipResearch(h);
  const b = h.page.locator(sel("pack-build")).first();
  const why = await b.getAttribute("title").catch(() => null);
  if (why) h.log(`Build is greyed out: ${why}`);
  return (await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false));
}

const packFindings = (h: Helpers) =>
  h.page
    .locator('[data-test="pack-finding"]:visible, [data-test="pack-problems"]:visible li')
    .allInnerTexts()
    .catch(() => [] as string[]);

/** Presses Fix all with AI up to three times; keeps the findings before and after each press. Returns seconds. */
export async function fixAll(h: Helpers, label: string, allowResearch = false): Promise<number> {
  const rounds = [{ press: 0, findings: await packFindings(h) }];
  let secs = 0;
  for (let i = 1; i <= 3 && (await h.shows("pack-fix")) && !(await buildReady(h, allowResearch)); i++) {
    await h.pageScrollShots(`${label}-findings-${i}`);
    await h.tap("pack-fix");
    secs += await h.aiIdle({ expect: true, timeout: 60 * 60_000, quiet: 5000 });
    const now = await packFindings(h);
    rounds.push({ press: i, findings: now });
    h.log(`Fix all with AI, press ${i}: ${rounds[i - 1]!.findings.length} finding(s) before, ${now.length} after.`);
    await h.keep(`${label}-after-fix-${i}`, '[data-test="pack-builder"]');
    if (JSON.stringify(now) === JSON.stringify(rounds[i - 1]!.findings)) {
      h.flag("fix-changed-nothing", `Fix all with AI (${label}, press ${i}) left the same findings.`);
      break;
    }
  }
  await h.pageScrollShots(`${label}-after-fix`);
  await h.keepText(`${label}-fix-rounds`, { text: JSON.stringify(rounds, null, 1) });
  return secs;
}

export interface PackOptions {
  /** Start from a sample prompt instead of a request. */
  sample?: boolean;
  nsfw?: boolean;
  images?: (t: BenchContext) => string[];
  /** Install on the last attempt. */
  install?: boolean;
  /** Extend this bundle (by id) instead of starting a new pack. */
  extend?: (h: Helpers) => Promise<string>;
  /** Runs right after the plan (P2 runs P3 to P5 here). */
  afterPlan?: (t: BenchContext) => Promise<void>;
  /** Run a web search the planner offers (N5) instead of skipping it. */
  research?: boolean;
  /** The request typed, when not the test's own prompt. */
  request?: string;
}

/** The pack builder: plan (answering questions with Decide the rest), review, build and check, then install or not. */
export function pack({ sample = false, nsfw = false, images, install = false, extend, afterPlan, research = false, request }: PackOptions = {}): BenchBody {
  return async (t) => {
    const { h } = t;
    const ask = request ?? t.P;
    const files = images ? images(t) : [];
    await h.step("start", async () => {
      if (extend) {
        await h.open("bundles", await extend(h));
        await h.tap("bd-extend-ai");
        await h.wait(1500);
      } else {
        await h.visit("pack-builder");
        if (await h.shows("pack-reset")) {
          await h.tap("pack-reset");
          await h.wait(500);
        }
      }
      if (sample) {
        await h.tap("pack-sample-toggle");
        await h.type("pack-sample", ask);
        // Next needs a request too; the bench gives only the prompt.
        await h.type("pack-request", "A pack that makes more prompts like this one.");
      } else await h.type("pack-request", ask);
      if (files.length) await h.attach('[data-test="pack-builder"] [data-test="ai-images-input"]', files);
      await h.tap("pack-next");
      await h.aiIdle({ quiet: 2000 });
      if (await h.shows("pack-use-recommended")) {
        await h.tap("pack-use-recommended");
        h.log("Used the recommended settings.");
      }
      if (nsfw) await h.choose("pack-setting-rating", "NSFW");
      await h.shot("settings");
    });
    await h.step("plan", async () => {
      await h.tap("pack-plan");
      let plan = await h.aiIdle({ expect: true, timeout: 40 * 60_000 });
      for (let i = 0; i < 4 && (await h.shows("pack-decide-all")); i++) {
        await h.shot("questions");
        await h.keep("questions", '[data-test="pack-questions"]');
        await h.tap("pack-decide-all");
        plan += await h.aiIdle({ timeout: 40 * 60_000 });
      }
      h.metric("Plan s", Math.round(plan), "s");
      await h.keep("plan", '[data-test="pack-builder"]');
      await h.pageScrollShots("plan");
    });
    if (await h.shows("pack-review-ai")) {
      await h.step("review the plan", async () => {
        await h.tap("pack-review-ai");
        h.metric("Review s", Math.round(await h.aiIdle({ expect: true, timeout: 30 * 60_000 })), "s");
        await h.keep("review", '[data-test="pack-builder"]');
        await h.pageScrollShots("review");
      });
    }
    if (afterPlan) await afterPlan(t);

    let fixSecs = 0;
    // Build stays greyed out while the review has findings: press Fix all with AI, as a user
    // would. The first pack this happens on runs it as P12.
    const fixHere = async (label: string) => {
      fixRound.label = label;
      fixRound.ran = false;
      await t.child("P12");
      if (!fixRound.ran) fixSecs += await fixAll(h, label, research);
    };
    if (!(await buildReady(h, research))) await h.step("fix the findings", () => fixHere("before-build"));
    if (!(await buildReady(h, research))) {
      // Still blocked: dismiss what's left so the build can still be tested, and say so.
      const dismiss = h.page.locator('[data-test="pack-finding-dismiss"]:visible, [data-test="pack-problem-dismiss"]:visible');
      const n = await dismiss.count();
      for (let i = 0; i < n; i++)
        await dismiss
          .first()
          .click()
          .catch(() => undefined);
      if (n) {
        h.flag("dismissed-findings", `Fix all didn't clear the review; dismissed ${n} finding(s) to build anyway.`);
        await h.wait(800);
      }
    }
    if (!(await buildReady(h, research))) {
      h.flag("build-blocked", "Build stays greyed out; stopped this pack here.");
      await h.pageScrollShots("blocked");
      if (fixSecs) h.metric("Fix s", Math.round(fixSecs), "s");
      return;
    }
    await h.step("build", async () => {
      await h.tap("pack-build");
      h.metric("Build s", Math.round(await h.aiIdle({ expect: true, timeout: 90 * 60_000, quiet: 5000 })), "s");
      await h.keep("check", '[data-test="pack-builder"]');
      await h.pageScrollShots("built");
    });
    // The build's own problem list: press each item's Fix (up to three) and keep the list before
    // and after, to see whether Fix does anything there.
    const buildFixes: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const fix = h.page.locator('[data-test="pack-problem-fix"]:visible').first();
      if (!(await fix.isVisible().catch(() => false))) break;
      await h.step(`fix problem ${i + 1}`, async () => {
        const before = await h.page.locator('[data-test="pack-problems"] li').allInnerTexts().catch(() => [] as string[]);
        const which = await fix.locator("xpath=ancestor::li[1]").innerText().catch(() => "");
        await h.snap(`problem-${i + 1}`, fix.locator("xpath=ancestor::*[@data-test='pack-item' or @data-test='pack-problems'][1]"));
        await h.tapOn(fix, "pack-fix");
        const sec = await h.aiIdle({ expect: true, timeout: 30 * 60_000 });
        const after = await h.page.locator('[data-test="pack-problems"] li').allInnerTexts().catch(() => [] as string[]);
        // The Fix button can sit in an item's row rather than the problem list, so its text may
        // never match a list entry: a problem is gone only when the list got shorter.
        const gone = after.length < before.length;
        buildFixes.push({ problem: which, seconds: Math.round(sec), before: before.length, after: after.length, gone });
        h.log(`Fix on "${which.slice(0, 70)}": ${gone ? "gone" : "STILL THERE"} (${before.length} → ${after.length} problems).`);
        await h.keep(`check-after-problem-${i + 1}`, '[data-test="pack-builder"]');
        if (!gone) h.flag("problem-fix-did-nothing", which.slice(0, 120));
      });
    }
    if (buildFixes.length) {
      await h.pageScrollShots("after-problem-fixes");
      await h.keepText("build-fixes", { text: JSON.stringify(buildFixes, null, 1) });
    }
    const findings = await packFindings(h);
    if (findings.length) await h.keepText("findings", { text: findings.join("\n") });
    // Findings after the build: Fix all again (P12 if no pack needed it before).
    if (await h.shows("pack-fix")) await h.step("fix the findings after the build", () => fixHere("after-build"));
    if (fixSecs) h.metric("Fix s", Math.round(fixSecs), "s");
    if (install && t.last && (await h.shows("pack-install"))) {
      await h.step("install", async () => {
        await h.tap("pack-install");
        await h.aiIdle({ quiet: 2000 });
        await h.shot("installed");
        if (!(await h.shows("pack-undo", 5000))) {
          h.flag("not-installed", "Install didn't finish: the pack builder shows no Undo.");
          await h.pageScrollShots("not-installed");
          return;
        }
        h.log("Installed.");
        if (extend) {
          await h.tap("pack-undo");
          await h.wait(1500);
          h.log("Undone (the bundle is restored).");
        }
      });
    }
  };
}

/** P12's body: Fix all with AI on the pack its parent is building. */
export const fixFindings: BenchBody = async (t) => {
  fixRound.ran = true;
  const secs = await t.h.step("fix all with AI", () => fixAll(t.h, fixRound.label));
  t.h.metric("Fix s", Math.round(secs), "s");
};

