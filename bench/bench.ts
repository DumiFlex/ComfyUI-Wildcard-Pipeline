// The bench's own helpers, merged into Watchwright's `h`: the app's API, its editors, AI panels
// and chat. Every wait watches the app itself (AI requests in flight, the working marks), so a
// slow model takes longer instead of breaking a step. Ported from the old bench robot's Bot.
import type { BrowserContext, Locator, Request } from "playwright";
import { StepError, type Helpers } from "watchwright";

export const AI_PATH = "/wp/api/ai/";
/** AI routes that never wait on the model (and the debug log the bench reads). */
const QUIET = ["/wp/api/ai/debug", "/wp/api/ai/progress", "/wp/api/ai/config", "/wp/api/ai/index", "/wp/api/ai/vision", "/wp/api/ai/chats"];

/** The AI panel that is showing (wildcard tabs keep the hidden ones mounted). */
export const PANEL =
  '[data-test="ai-panel"]:visible, [data-test="ai-draft-panel"]:visible, [data-test="ai-edit-panel"]:visible, [data-test="ai-organize-panel"]:visible';

/** `"save-btn"` → `[data-test="save-btn"]`; anything that already looks like a selector stays. */
export function sel(test: string): string {
  return test.startsWith("[") || test.startsWith(".") || test.includes(" ") ? test : `[data-test="${test}"]`;
}

/** How long the AI may write nothing new before the wait gives up with a `model-loop` finding. */
export const STALL_MS = 10 * 60_000;

/**
 * The manager is bench/dev/serve.py, whose fake model answers with made-up values: an answer
 * with nothing to apply is the fake's, not a broken click, so it flags `fake-answer` (info)
 * instead of `no-card` / `not-saved`. The pack's setup sets it.
 */
export const fakeModel = { on: false };

/** The flag for "nothing to apply": `robot` on a real model, `fake-answer` on the fake. */
export function nothingFlag(robot: "no-card" | "not-saved"): string {
  return fakeModel.on ? "fake-answer" : robot;
}

/** Ends a test early when the model stopped making progress; the bench's test wrapper files it. */
export class ModelLoop extends Error {
  override name = "ModelLoop";
}

// ---- AI request tracking ----------------------------------------------------------------------

/** The app's AI requests in one browser context: what is in flight and how many ever started. */
export class AiTracker {
  readonly inflight = new Map<Request, { started: number; progressId: string | null }>();
  starts = 0;
  finished = 0;

  static isAi(r: Request): boolean {
    const u = new URL(r.url());
    return u.pathname.startsWith(AI_PATH) && r.method() !== "GET" && !QUIET.some((q) => u.pathname.startsWith(q));
  }
}

const trackers = new WeakMap<BrowserContext, AiTracker>();

/**
 * The tracker for a browser context, listening from the first call on. The AI debug collector
 * calls it as the run starts (and again for a replaced context), so nothing is missed.
 */
export function trackerFor(context: BrowserContext): AiTracker {
  let t = trackers.get(context);
  if (t) return t;
  const tracker = new AiTracker();
  context.on("request", (r) => {
    if (!AiTracker.isAi(r)) return;
    tracker.inflight.set(r, { started: Date.now(), progressId: r.headers()["x-wp-progress"] ?? null });
    tracker.starts++;
  });
  const done = (r: Request) => {
    if (tracker.inflight.delete(r)) tracker.finished++;
  };
  context.on("requestfinished", done);
  context.on("requestfailed", done);
  trackers.set(context, tracker);
  t = tracker;
  return t;
}

// ---- the helpers ------------------------------------------------------------------------------

export interface ApiAnswer {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the app's JSON, read loosely like the robot did
  json: any;
  text: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  type?: string;
  content_rating?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Library {
  modules: LibraryItem[];
  bundles: LibraryItem[];
  templates: LibraryItem[];
}

export type ItemKind = "wildcards" | "fixed-values" | "combines" | "derivations" | "constraints" | "templates" | "bundles";

export interface TapOptions {
  timeout?: number;
  last?: boolean;
  /** Tells whether the click already did its job, so a slow click isn't pressed twice. */
  done?: () => boolean | Promise<boolean>;
}

export interface IdleOptions {
  /** Quiet time in a row that counts as done (default 3 s). */
  quiet?: number;
  /** Default 30 minutes. */
  timeout?: number;
  /** Wait before looking (default 1.5 s). */
  start?: number;
  /** Wait up to 20 s for AI work to start first (after a click that should start it). */
  expect?: boolean;
  /** No new model output for this long ends the wait with a `model-loop` finding (default 10 minutes). */
  stallMs?: number;
}

declare module "watchwright" {
  interface Helpers {
    /** Calls the app's API from the page (same origin, so the AI guard lets it through). */
    api(path: string, options?: { method?: string; body?: unknown }): Promise<ApiAnswer>;
    aiConfig(): Promise<Record<string, unknown>>;
    setAiConfig(patch: Record<string, unknown>): Promise<void>;
    library(): Promise<Library>;
    idOf(kind: ItemKind, name: string): Promise<string>;
    /** Opens an item's editor by name or id. */
    open(kind: ItemKind, name: string): Promise<void>;
    /** Every module and bundle name, longest first. */
    itemNames(): Promise<string[]>;
    /** Opens a route of the manager and discards an earlier run's unsaved draft. */
    visit(route: string): Promise<void>;
    /** Clicks `data-test` (or a selector): waits for it, and when Firefox refuses a visible element, clicks it anyway. */
    tap(test: string, options?: TapOptions): Promise<void>;
    /** Clicks a located element with the same checks as `tap`. */
    tapOn(one: Locator, label: string, options?: Pick<TapOptions, "done">): Promise<void>;
    /** True when `data-test` (or a selector) is visible, waiting up to `timeout` ms. */
    shows(test: string, timeout?: number): Promise<boolean>;
    type(test: string, text: string): Promise<void>;
    /** Picks `label` in one of the app's selects. */
    choose(test: string, label: string): Promise<void>;
    attach(selector: string, files: string[]): Promise<void>;
    /** A screenshot of the page, or of the last match of `target`, falling back to the page. */
    snap(name: string, target?: string | Locator): Promise<void>;
    /** Keeps the visible text of a region ("" when it isn't there). */
    keep(name: string, selector: string): Promise<string>;
    /** Shoots a long page top to bottom, one screen at a time, by its main scroller. */
    pageScrollShots(name: string, max?: number): Promise<void>;
    /** Shoots the open AI panel, then each part of it below the fold. */
    panelShot(name: string): Promise<void>;
    /** True while the page shows the app working. */
    busy(): Promise<boolean>;
    /** Waits until no AI request is in flight and nothing shows the app working. Returns seconds. */
    aiIdle(options?: IdleOptions): Promise<number>;
    /** Presses Save in an editor; a new item must leave /new, or the attempt is broken (`not-saved`). */
    saveItem(): Promise<void>;
    setName(name: string): Promise<void>;
    setVar(variable: string): Promise<void>;
    nsfw(): Promise<void>;
    /** Opens an editor's AI panel, types the ask and runs it. Returns seconds. */
    panel(button: string, options?: { mode?: string; prompt?: string; images?: string[] }): Promise<number>;
    /** Reopens the chat drawer when it was closed; true when it had to. */
    ensureChat(): Promise<boolean>;
    openChat(options?: { fresh?: boolean }): Promise<void>;
    /** Types into the chat box, turning each `@Name` into a picked mention. */
    typeChat(text: string): Promise<void>;
    /** Sends one chat message and waits for the turn to end. Returns seconds. */
    chat(text: string, options?: { fresh?: boolean; images?: string[] }): Promise<number>;
    expandChat(): Promise<void>;
    scrollChat(name: string, max?: number): Promise<void>;
    /** Keeps a chat turn: text, the drawer top to bottom, and each row of a grouped card. */
    chatShot(name?: string): Promise<void>;
    /** Shots of what a chat turn did on the page: an opened panel, what it pointed at, a test card. */
    pageShots(): Promise<void>;
    /** Answers the assistant's questions with "Decide for me". */
    answerAsk(): Promise<number>;
    /** Applies the newest card; flags `no-card` when there is none. */
    applyCard(): Promise<boolean>;
    undoCard(): Promise<boolean>;
  }
}

const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";

export function benchHelpers(h: Helpers): Record<string, unknown> {
  const page = h.page;
  const tracker = () => trackerFor(h.context);
  /** A pause point: a pause request lands here. */
  const enter = () => h.wait(1);
  let clickMark = 0;
  const origin = h.baseURL ? new URL(h.baseURL).origin : null;

  const self = {
    async api(p: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiAnswer> {
      if (origin && !page.url().startsWith(origin)) await self.visit("wildcards");
      return page.evaluate(
        async ([p, method, body]) => {
          const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
          if (body !== undefined) init.body = JSON.stringify(body);
          const r = await fetch(p, init);
          const text = await r.text();
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* a text answer */
          }
          return { status: r.status, json, text };
        },
        [p, opts.method ?? "GET", opts.body] as const,
      );
    },

    async aiConfig() {
      return ((await self.api("/wp/api/ai/config")).json ?? {}) as Record<string, unknown>;
    },

    async setAiConfig(patch: Record<string, unknown>) {
      const r = await self.api("/wp/api/ai/config", { method: "PUT", body: patch });
      if (r.status >= 400) throw new StepError(`The AI settings were refused: ${r.text.slice(0, 200)}`);
    },

    async library(): Promise<Library> {
      const [m, b, t] = await Promise.all([self.api("/wp/api/modules?limit=1000"), self.api("/wp/api/bundles?limit=1000"), self.api("/wp/api/templates?limit=1000")]);
      const items = (r: ApiAnswer): LibraryItem[] => (r.json && (r.json.items || r.json.data || r.json)) || [];
      return { modules: items(m), bundles: items(b), templates: items(t) };
    },

    async idOf(kind: ItemKind, name: string) {
      const lib = await self.library();
      const pool = kind === "bundles" ? lib.bundles : kind === "templates" ? lib.templates : lib.modules;
      const hit = pool.find((x) => x.name === name);
      if (!hit) throw new StepError(`No ${kind} item called "${name}".`);
      return hit.id;
    },

    async open(kind: ItemKind, name: string) {
      const id = /^[0-9a-f]{8}$/.test(name) ? name : await self.idOf(kind, name);
      await self.visit(`${kind}/${id}/edit`);
    },

    async itemNames() {
      const lib = await self.library();
      return [...lib.modules, ...lib.bundles].map((x) => x.name).sort((a, b) => b.length - a.length);
    },

    async visit(route: string) {
      await h.goto(route.replace(/^\//, ""), { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await h.wait(600);
      // An earlier run's unsaved draft is offered back; every attempt starts clean.
      const banner = page.locator('[data-test="draft-banner"]');
      const editor = /\/new(?:[/?#]|$)|\/edit(?:[?#]|$)/.test(route);
      const shown = editor
        ? await banner.waitFor({ state: "visible", timeout: 1500 }).then(
            () => true,
            () => false,
          )
        : await banner.isVisible().catch(() => false);
      if (shown) {
        const discard = banner.getByRole("button", { name: "Discard" });
        await discard.click({ timeout: 3000 }).catch(() => discard.dispatchEvent("click"));
        h.log("Discarded an earlier run's unsaved draft.");
        await h.wait(400);
      }
    },

    async tapOn(one: Locator, label: string, { done }: Pick<TapOptions, "done"> = {}) {
      await enter();
      clickMark = tracker().starts;
      await one.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
      try {
        await one.click({ timeout: 2500 });
      } catch (e) {
        // Firefox can time a click out after it landed. Clicking again then closed a panel or hit
        // a send button that had turned into Stop, so check first.
        const msg = e instanceof Error ? e.message : String(e);
        const landed = /performing click action|click action done/i.test(msg) || (done ? await Promise.resolve(done()).catch(() => false) : false);
        if (landed) {
          h.log(`The click on ${label} was slow but landed.`);
          return;
        }
        // Visible but the click didn't land (seen in Firefox): keep why, then click anyway.
        const why = msg
          .split("\n")
          .filter((l) => /intercepts|not stable|outside|not visible|disabled|retrying|waiting/i.test(l))
          .slice(-4)
          .join(" | ");
        h.log(`The click on ${label} was refused (${why || firstLine(e)}); forcing it.`);
        h.flag("forced-click", label);
        try {
          if (!(await one.isEnabled().catch(() => true))) throw new Error("the button is disabled");
          await one.click({ force: true, timeout: 3000 }).catch(() => one.dispatchEvent("click", undefined, { timeout: 3000 }));
        } catch (e2) {
          throw new StepError(`Couldn't click ${label}: ${firstLine(e2)}`);
        }
      }
    },

    async tap(test: string, { timeout = 15_000, last = false, done }: TapOptions = {}) {
      await enter();
      const loc = page.locator(sel(test));
      const one = last ? loc.last() : loc.first();
      try {
        await one.waitFor({ state: "visible", timeout });
      } catch (e) {
        throw new StepError(`No ${test} on the page: ${firstLine(e)}`);
      }
      await self.tapOn(one, test, done ? { done } : {});
      await h.wait(400);
    },

    async shows(test: string, timeout = 0) {
      return h.has(sel(test), timeout);
    },

    async type(test: string, text: string) {
      await enter();
      const loc = page.locator(sel(test)).first();
      await loc.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
        throw new StepError(`No ${test} to type in.`);
      });
      await loc.fill(text);
      await h.wait(200);
    },

    async choose(test: string, label: string) {
      await self.tap(`${sel(test)} [data-test="select-trigger"]`);
      const opts = page.locator('[role="option"]');
      const n = await opts.count();
      for (let i = 0; i < n; i++) {
        const o = opts.nth(i);
        const title = (await o.getAttribute("title")) ?? "";
        const text = ((await o.innerText().catch(() => "")) || "").trim().split("\n")[0];
        if (title.startsWith(`${label} —`) || title === label || text === label) {
          await self.tapOn(o, `option ${label}`);
          await h.wait(400);
          return;
        }
      }
      throw new StepError(`No option "${label}" in ${test}.`);
    },

    async attach(selector: string, files: string[]) {
      await enter();
      await page
        .locator(selector)
        .first()
        .setInputFiles(files)
        .catch((e: unknown) => {
          throw new StepError(`Couldn't attach: ${firstLine(e)}`);
        });
      await h.wait(1500);
    },

    async snap(name: string, target?: string | Locator) {
      if (!target) return h.shot(name);
      const loc = typeof target === "string" ? page.locator(target).last() : target;
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
        await h.shot(name, { target: loc });
      } catch {
        // An element shot can fail on a tall or moving element; the page will do.
        await h.shot(name);
      }
    },

    async keep(name: string, selector: string) {
      const text = await page
        .locator(selector)
        .last()
        .innerText({ timeout: 3000 })
        .catch(() => "");
      if (text) await h.keepText(name, { text });
      return text;
    },

    async pageScrollShots(name: string, max = 14) {
      await enter();
      const mark = await page.evaluate(() => {
        const els = [document.scrollingElement, ...document.querySelectorAll("main, main *, .wp-app *")];
        let best: Element | null = null;
        for (const e of els) {
          if (!e || e.closest('[data-test="ai-chat"]')) continue;
          const st = getComputedStyle(e);
          const scrolls = e === document.scrollingElement || /(auto|scroll)/.test(st.overflowY);
          if (scrolls && e.scrollHeight > e.clientHeight + 40 && (!best || e.clientHeight > best.clientHeight)) best = e;
        }
        if (!best) return null;
        best.setAttribute("data-wp-bench-scroller", "1");
        best.scrollTop = 0;
        return { h: best.scrollHeight, view: best.clientHeight };
      });
      if (!mark) return h.shot(`${name}-1`);
      const step = Math.max(200, mark.view - 80);
      for (let i = 0, top = 0; i < max && top < mark.h; i++, top += step) {
        await page.evaluate((y) => {
          const e = document.querySelector("[data-wp-bench-scroller]");
          if (e) e.scrollTop = y;
        }, top);
        await h.wait(350);
        await h.shot(`${name}-${i + 1}`);
      }
    },

    async panelShot(name: string) {
      await self.snap(name, PANEL);
      for (let i = 1; i <= 10; i++) {
        const moved = await page
          .evaluate((selector) => {
            const panels = [...document.querySelectorAll<HTMLElement>(selector.replace(/:visible/g, ""))].filter((e) => e.offsetParent);
            const p = panels[panels.length - 1];
            if (!p) return false;
            // Where the visible area ends: the window, or the nearest clipping box around the panel.
            let bottom = innerHeight;
            for (let a = p.parentElement; a && a !== document.documentElement; a = a.parentElement) {
              if (getComputedStyle(a).overflowY !== "visible") bottom = Math.min(bottom, a.getBoundingClientRect().bottom);
            }
            let next: HTMLElement | null = null;
            for (const e of p.querySelectorAll<HTMLElement>("*")) {
              if (!e.offsetHeight || e.offsetHeight > 200) continue;
              const r = e.getBoundingClientRect();
              if (r.top >= bottom - 2 && (!next || r.top < next.getBoundingClientRect().top)) next = e;
            }
            if (!next) return false;
            next.scrollIntoView({ block: "start" });
            // Back off past sticky headers (the editor's card header sits over the top rows).
            let sc = next.parentElement;
            while (sc && sc !== document.body && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
            const scroller = sc && sc !== document.body ? sc : document.scrollingElement;
            if (scroller) scroller.scrollTop -= 160;
            return true;
          }, PANEL)
          .catch(() => false);
        if (!moved) break;
        await h.wait(350);
        await h.shot(`${name}-screen-${i}`);
      }
    },

    async busy() {
      return page
        .evaluate(() => {
          const shown = (e: Element) => !!((e as HTMLElement).offsetWidth || (e as HTMLElement).offsetHeight || e.getClientRects().length);
          const marks = [...document.querySelectorAll(".wp-aiw, [aria-busy='true'], [data-test='ai-chat-live'], [data-test='ai-loading']")];
          return marks.some(shown);
        })
        .catch(() => false);
    },

    async aiIdle({ quiet = 3000, timeout = 30 * 60_000, start = 1500, expect = false, stallMs = STALL_MS }: IdleOptions = {}) {
      const t0 = Date.now();
      const t = tracker();
      await h.wait(start);
      // After a forced click the request can start late: wait up to 20 s for the AI to get busy
      // before counting quiet time.
      if (expect) {
        const seen = await h
          .waitUntil(async () => t.starts > clickMark || t.inflight.size > 0 || (await self.busy()), { timeout: 20_000, interval: 300 })
          .then(
            () => true,
            () => false,
          );
        if (!seen) h.log("No AI work started within 20 s of the click.");
      }
      // Progress: the model's output so far on every request in flight (the app's own progress
      // route), plus requests started and finished. Read every few seconds while busy.
      let progress = "";
      let readAt = 0;
      const readProgress = async () => {
        if (Date.now() - readAt < 5000) return;
        readAt = Date.now();
        const ids = [...t.inflight.values()].map((v) => v.progressId).filter((x): x is string => !!x);
        const views = ids.length
          ? await page
              .evaluate(async (ids) => {
                const out: unknown[] = [];
                for (const id of ids) {
                  const r = await fetch(`/wp/api/ai/progress/${encodeURIComponent(id)}`).catch(() => null);
                  const j = r && r.ok ? ((await r.json().catch(() => null)) as { data?: { tokens?: number; calls?: number; phase?: string } } | null) : null;
                  const v = j?.data ?? (j as { tokens?: number; calls?: number; phase?: string } | null);
                  out.push(v ? [v.tokens, v.calls, v.phase] : null);
                }
                return out;
              }, ids)
              .catch(() => [])
          : [];
        progress = JSON.stringify([t.starts, t.finished, views]);
      };
      let calm = Date.now();
      const result = await h.waitUntil(
        async () => {
          const busy = t.inflight.size > 0 || (await self.busy());
          if (busy) {
            calm = Date.now();
            await readProgress();
          }
          return !busy && Date.now() - calm >= quiet;
        },
        { timeout, interval: 500, progress: () => progress, stallMs, what: "the AI to finish" },
      );
      if (result === "stalled") {
        const open = t.inflight.size;
        const detail = open
          ? `No new output from the model for ${Math.round(stallMs / 60_000)} min (${open} AI request(s) still open).`
          : `The page showed the app working for ${Math.round(stallMs / 60_000)} min with no AI request open.`;
        await self.snap("stalled");
        h.flag("model-loop", detail);
        throw new ModelLoop(detail);
      }
      return (Date.now() - t0) / 1000;
    },

    async saveItem() {
      // Not Escape first: in an editor it asks to discard the changes.
      const isNew = (u: string | URL) => /\/new(?:[/?#]|$)/.test(String(u));
      const fresh = isNew(page.url());
      await self.tap("save-btn");
      if (!fresh) {
        await h.wait(1500);
        return;
      }
      // A new item leaves /new once it is created.
      for (let i = 0; i < 2; i++) {
        if (await page.waitForURL((u) => !isNew(u), { timeout: 6000 }).then(() => true, () => false)) {
          await h.wait(800);
          return;
        }
        const toasts = await page.locator('[role="alert"]:visible, .wp-toast:visible').allInnerTexts().catch(() => [] as string[]);
        h.log(`Save didn't leave the new page${toasts.length ? ` (${toasts.join(" | ").replace(/\s+/g, " ").slice(0, 200)})` : ""}${i ? "" : "; pressing it again"}.`);
        if (!i) await page.locator(sel("save-btn")).first().dispatchEvent("click").catch(() => undefined);
      }
      await self.snap("save-failed");
      h.flag("not-saved", "Save didn't create the item.");
      throw new StepError("The item wasn't saved.");
    },

    async setName(name: string) {
      await self.type("identity-name", name);
    },
    async setVar(variable: string) {
      await self.type("identity-var-binding", variable);
    },
    async nsfw() {
      await self.tap("identity-nsfw-toggle");
    },

    async panel(button: string, { mode, prompt = "", images = [] }: { mode?: string; prompt?: string; images?: string[] } = {}) {
      const open = () => h.has('[data-test="ai-run"]:visible');
      if (!(await h.has('[data-test="ai-instruction"]:visible')) || button === "identity-ai") await self.tap(button, { done: open });
      // A toggle pressed twice closes its panel again: open it once more if so.
      if (!(await h.has('[data-test="ai-run"]:visible', 3000))) {
        h.log(`The ${button} panel wasn't open; pressing it again.`);
        await self.tap(button, { done: open });
      }
      if (mode) await self.tap(`ai-mode-${mode}`);
      if (images.length) await self.attach('[data-test="ai-images-input"]', images);
      if (prompt) await self.type('[data-test="ai-instruction"]:visible', prompt);
      h.log(`Ask: ${mode ?? button} "${prompt.slice(0, 60)}"`);
      await self.tap('[data-test="ai-run"]:visible', { last: true, done: () => self.busy() });
      const s = await self.aiIdle({ expect: true });
      h.log(`Answered in ${s.toFixed(1)} s.`);
      return s;
    },

    async ensureChat() {
      if (await self.shows("ai-chat")) return false;
      await self.tap("topbar-ai", { done: () => self.shows("ai-chat") });
      await self.shows("ai-chat", 5000);
      return true;
    },

    async openChat({ fresh = true }: { fresh?: boolean } = {}) {
      if (await self.ensureChat()) h.log("Opened the chat.");
      // New chat is disabled while the chat is already empty.
      if (fresh && (await page.locator('[data-test="ai-chat-new"]').isEnabled().catch(() => false))) {
        await self.tap("ai-chat-new");
        await h.wait(500);
      }
    },

    async typeChat(text: string) {
      await enter();
      const box = page.locator('[data-test="ai-chat-input"]');
      // A raw click here timed out in Firefox: focus the box instead.
      await box.waitFor({ state: "visible", timeout: 15_000 });
      await box.focus();
      await box.fill("");
      const names = text.includes("@") ? await self.itemNames() : [];
      let rest = text;
      while (rest) {
        const at = rest.indexOf("@");
        if (at < 0) {
          await page.keyboard.insertText(rest);
          break;
        }
        if (at > 0) await page.keyboard.insertText(rest.slice(0, at));
        rest = rest.slice(at + 1);
        const name = names.find((n) => rest.startsWith(n));
        if (!name) {
          await page.keyboard.insertText("@");
          continue;
        }
        // The menu searches up to the first space, so type the first word and pick the row.
        const firstWord = name.split(/\s/)[0] ?? name;
        await page.keyboard.type(`@${firstWord}`, { delay: 15 });
        await page.locator('[data-test="ai-ac"]').waitFor({ state: "visible", timeout: 4000 }).catch(() => undefined);
        const row = page.locator('[data-test="ai-ac"] [data-test^="ai-ac-row-"]').filter({ hasText: name });
        let picked = false;
        const rows = await row.count().catch(() => 0);
        for (let i = 0; i < rows; i++) {
          const first = ((await row.nth(i).innerText()).trim().split("\n")[0] ?? "").trim();
          if (first === name) {
            await row.nth(i).dispatchEvent("mousedown");
            picked = true;
            break;
          }
        }
        if (!picked) {
          h.log(`The mention @${name} wasn't picked from the menu (typed as text).`);
          // Not Escape: in the chat box it closes the whole drawer. A space closes the menu.
          await page.keyboard.insertText(" ");
          await page.keyboard.press("Backspace");
          await page.keyboard.insertText(name.slice(firstWord.length));
        }
        await h.wait(200);
        rest = rest.slice(name.length);
      }
    },

    async chat(text: string, { fresh = true, images = [] }: { fresh?: boolean; images?: string[] } = {}) {
      await self.openChat({ fresh });
      if (images.length) await self.attach('[data-test="ai-chat-file"]', images);
      await self.typeChat(text);
      h.log(`Chat: "${text.slice(0, 70)}"`);
      if (await self.ensureChat()) {
        h.log("The chat drawer closed while typing; reopened it and typed again.");
        await self.typeChat(text);
      }
      await self.tap("ai-chat-send", { done: async () => !(await self.shows("ai-chat-send")) || (await self.busy()) });
      const s = await self.aiIdle({ expect: true });
      h.log(`The turn ended in ${s.toFixed(1)} s.`);
      return s;
    },

    async expandChat() {
      const chat = page.locator('[data-test="ai-chat"]');
      for (let pass = 0; pass < 3; pass++) {
        let clicked = 0;
        const btns = chat.locator('[data-test="ai-chat-more"]:visible, [data-test="ai-chat-more-warnings"]:visible');
        const n = await btns.count();
        for (let i = 0; i < n; i++) {
          const b = btns.nth(i);
          const text = ((await b.innerText().catch(() => "")) || "").trim();
          if (/^Show less/i.test(text)) continue;
          await b.dispatchEvent("click").catch(() => undefined);
          clicked++;
        }
        if (!clicked) break;
        await h.wait(300);
      }
    },

    async scrollChat(name: string, max = 12) {
      const size = await page.evaluate(() => {
        const b = document.querySelector('[data-test="ai-chat-body"]');
        if (!b) return null;
        b.scrollTop = 0;
        return { h: b.scrollHeight, view: b.clientHeight };
      });
      if (!size) return self.snap(name, '[data-test="ai-chat"]');
      const step = Math.max(200, size.view - 60);
      let n = 0;
      for (let top = 0; n < max && top < size.h; top += step) {
        await page.evaluate((y) => {
          const b = document.querySelector('[data-test="ai-chat-body"]');
          if (b) b.scrollTop = y;
        }, top);
        await h.wait(250);
        await self.snap(`${name}-${++n}`, '[data-test="ai-chat"]');
      }
    },

    async chatShot(name = "chat") {
      // The drawer can be closed by the time the turn ends: reopen it so the turn is on screen.
      if (await self.ensureChat().catch(() => false)) {
        h.log("The chat drawer was closed after the turn; reopened it.");
        await h.wait(800);
      }
      await self.expandChat();
      await self.keep(name, '[data-test="ai-chat-body"]');
      await self.scrollChat(name);
      const rows = page.locator('[data-test="ai-chat"] [data-test="ai-group-open"]:visible');
      const n = Math.min(await rows.count(), 12);
      for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        if ((await row.getAttribute("aria-expanded")) !== "true") await row.dispatchEvent("click").catch(() => undefined);
        await h.wait(400);
        await self.expandChat();
        const body = row.locator("xpath=ancestor::*[@data-test='ai-group-row'][1]");
        const target = (await body.count()) ? body : row;
        await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
        await self.keep(`${name}-row-${i + 1}`, '[data-test="ai-chat-body"]');
        await self.snap(`${name}-row-${i + 1}`, target);
      }
      await page.evaluate(() => {
        const b = document.querySelector('[data-test="ai-chat-body"]');
        if (b) b.scrollTop = b.scrollHeight;
      });
    },

    async pageShots() {
      await h.shot("page");
      const marks: [string, string][] = [
        ["opened-panel", PANEL],
        ["pointed-at", '[data-test="ai-pointer"]:visible'],
        ["test-card", '[data-test="ai-test-card"]:visible'],
      ];
      for (const [name, selector] of marks) {
        const loc = page.locator(selector).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
        await h.wait(600);
        await h.shot(`${name}-in-page`);
        await self.snap(name, loc);
        if (name === "opened-panel") await self.keep(name, selector);
      }
    },

    async answerAsk() {
      if (await self.shows("ai-ask-decide")) {
        h.log("The assistant asked questions: Decide for me.");
        await self.tap("ai-ask-decide", { last: true });
        return self.aiIdle();
      }
      return 0;
    },

    async applyCard() {
      if (await self.ensureChat()) h.log("The chat drawer was closed; reopened it to apply.");
      for (const t of ["ai-group-apply", "ai-chat-apply-all", "ai-chat-apply", "ai-chat-delete"]) {
        if (await self.shows(t)) {
          // A turn can leave several cards; a user applies them all.
          let n = 0;
          do {
            await self.tap(t, { last: true });
            if (t === "ai-chat-delete") await self.tap("ai-chat-delete-confirm", { last: true });
            await h.wait(1500);
            n++;
          } while (n < 6 && t !== "ai-chat-delete" && (await self.shows(t)));
          h.log(`Applied (${t}${n > 1 ? ` × ${n}` : ""}).`);
          return true;
        }
      }
      h.log("No card to apply.");
      h.flag(nothingFlag("no-card"), "The turn left no card to apply.");
      return false;
    },

    async undoCard() {
      if (await self.ensureChat()) h.log("The chat drawer was closed; reopened it to undo.");
      for (const t of ["ai-group-undo", "ai-chat-undo"]) {
        if (await self.shows(t)) {
          let n = 0;
          do {
            await self.tap(t, { last: true });
            await h.wait(1500);
            n++;
          } while (n < 6 && (await self.shows(t)));
          h.log(`Undone${n > 1 ? ` × ${n}` : ""}.`);
          return true;
        }
      }
      h.log("No Undo to press.");
      return false;
    },
  };
  return self;
}
