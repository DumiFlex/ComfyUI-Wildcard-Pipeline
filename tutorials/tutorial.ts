// The tutorial presenter: what makes a test look like a video someone made on purpose. A steady
// pointer that moves like a hand (cursor.js draws it), narration captions timed to the voice
// lines, callouts, and the canvas moves a person makes (add a node through search, drag a wire,
// press Run). Every step goes through the real UI with the visible mouse; nothing is set behind
// the viewer's back except the start state.
//
// Timing: `say(line)` shows the caption and returns at once, so the hands work while the voice
// speaks; the next `say` (or `done`) waits until the line has been spoken. A line's length comes
// from voice/lines.json (written by voice/speak.py); a line not spoken yet gets an estimate.
//
// The cues (when each line starts, what it says, the fast-forward ranges) are saved with the
// attempt as cues.json; render.mjs turns the attempt's video + cues into the finished MP4.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import { StepError, test, type Helpers, type TestMeta } from "watchwright";

/** The page script that draws the pointer, captions and callouts (Watchwright runs a cached copy of the pack's code, so files are found through the pack folder). */
export const cursorScript = (packDir: string) => path.join(packDir, "cursor.js");
const linesFile = (packDir: string) => path.join(packDir, "voice", "lines.json");

/** A narration line's id: the same text always gets the same voice file. */
export const lineId = (text: string) => createHash("sha1").update(text.trim()).digest("hex").slice(0, 12);

interface VoiceLine {
  text: string;
  ms: number;
}

function voiceLines(packDir: string): Record<string, VoiceLine> {
  const file = linesFile(packDir);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, VoiceLine>;
  } catch {
    return {};
  }
}

/** About how long a line takes to say, for lines without a voice file yet. */
const estimate = (text: string) => Math.max(1600, Math.round(text.length * 62));

export interface Cue {
  id: string;
  text: string;
  /** Start, ms from the start of the test body. */
  at: number;
  ms: number;
  voiced: boolean;
}

export interface FastRange {
  from: number;
  to: number;
  /** How much faster the final video plays this part. */
  speed: number;
}

type Point = { x: number; y: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);


/**
 * The part of an element that is really on screen: its box cut down to every ancestor that clips
 * its overflow (a scrolling panel, a dialog body) and to the window, so a callout never boxes the
 * hidden rest of a long list. Null when nothing of it shows.
 */
async function shownBox(el: Locator, timeout = 5_000): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return el
    .evaluate(
      (node) => {
        const r = node.getBoundingClientRect();
        let [l, t, rt, b] = [r.left, r.top, r.right, r.bottom];
        for (let p = node.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
          const q = p.getBoundingClientRect();
          if (cs.overflowX !== "visible") [l, rt] = [Math.max(l, q.left), Math.min(rt, q.right)];
          if (cs.overflowY !== "visible") [t, b] = [Math.max(t, q.top), Math.min(b, q.bottom)];
        }
        [l, t, rt, b] = [Math.max(l, 0), Math.max(t, 0), Math.min(rt, window.innerWidth), Math.min(b, window.innerHeight)];
        return rt > l && b > t ? { x: l, y: t, width: rt - l, height: b - t } : null;
      },
      undefined,
      { timeout },
    )
    .catch(() => null);
}

export class Tutor {
  readonly page: Page;
  /** WP Debug's node id once addDebugUnder placed it. */
  debugId: string | null = null;
  private readonly lines: Record<string, VoiceLine>;
  private readonly t0 = Date.now();
  private pos: Point = { x: 960, y: 560 };
  private busyUntil = 0;
  /** The first move after a line waits until then, so the hand acts as the voice says it, not ahead of it. */
  private leadUntil = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** The caption on screen and when it goes, so a page load can put it back. */
  private caption: { text: string; until: number } | null = null;
  readonly cues: Cue[] = [];
  readonly fast: FastRange[] = [];
  /** Where the video starts showing the tutorial (after the canvas has loaded). */
  startAt = 0;
  /** When the sync mark went up (render.mjs finds it in the video). */
  markAt = 0;
  /** Every sync mark (ms): render.mjs lines the video up at each, since the recorder's clock drifts under load. */
  marks: number[] = [];

  constructor(
    readonly h: Helpers,
    readonly packDir: string,
    readonly params: Record<string, unknown> = {},
  ) {
    this.page = h.page;
    this.lines = voiceLines(packDir);
  }

  /** The ComfyUI address the take runs against. */
  get origin(): string {
    return this.h.baseURL ? new URL(this.h.baseURL).origin : "http://127.0.0.1:8189";
  }

  private now(): number {
    return Date.now() - this.t0;
  }

  // ---- narration ---------------------------------------------------------------------------

  /** Shows a narration line and starts its voice; returns while it is spoken. */
  async say(text: string): Promise<void> {
    await this.waitVoice();
    const id = lineId(text);
    const known = this.lines[id];
    const ms = known?.ms ?? estimate(text);
    const at = this.now();
    this.cues.push({ id, text, at, ms, voiced: !!known });
    // Each line also flashes the sync mark (render.mjs paints it out), so the voice can't drift from the picture.
    const mark = at - (this.marks[this.marks.length - 1] ?? -Infinity) > 900;
    if (mark) this.marks.push(at);
    this.busyUntil = Date.now() + ms + 350;
    this.leadUntil = Date.now() + Math.min(ms * 0.45, 2200);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.caption = { text, until: Date.now() + ms + 500 };
    await this.page
      .evaluate(
        ({ t, mark }) => {
          window.__tut?.caption(t);
          if (mark) window.__tut?.mark(400);
        },
        { t: text, mark },
      )
      .catch(() => undefined);
    this.hideTimer = setTimeout(() => {
      this.caption = null;
      void this.page.evaluate(() => window.__tut?.caption("")).catch(() => undefined);
    }, ms + 500);
    this.h.log(`say ${id}: ${text}`);
  }

  /** Waits until the line being spoken has finished. */
  async waitVoice(): Promise<void> {
    const left = this.busyUntil - Date.now();
    if (left > 0) await sleep(left);
  }

  /** A short beat, so the viewer can look at what just changed. */
  beat(ms = 700): Promise<void> {
    return sleep(ms);
  }

  /** Waits for the voice, clears captions and callouts, and saves the cues with the attempt. */
  async done(): Promise<void> {
    await this.waitVoice();
    await sleep(600);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    await this.page.evaluate(() => window.__tut?.clear()).catch(() => undefined);
    await sleep(900);
    const missing = this.cues.filter((c) => !c.voiced).length;
    await this.syncMark();
    if (missing) this.h.note(`${missing} line(s) have no voice yet: run python tutorials/voice/speak.py and record again.`);
    await this.h.file("cues.json", JSON.stringify({ t0: this.t0, mark: this.markAt, start: this.startAt, cues: this.cues, fast: this.fast, marks: this.marks, ended: this.now() }, null, 1), "application/json");
  }

  /** Marks the start of the tutorial: the video before it (loading the page) is cut. */
  async begin(): Promise<void> {
    await this.page.mouse.move(this.pos.x, this.pos.y);
    await sleep(500);
    await this.syncMark();
    this.markAt = this.marks[0] ?? 0;
    await sleep(300);
    this.startAt = this.now();
    await sleep(600);
  }

  /** Flashes the sync mark and notes when; render.mjs finds each one in the video. */
  async syncMark(): Promise<void> {
    const last = this.marks[this.marks.length - 1];
    if (last !== undefined) await sleep(Math.max(0, last + 900 - this.now()));
    this.marks.push(this.now());
    await this.page.evaluate(() => window.__tut?.mark(400)).catch(() => undefined);
    await sleep(400 + 600);
  }

  /** Runs `fn`; the final video plays that part `speed` times faster (a long wait, a model run), or cuts it out with speed 0. */
  async fastForward<T>(fn: () => Promise<T>, speed = 6): Promise<T> {
    // A caption still on screen would flash past (or be cut) in the video, so let the line finish first.
    await this.waitVoice();
    if (this.caption) await sleep(Math.max(0, this.caption.until - Date.now()));
    const from = this.now();
    try {
      return await fn();
    } finally {
      // A mark inside the sped-up part, where nobody sees it, re-lines the voice up after every wait.
      await this.syncMark();
      this.fast.push({ from, to: this.now(), speed });
    }
  }

  // ---- the hand ------------------------------------------------------------------------------

  /** Holds the first action after a line until the voice is partway into it. */
  private async lead(): Promise<void> {
    const left = this.leadUntil - Date.now();
    this.leadUntil = 0;
    if (left > 0) await sleep(left);
  }

  /** Moves the pointer to a point along a gentle curve, about as fast as a hand. */
  async moveTo(to: Point, { speed = 1 }: { speed?: number } = {}): Promise<void> {
    await this.lead();
    const from = this.pos;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    const ms = Math.min(1100, 260 + dist * 0.55) / speed;
    const steps = Math.max(8, Math.round(ms / 16));
    // A slight bow to one side, like a wrist turning.
    const bow = Math.min(60, dist * 0.08);
    const nx = -dy / dist;
    const ny = dx / dist;
    for (let i = 1; i <= steps; i++) {
      const t = easeInOut(i / steps);
      const arc = Math.sin(Math.PI * t) * bow;
      await this.page.mouse.move(from.x + dx * t + nx * arc, from.y + dy * t + ny * arc);
      await sleep(ms / steps);
    }
    this.pos = { ...to };
  }

  /** The middle of a locator on screen (waits for it to be visible). */
  async centre(target: Locator, offset: Partial<Point> = {}): Promise<Point> {
    await target.waitFor({ state: "visible", timeout: 15_000 });
    const box = await target.boundingBox();
    if (!box) throw new StepError("The part to point at isn't on screen.");
    return { x: box.x + (offset.x ?? box.width / 2), y: box.y + (offset.y ?? box.height / 2) };
  }

  /** Moves to the target and clicks it. */
  async click(target: Locator | Point, { double = false, right = false }: { double?: boolean; right?: boolean } = {}): Promise<void> {
    const isPoint = "x" in target && "y" in target && typeof target.x === "number";
    if (!isPoint) await this.bringIntoView(target as Locator);
    const at = isPoint ? (target as Point) : await this.centre(target as Locator);
    await this.moveTo(at);
    await sleep(140);
    const button = right ? "right" : "left";
    await this.page.mouse.down({ button });
    await sleep(70);
    await this.page.mouse.up({ button });
    if (double) {
      // clickCount 2 makes the browser fire dblclick (DOM listeners need it; LiteGraph times clicks itself).
      await sleep(90);
      await this.page.mouse.down({ clickCount: 2 });
      await sleep(60);
      await this.page.mouse.up({ clickCount: 2 });
    }
    await sleep(260);
  }

  /** Scrolls a part into view first when it sits under the page's edges (a sticky footer, the caption). */
  private async bringIntoView(target: Locator): Promise<void> {
    // On the ComfyUI canvas the wheel zooms instead of scrolling, so leave the view alone there.
    if (!this.inManager()) return;
    await target.waitFor({ state: "attached", timeout: 15_000 });
    const view = this.page.viewportSize() ?? { width: 1920, height: 1080 };
    const box = await target.boundingBox();
    if (box && (box.y < 60 || box.y + box.height > view.height - 170)) await this.scrollTo(target, { at: 0.4 });
  }

  /** Points at a target (hover), without clicking. */
  async hover(target: Locator): Promise<void> {
    await this.moveTo(await this.centre(target));
    await sleep(300);
  }

  /** Drags from one point to another with the button held (a wire, a node move). */
  async drag(from: Point, to: Point): Promise<void> {
    await this.moveTo(from);
    await sleep(160);
    await this.page.mouse.down();
    await sleep(120);
    await this.moveTo(to, { speed: 0.8 });
    await sleep(160);
    await this.page.mouse.up();
    await sleep(300);
  }

  /** Types like a person: one key at a time. */
  async type(text: string, { cps = 22 }: { cps?: number } = {}): Promise<void> {
    await this.lead();
    await this.page.keyboard.type(text, { delay: Math.round(1000 / cps) });
    await sleep(300);
  }

  async press(key: string): Promise<void> {
    await this.lead();
    await sleep(120);
    await this.page.keyboard.press(key);
    await sleep(250);
  }

  /**
   * Picks an option in a native drop-down. Its own pop-up list isn't in the recording, so the hand
   * goes to it and the value changes in place.
   */
  async choose(select: Locator, value: string): Promise<void> {
    await this.moveTo(await this.centre(select));
    await sleep(250);
    await select.selectOption(value);
    await sleep(600);
  }

  /** Clicks a field, clears it and types `text` into it. */
  async fill(target: Locator, text: string, { cps = 22 }: { cps?: number } = {}): Promise<void> {
    await this.click(target);
    await this.page.keyboard.press("ControlOrMeta+A");
    await this.page.keyboard.press("Backspace");
    await this.type(text, { cps });
  }

  /**
   * Scrolls with the wheel, the pointer over the part that scrolls, until `target`'s top sits in
   * the upper part of the screen (`at`, a share of the height). Already there: no scroll.
   */
  /** Whether the page is the manager (`/wp/…`), where the wheel scrolls; on the canvas it zooms. */
  private inManager(): boolean {
    return new URL(this.page.url()).pathname.startsWith("/wp");
  }

  async scrollTo(target: Locator, { at = 0.22 }: { at?: number } = {}): Promise<void> {
    if (!this.inManager()) return;
    await target.waitFor({ state: "attached", timeout: 15_000 });
    const view = this.page.viewportSize() ?? { width: 1920, height: 1080 };
    let first = await target.boundingBox();
    if (!first) return;
    if (first.y >= 90 && first.y <= view.height * 0.55) return;
    // Scroll from a point on the straight line to the part, so the hand never detours to a
    // corner and turns: it heads for the part, wheels on the way, then finishes the move.
    const aim = { x: Math.min(view.width - 60, Math.max(60, first.x + first.width / 2)), y: Math.min(view.height - 200, Math.max(120, first.y + first.height / 2)) };
    const share = Math.hypot(aim.x - this.pos.x, aim.y - this.pos.y) > 40 ? 0.6 : 1;
    await this.moveTo({ x: this.pos.x + (aim.x - this.pos.x) * share, y: this.pos.y + (aim.y - this.pos.y) * share });
    let last = first.y;
    let stuck = 0;
    for (let i = 0; i < 60; i++) {
      const box = await target.boundingBox();
      if (!box) break;
      const dy = box.y - view.height * at;
      if (Math.abs(dy) < 12) break;
      await this.page.mouse.wheel(0, Math.sign(dy) * Math.min(Math.abs(dy), 120));
      await sleep(60);
      const now = (await target.boundingBox())?.y ?? box.y;
      stuck = Math.abs(now - last) < 1 ? stuck + 1 : 0;
      if (stuck >= 3) break;
      last = now;
    }
    await sleep(400);
  }

  /**
   * Opens a page of ComfyUI (`/`, which comes up empty, like at the start) or the manager
   * (`/wp/…`). The page load is cut out of the video, after the line being spoken has finished.
   */
  async go(pathname: string): Promise<void> {
    await this.fastForward(async () => {
      await this.page.goto(`${this.origin}${pathname}`, { waitUntil: "domcontentloaded" });
      if (pathname === "/" || pathname === "") {
        await this.page.waitForFunction(() => !!window.app?.graph && !!window.LiteGraph, null, { timeout: 120_000 });
        await sleep(1500);
        await clearCanvas(this.page);
      } else {
        await this.page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
        // The manager paints its page a moment after the network goes quiet; leaving the cut
        // before that showed a black frame (L05 at Settings › Advanced).
        await this.page
          .waitForFunction(() => document.querySelectorAll("[data-test]").length > 3, null, { timeout: 10_000 })
          .catch(() => undefined);
        await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
        await sleep(600);
      }
      await this.page.mouse.move(this.pos.x, this.pos.y);
    }, 0);
    const c = this.caption;
    if (c && c.until > Date.now()) await this.page.evaluate((t) => window.__tut?.caption(t), c.text).catch(() => undefined);
    await sleep(300);
  }

  // ---- callouts ------------------------------------------------------------------------------

  /** Draws a box around a part of the screen with an optional label; `uncallout` removes it. */
  async callout(id: string, target: Locator | Locator[], label?: string, pad = 0): Promise<void> {
    const boxes = [];
    for (const one of Array.isArray(target) ? target : [target]) {
      await one.waitFor({ state: "visible", timeout: 15_000 });
      const b = await shownBox(one);
      if (b) boxes.push(b);
    }
    if (!boxes.length) return;
    const x = Math.min(...boxes.map((b) => b.x)) - pad;
    const y = Math.min(...boxes.map((b) => b.y)) - pad;
    const box = {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) + pad - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) + pad - y,
    };
    await this.page.evaluate(([i, b, l]) => window.__tut?.callout(i, b, l), [id, box, label ?? ""] as const);
    this.follow(id, Array.isArray(target) ? target : [target], pad);
  }

  /** Callouts being kept on their part: the box follows it as it moves or resizes, and goes when it does. */
  private followers = new Map<string, ReturnType<typeof setInterval>>();

  private follow(id: string, targets: Locator[], pad: number): void {
    this.stopFollowing(id);
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        const boxes = [];
        for (const one of targets) {
          // Seen means really seen: a part fading out (opacity 0) or hidden counts as gone.
          const seen = await one
            .evaluate(
              (el) => {
                if (!(el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
                // Also on top where it sits: a copy left behind a newer layer, or off screen, isn't seen.
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return !hit || el === hit || el.contains(hit);
              },
              undefined,
              { timeout: 200 },
            )
            .catch(() => false);
          const b = seen ? await shownBox(one, 200) : null;
          if (b && b.width > 0 && b.height > 0) boxes.push(b);
        }
        if (!this.followers.has(id)) return;
        if (!boxes.length) {
          // The part is gone (a toast that faded, a closed menu): the box goes with it.
          this.stopFollowing(id);
          await this.page.evaluate((i) => window.__tut?.uncallout(i), id).catch(() => undefined);
          return;
        }
        const x = Math.min(...boxes.map((b) => b.x)) - pad;
        const y = Math.min(...boxes.map((b) => b.y)) - pad;
        const rect = { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) + pad - x, height: Math.max(...boxes.map((b) => b.y + b.height)) + pad - y };
        await this.page.evaluate(([i, r]) => window.__tut?.recallout(i, r), [id, rect] as const).catch(() => undefined);
      })().finally(() => (busy = false));
    }, 250);
    this.followers.set(id, timer);
  }

  private stopFollowing(id: string): void {
    const timer = this.followers.get(id);
    if (timer) clearInterval(timer);
    this.followers.delete(id);
  }

  async uncallout(id: string): Promise<void> {
    this.stopFollowing(id);
    await this.page.evaluate((i) => window.__tut?.uncallout(i), id);
  }

  // ---- the canvas ----------------------------------------------------------------------------

  /** A node on the canvas (Vue nodes mode). */
  node(id: string | number): Locator {
    return this.page.locator(`[data-node-id="${id}"]`);
  }

  /**
   * Opens a Context node's Add module picker, ticks the named library items and adds them.
   * A name matches the row whose name is exactly it ("Hero", not "Hero fits the place").
   */
  async pickModules(ctxId: string, names: string[]): Promise<void> {
    await this.click(this.node(ctxId).locator('[data-testid="open-picker"]'));
    const page = this.page;
    for (const name of names) {
      const row = page.locator('[data-test^="picker-row-"]').filter({ has: page.getByText(name, { exact: true }) }).first();
      // Rows far down the list aren't drawn until scrolled to: search for those, as a person would.
      const search = page.locator('[data-testid="picker-search"] input, input[data-testid="picker-search"]').first();
      const shown = (await row.count()) > 0;
      if (shown) await this.scrollInList(row, page.locator(".wp-picker__body").first());
      else {
        await this.click(search);
        await this.type(name, { cps: 18 });
        await sleep(600);
      }
      for (let tries = 0; tries < 2; tries++) {
        await this.click(row.locator('[data-test="picker-checkbox"]').first());
        if ((await row.getAttribute("data-checked")) !== null) break;
        await sleep(400);
      }
      if ((await row.getAttribute("data-checked")) === null) throw new StepError(`Couldn't tick "${name}" in the picker.`);
      if (!shown) {
        // Escape in a search box with text clears it (and keeps the picker open).
        await this.click(search);
        await this.press("Escape");
        await sleep(400);
      }
    }
    await sleep(300);
    await this.click(page.locator('[data-test="picker-add-btn"]'));
    await sleep(800);
  }

  /** Wheel-scrolls a scrolling list (`list`) until `row` sits fully inside it. */
  async scrollInList(row: Locator, list: Locator): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const rb = await row.boundingBox();
      const lb = await list.boundingBox();
      if (!rb || !lb) return;
      const above = rb.y < lb.y + 4;
      const below = rb.y + rb.height > lb.y + lb.height - 4;
      if (!above && !below) break;
      if (i === 0) await this.moveTo({ x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 });
      const dy = below ? rb.y + rb.height - (lb.y + lb.height) + 24 : rb.y - lb.y - 24;
      await this.page.mouse.wheel(0, Math.sign(dy) * Math.min(Math.abs(dy), 120));
      await sleep(80);
    }
    await sleep(250);
  }

  /** A module row on a Context node, by the module's name. */
  moduleRow(ctxId: string, name: string): Locator {
    const exact = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
    return this.node(ctxId).locator(".wp-module").filter({ has: this.page.locator(".wp-module-name", { hasText: exact }) }).first();
  }

  /** Clicks the globe on these module rows, so their variables stay out of the prompt. */
  /** Opens folded bundle frames on a Context node (sub-bundles too), or only inside the bundle `name`. */
  async expandBundles(ctxId: string, name?: string): Promise<void> {
    const scope = name ? this.bundleFrame(ctxId, name) : this.node(ctxId);
    for (let i = 0; i < 12; i++) {
      const fold = scope.getByRole("button", { name: "Expand bundle" }).first();
      if (!(await fold.count())) return;
      await this.click(fold);
      await sleep(450);
    }
  }

  /** Folds the bundle `name` on a Context node when it is open. */
  async foldBundle(ctxId: string, name: string): Promise<void> {
    const header = this.node(ctxId).locator(".wp-bundle-header").filter({ hasText: name }).first();
    const btn = header.getByRole("button", { name: "Collapse bundle" });
    if (await btn.count()) {
      await this.click(btn.first());
      await sleep(500);
    }
  }

  /** The frame of a bundle (or sub-bundle) on a Context node, by its name. */
  bundleFrame(ctxId: string, name: string): Locator {
    return this.node(ctxId).locator(".wp-bundle").filter({ has: this.page.locator(".wp-bundle-header").filter({ hasText: name }) }).last();
  }

  async hide(ctxId: string, names: string[]): Promise<void> {
    for (const name of names) {
      await this.click(this.moduleRow(ctxId, name).locator('[data-test="row-action-internal"]'));
      await sleep(450);
    }
  }

  /** Node ids on the canvas now. */
  private async nodeIds(): Promise<string[]> {
    return this.page.evaluate(() => (window.app?.graph?.nodes ?? []).map((n) => String(n.id)));
  }

  /**
   * Adds a node the way a person does: double-click empty canvas at `at`, type `search`, Enter,
   * then click to drop it there. Returns the new node's id.
   */
  /**
   * Off camera: removes what earlier videos of the same run added to the library (items, bundles,
   * templates and categories that library.json doesn't have), so a video that lists the library
   * shows it as a viewer has it after importing library.json.
   */
  async tidyLibrary(): Promise<void> {
    const want = JSON.parse(readFileSync(path.join(this.packDir, "library.json"), "utf8")) as Record<string, unknown>;
    const ids = new Set<string>();
    for (const v of Object.values(want)) if (Array.isArray(v)) for (const x of v as { id?: unknown }[]) if (typeof x?.id === "string") ids.add(x.id);
    const lib = await this.h.library();
    for (const x of lib.bundles) if (!ids.has(x.id)) await this.h.api(`/wp/api/bundles/${x.id}`, { method: "DELETE" });
    for (const x of lib.templates) if (!ids.has(x.id)) await this.h.api(`/wp/api/templates/${x.id}`, { method: "DELETE" });
    for (const x of lib.modules) if (!ids.has(x.id)) await this.h.api(`/wp/api/modules/${x.id}`, { method: "DELETE" });
    const cats = await this.h.api("/wp/api/categories");
    const catList = (cats.json?.items ?? cats.json ?? []) as { id: string }[];
    for (const c of catList) if (!ids.has(c.id)) await this.h.api(`/wp/api/categories/${c.id}`, { method: "DELETE" });
  }

  async addNode(search: string, wanted: Point): Promise<string> {
    const before = new Set(await this.nodeIds());
    // The double click must land on empty canvas. A node that grew (a preview row, a longer list)
    // or a floating panel can cover the planned point: then drop the new node just below it.
    const at = await this.page.evaluate((p) => {
      let { x, y } = p;
      for (let i = 0; i < 4; i++) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.tagName === "CANVAS" || el.classList.contains("lgraphcanvas")) break;
        // A node, or a panel floating over the canvas (the bookmark dock): go below it.
        const hit = el.closest("[data-node-id]") ?? el;
        y = hit.getBoundingClientRect().bottom + 40;
      }
      return { x, y: Math.min(y, window.innerHeight - 60) };
    }, wanted);
    // The search box opens on a double click on empty canvas; when the click is taken for something
    // else (a click just before it), try once more rather than typing into the canvas.
    const searchOpen = () =>
      this.page.evaluate(() => {
        // Only the node search box counts: a focused field on a node would take the typed name.
        const el = document.activeElement;
        return el?.tagName === "INPUT" && !el.closest("[data-node-id]") && !!el.closest('[role="dialog"], .comfy-vue-node-search-container, .p-dialog, .litesearchbox');
      });
    // A field just typed into (a Text node's box) keeps the focus, and the canvas then takes the
    // first click as a blur: let go of it first, so the double click reaches the canvas.
    await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await this.click(at, { double: true });
    await sleep(500);
    if (!(await searchOpen())) {
      await sleep(600);
      await this.click(at, { double: true });
      await sleep(600);
      if (!(await searchOpen())) throw new StepError(`The node search didn't open at ${Math.round(at.x)}, ${Math.round(at.y)}.`);
    }
    await this.type(search, { cps: 16 });
    await sleep(700);
    await this.press("Enter");
    await sleep(400);
    // The new node follows the pointer until a click drops it.
    await this.moveTo({ x: at.x + 6, y: at.y + 4 }, { speed: 2 });
    await this.click({ x: at.x + 6, y: at.y + 4 });
    await sleep(600);
    const added = (await this.nodeIds()).filter((id) => !before.has(id));
    if (added.length !== 1) throw new StepError(`Adding "${search}" made ${added.length} new node(s).`);
    const id = added[0] as string;
    // A seed that changes after each run would make the video disagree with its narration.
    await this.page.evaluate((nid) => {
      const node = window.app?.graph?.getNodeById(nid) as { widgets?: { name: string; value: unknown; linkedWidgets?: { name: string; value: unknown }[] }[] } | null | undefined;
      for (const w of node?.widgets ?? []) {
        if (w.name === "control_after_generate") w.value = "fixed";
        for (const l of w.linkedWidgets ?? []) if (l.name === "control_after_generate") l.value = "fixed";
      }
    }, id);
    return id;
  }

  /** The on-screen centre of a node's slot dot, by the slot's name. */
  async slot(nodeId: string, side: "in" | "out", name: string): Promise<Point> {
    const index = await this.page.evaluate(
      ([id, s, n]) => {
        const node = window.app?.graph?.getNodeById(id) ?? window.app?.graph?.getNodeById(Number(id));
        const list = (s === "in" ? node?.inputs : node?.outputs) ?? [];
        return list.findIndex((x) => x.name === n);
      },
      [nodeId, side, name] as const,
    );
    if (index < 0) throw new StepError(`Node ${nodeId} has no ${side === "in" ? "input" : "output"} "${name}".`);
    // Inside the node itself: the node search's preview card can hold a copy of the same key.
    return this.centre(this.node(nodeId).locator(`[data-slot-key="${nodeId}-${side}-${index}"]`).first());
  }

  /** Drags a wire from one node's output to another node's input. */
  async wire(fromId: string, output: string, toId: string, input: string): Promise<void> {
    const from = await this.slot(fromId, "out", output);
    const to = await this.slot(toId, "in", input);
    await this.drag(from, to);
    const isLinked = () =>
      this.page.evaluate(
        ([id, n]) => {
          const node = window.app?.graph?.getNodeById(id) ?? window.app?.graph?.getNodeById(Number(id));
          return (node?.inputs ?? []).some((x) => x.name === n && x.link != null);
        },
        [toId, input] as const,
      );
    if (await isLinked()) return;
    // A widget input's dot can sit apart from its slot key (a KSampler's sampler_name): drop the
    // wire just left of the input's label instead.
    const label = await this.node(toId).getByText(input, { exact: true }).first().boundingBox().catch(() => null);
    if (label) {
      await this.drag(from, { x: label.x - 8, y: label.y + label.height / 2 });
      if (await isLinked()) return;
    }
    throw new StepError(`The wire into ${input} didn't connect.`);
  }

  /** Presses Run and waits until the queue is empty again. */
  async run(): Promise<void> {
    await this.click(this.page.getByRole("button", { name: "Run", exact: true }).first());
    await sleep(800);
    const end = await this.h.waitUntil(
      async () => {
        const q = await this.h.api("/queue");
        const j = q.json as { queue_running?: unknown[]; queue_pending?: unknown[] } | undefined;
        return !!j && (j.queue_running?.length ?? 0) === 0 && (j.queue_pending?.length ?? 0) === 0;
      },
      { timeout: 10 * 60_000, interval: 500, what: "the run to finish" },
    );
    if (end !== "done") throw new StepError("The run didn't finish.");
    await sleep(600);
  }
}

// ---- showcase: real images from the prompt -------------------------------------------------------

export interface ShowcaseOptions {
  /** The node whose `prompt` (and `negative`) outputs feed the sampler. */
  from?: string;
  /** A fixed prompt instead of `from`'s, for a take with no Assembler. */
  prompt?: string;
  /** A KSampler already on the canvas, its latent (and maybe sampler) wired by the take: the chain
   *  feeds it instead of making its own latent and sampler. */
  sampler?: string;
  /** Where the image preview goes (its top-left corner on screen) and how big it is. */
  preview: Point & { width?: number; height?: number };
  /** Where the small, folded loader + sampler stack goes. */
  chain: Point;
  /** How many runs. */
  runs?: number;
  /** Before each run after the first: change something on screen (a new seed, a switch). */
  between?: (i: number) => Promise<void>;
}

/** Screen point → graph position, at the canvas's current pan and zoom. */
async function toGraph(page: Page, p: Point): Promise<[number, number]> {
  return page.evaluate(([x, y]) => {
    const app = window.app as unknown as { canvas: { ds: { scale: number; offset: [number, number] }; canvas: HTMLCanvasElement } };
    const r = app.canvas.canvas.getBoundingClientRect();
    const { scale, offset } = app.canvas.ds;
    return [(x - r.left) / scale - offset[0], (y - r.top) / scale - offset[1]] as [number, number];
  }, [p.x, p.y] as const);
}

/**
 * Adds a WP Debug node under a Context node and wires the Context into it, the way a person does,
 * so each run shows the picks that went into its picture. Returns the Debug node's id.
 */
export async function addDebugUnder(t: Tutor, ctxId: string): Promise<string> {
  const view = t.page.viewportSize() ?? { width: 1920, height: 1080 };
  let box = await t.node(ctxId).boundingBox();
  // A tall Context leaves no room under it: fold its rows (Debug shows the picks anyway).
  if (box && box.y + box.height > view.height - 470) {
    await t.click(t.node(ctxId).getByRole("button", { name: "Collapse all modules" }).first());
    await sleep(600);
    box = await t.node(ctxId).boundingBox();
  }
  const x = box ? box.x + box.width / 2 : 520;
  const below = box ? box.y + box.height + 40 : 600;
  const y = Math.min(below + 100, view.height - 320);
  const dbg = await t.addNode("WP Debug", { x, y });
  // Snug under the Context (the drop point centres it, which can leave a gap or overlap).
  await t.page.evaluate(
    ({ ctxId, dbg }) => {
      type N = { pos: [number, number]; size: [number, number] };
      const app = window.app as unknown as { graph: { getNodeById(id: string | number): N | null }; canvas: { setDirty(a: boolean, b: boolean): void } };
      const get = (id: string) => app.graph.getNodeById(id) ?? app.graph.getNodeById(Number(id));
      const c = get(ctxId);
      const d = get(dbg);
      if (!c || !d) return;
      d.pos = [c.pos[0], c.pos[1] + c.size[1] + 70];
      app.canvas.setDirty(true, true);
    },
    { ctxId, dbg },
  );
  await sleep(300);
  await t.wire(ctxId, "context", dbg, "context");
  t.debugId = dbg;
  await fitDebug(t);
  return dbg;
}

/** Keeps WP Debug's bottom above the caption; a run fills it with rows and it grows, so showcase calls this after each run (it scrolls inside). */
export async function fitDebug(t: Tutor): Promise<void> {
  const dbg = t.debugId;
  if (!dbg) return;
  const view = t.page.viewportSize() ?? { width: 1920, height: 1080 };
  const top = (await t.node(dbg).boundingBox())?.y;
  if (top === undefined) return;
  const room = view.height - 165 - top;
  await t.page.evaluate(
    ({ id, room }) => {
      const app = window.app as unknown as { graph: { getNodeById(id: string | number): { size: [number, number] } | null }; canvas: { ds: { scale: number }; setDirty(a: boolean, b: boolean): void } };
      const n = app.graph.getNodeById(id) ?? app.graph.getNodeById(Number(id));
      if (!n) return;
      n.size = [n.size[0], Math.max(130, room / app.canvas.ds.scale)];
      app.canvas.setDirty(true, true);
    },
    { id: dbg, room },
  );
  await sleep(300);
}

/** Whether takes make real images (the pack's `showcase` setting; it needs a model, so it's off in the cloud). */
export function showcasing(t: Tutor): boolean {
  return t.params.showcase === true;
}

/**
 * Wires the prompt into a checkpoint, sampler and image preview, runs it `runs` times and lets each
 * image land on screen. The stack of loader, encoders and sampler is built folded, since the video
 * is about the prompt; the narration around it is the test's. Returns the preview node's id.
 */
/** Finds a model file in ComfyUI's list for one loader input, ignoring the slash kind and the file ending. */
export async function modelFile(t: Tutor, node: string, input: string, wanted: string, folder: string): Promise<string> {
  const info = await t.h.api(`/object_info/${node}`);
  const list = ((info.json as Record<string, { input?: { required?: Record<string, [unknown]> } }> | undefined)?.[node]?.input?.required?.[input]?.[0] ?? []) as string[];
  const norm = (k: string) => k.replace(/\\/g, "/").replace(/\.(safetensors|ckpt|gguf)$/i, "").toLowerCase();
  const name = list.find((k) => norm(k) === norm(wanted));
  if (!name) throw new StepError(`"${wanted}" isn't in ComfyUI's models/${folder}. It has: ${list.slice(0, 8).join(", ") || "none"}.`);
  return name;
}

export async function showcase(t: Tutor, o: ShowcaseOptions): Promise<string> {
  // A diffusion model (Flux 3 Klein by default) with its own text encoder and VAE, or a checkpoint.
  const unet = String(t.params.unet ?? "");
  const models = unet
    ? {
        unet: await modelFile(t, "UNETLoader", "unet_name", unet, "diffusion_models"),
        clip: await modelFile(t, "CLIPLoader", "clip_name", String(t.params.clip ?? ""), "text_encoders"),
        clipType: String(t.params.clipType ?? "flux3"),
        vae: await modelFile(t, "VAELoader", "vae_name", String(t.params.vae ?? ""), "vae"),
        ckpt: "",
      }
    : { unet: "", clip: "", clipType: "", vae: "", ckpt: await modelFile(t, "CheckpointLoaderSimple", "ckpt_name", String(t.params.checkpoint ?? ""), "checkpoints") };
  const chainAt = await toGraph(t.page, o.chain);
  const previewAt = await toGraph(t.page, o.preview);
  const steps = Number(t.params.steps ?? 12);
  const cfg = Number(t.params.cfg ?? (unet ? 1 : 5));
  const image = [Number(t.params.width ?? 1024), Number(t.params.height ?? 1280)] as [number, number];
  const previewId = await t.page.evaluate(
    ({ from, prompt, ownSampler, models, chainAt, previewAt, size, steps, cfg, image }) => {
      type LNode = {
        id: number;
        pos: [number, number];
        size: [number, number];
        flags: { collapsed?: boolean };
        widgets?: { name: string; value: unknown }[];
        inputs?: { name: string }[];
        outputs?: { name: string }[];
        connect(slot: number, target: LNode, targetSlot: number): unknown;
      };
      const LG = window.LiteGraph as { createNode(type: string): LNode };
      const graph = (window.app as unknown as { graph: { add(n: LNode): void; getNodeById(id: string | number): LNode | null } }).graph;
      const src = from ? (graph.getNodeById(from) ?? graph.getNodeById(Number(from))) : null;
      if (!src && !prompt) throw new Error("no prompt node");
      const own = ownSampler ? graph.getNodeById(Number(ownSampler)) : null;
      const make = (type: string, x: number, y: number, fold = true) => {
        const n = LG.createNode(type);
        n.pos = [x, y];
        graph.add(n);
        if (fold) n.flags.collapsed = true;
        return n;
      };
      const set = (n: LNode, w: string, v: unknown) => {
        const widget = n.widgets?.find((x) => x.name === w);
        if (widget) widget.value = v;
      };
      const inIdx = (n: LNode, s: string) => (n.inputs ?? []).findIndex((x) => x.name === s);
      const outIdx = (n: LNode, s: string) => (n.outputs ?? []).findIndex((x) => x.name === s);
      const link = (a: LNode, out: string, b: LNode, inp: string) => {
        const i = outIdx(a, out);
        const j = inIdx(b, inp);
        if (i < 0 || j < 0) throw new Error(`can't wire ${out} → ${inp}`);
        a.connect(i, b, j);
      };
      const [cx, cy] = chainAt;
      // Loader outputs as [node, output name], so both model kinds wire the same way below.
      let modelOut: [LNode, string];
      let clipOut: [LNode, string];
      let vaeOut: [LNode, string];
      if (models.unet) {
        const unetNode = make("UNETLoader", cx, cy);
        set(unetNode, "unet_name", models.unet);
        const clipNode = make("CLIPLoader", cx, cy + 25);
        set(clipNode, "clip_name", models.clip);
        set(clipNode, "type", models.clipType);
        const vaeNode = make("VAELoader", cx, cy + 50);
        set(vaeNode, "vae_name", models.vae);
        modelOut = [unetNode, "MODEL"];
        clipOut = [clipNode, "CLIP"];
        vaeOut = [vaeNode, "VAE"];
      } else {
        const load = make("CheckpointLoaderSimple", cx, cy);
        set(load, "ckpt_name", models.ckpt);
        modelOut = [load, "MODEL"];
        clipOut = [load, "CLIP"];
        vaeOut = [load, "VAE"];
      }
      const pos = make("CLIPTextEncode", cx, cy + 75);
      // Klein runs at cfg 1, where a negative does nothing: it gets the zeroed positive, as in its own workflow.
      const neg = models.unet ? make("ConditioningZeroOut", cx, cy + 100) : make("CLIPTextEncode", cx, cy + 100);
      const latent = own ? null : make(models.unet ? "EmptyFlux2LatentImage" : "EmptyLatentImage", cx, cy + 150);
      if (latent) {
        set(latent, "width", image[0]);
        set(latent, "height", image[1]);
      }
      const sampler = own ?? make("KSampler", cx, cy + 200);
      set(sampler, "steps", steps);
      set(sampler, "cfg", cfg);
      if (!own) set(sampler, "sampler_name", models.unet ? "euler" : "euler_ancestral");
      set(sampler, "scheduler", models.unet ? "simple" : "normal");
      set(sampler, "seed", 1234);
      for (const w of sampler.widgets ?? []) if (w.name === "control_after_generate") w.value = "fixed";
      const decode = make("VAEDecode", cx, cy + 250);
      // Keep the preview clear of the nodes already on screen (their real height depends on the
      // fonts and the template's length), and inside the view above the caption.
      const title = (window.LiteGraph as unknown as { NODE_TITLE_HEIGHT?: number }).NODE_TITLE_HEIGHT ?? 30;
      const others = (graph as unknown as { _nodes: LNode[] })._nodes.filter((n) => !n.flags.collapsed);
      const view = (window.app as unknown as { canvas: { ds: { scale: number; offset: [number, number] }; canvas: HTMLCanvasElement } }).canvas;
      const box = view.canvas.getBoundingClientRect();
      const viewBottom = (box.height - 150) / view.ds.scale - view.ds.offset[1];
      const viewRight = (box.width - 30) / view.ds.scale - view.ds.offset[0];
      let [px, py] = previewAt;
      let [pw, ph] = size;
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const n of others) {
          const top = n.pos[1] - title;
          const bottom = n.pos[1] + n.size[1];
          const apart = px + pw <= n.pos[0] || n.pos[0] + n.size[0] <= px || py + ph <= top || bottom <= py - title;
          if (apart) continue;
          moved = true;
          // Beside it or under it, whichever shows the (square-ish) image bigger.
          const right = n.pos[0] + n.size[0] + 30;
          const sideW = Math.min(pw, viewRight - right);
          const sideH = Math.min(viewBottom - py, (ph * sideW) / pw);
          const belowY = bottom + title + 30;
          const belowW = Math.min(Math.max(pw, n.size[0]), viewRight - n.pos[0]);
          const belowH = Math.min(ph, viewBottom - belowY);
          if (sideW >= 220 && Math.min(sideW, sideH) >= Math.min(belowW, belowH)) {
            px = right;
            pw = sideW;
            ph = Math.round(Math.max(220, sideH));
          } else {
            px = n.pos[0];
            py = belowY;
            pw = Math.round(belowW);
            ph = Math.round(Math.max(220, belowH));
          }
        }
        if (!moved) break;
      }
      if (py + ph > viewBottom) {
        const fit = Math.max(220, viewBottom - py);
        pw = Math.round((pw * fit) / ph);
        ph = fit;
      }
      const preview = make("PreviewImage", px, py, false);
      preview.size = [pw, ph];
      link(clipOut[0], clipOut[1], pos, "clip");
      if (src) link(src, "prompt", pos, "text");
      else set(pos, "text", prompt);
      if (models.unet) link(pos, "CONDITIONING", neg, "conditioning");
      else {
        link(clipOut[0], clipOut[1], neg, "clip");
        if (src && outIdx(src, "negative") >= 0) link(src, "negative", neg, "text");
      }
      link(modelOut[0], modelOut[1], sampler, "model");
      link(pos, "CONDITIONING", sampler, "positive");
      link(neg, "CONDITIONING", sampler, "negative");
      if (latent) link(latent, "LATENT", sampler, "latent_image");
      link(sampler, "LATENT", decode, "samples");
      link(vaeOut[0], vaeOut[1], decode, "vae");
      link(decode, "IMAGE", preview, "images");
      (window.app as unknown as { canvas: { setDirty(a: boolean, b: boolean): void } }).canvas.setDirty(true, true);
      return String(preview.id);
    },
    { from: o.from ?? "", prompt: o.prompt ?? "", ownSampler: o.sampler ?? "", models, chainAt, previewAt, size: [o.preview.width ?? 460, o.preview.height ?? 700] as [number, number], steps, cfg, image },
  );
  await t.beat(600);
  const runs = o.runs ?? 3;
  for (let i = 0; i < runs; i++) {
    if (i > 0 && o.between) await o.between(i);
    await t.fastForward(() => t.run(), 8);
    await fitDebug(t);
    await t.beat(1800);
  }
  return previewId;
}

// ---- the canvas start state ----------------------------------------------------------------------

/** Opens the ComfyUI canvas, empty, at 100 %, with the settings the videos are recorded with. */
export async function openCanvas(h: Helpers): Promise<void> {
  const origin = h.baseURL ? new URL(h.baseURL).origin : "http://127.0.0.1:8189";
  const page = h.page;
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.app?.graph && !!window.LiteGraph, null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const s = window.app?.extensionManager?.setting;
    if (!s) return;
    const set = (k: string, v: unknown) => s.set(k, v).catch(() => undefined);
    await set("Comfy.VueNodes.Enabled", true);
    // DOM widgets vanish below this font size when zoomed out.
    await set("LiteGraph.Canvas.MinFontSizeForLOD", 1);
    await set("Comfy.Minimap.Visible", false);
    await set("Comfy.Graph.CanvasInfo", false);
    await set("Comfy.TutorialCompleted", true);
  });
  // The templates dialog on a first visit, a sidebar left open.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await clearCanvas(page);
}

/** Empties the canvas and puts it at 100 %, with no pan. */
async function clearCanvas(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.evaluate(() => {
    const app = window.app;
    if (!app) return;
    app.graph.clear();
    app.canvas.ds.scale = 1;
    app.canvas.ds.offset = [0, 0];
    app.canvas.setDirty(true, true);
  });
  await page.waitForTimeout(800);
}

// ---- a tutorial ----------------------------------------------------------------------------------

export interface TutorialMeta extends TestMeta {
  /** What the viewer can do after watching, for the video's description. */
  learn?: string;
}

/** A tutorial: one test, one video. Retries are off; a broken take is recorded again. */
export function tutorial(id: string, meta: TutorialMeta, body: (t: Tutor) => Promise<void>): void {
  test(id, { runs: 1, section: "Tutorials", ...meta }, async ({ h, packDir, params }) => {
    const t = new Tutor(h, packDir, (params ?? {}) as Record<string, unknown>);
    await openCanvas(h);
    await t.begin();
    await body(t);
    await t.done();
  });
}

declare global {
  interface Window {
    __tut?: {
      mark(ms: number): void;
      caption(text: string): void;
      callout(id: string, rect: { x: number; y: number; width: number; height: number }, label: string): void;
      recallout(id: string, rect: { x: number; y: number; width: number; height: number }): void;
      uncallout(id: string): void;
      clear(): void;
    };
    // The bits of ComfyUI's page the presenter reads.
    app?: {
      graph: {
        nodes: { id: string | number; inputs?: { name: string; link: unknown }[]; outputs?: { name: string }[] }[];
        getNodeById(id: string | number): { id: string | number; inputs?: { name: string; link: unknown }[]; outputs?: { name: string }[] } | null;
        clear(): void;
      };
      canvas: { ds: { scale: number; offset: [number, number] }; setDirty(a: boolean, b: boolean): void };
      extensionManager?: { setting?: { set(k: string, v: unknown): Promise<void> } };
    };
    LiteGraph?: unknown;
  }
}

// ---- example workflows -----------------------------------------------------------------------------

/**
 * Opens one of the extension's example workflows from ComfyUI's Templates browser (Extensions ›
 * ComfyUI-Wildcard-Pipeline) and closes the missing-model card it raises when its checkpoint isn't
 * installed.
 */
export async function openExample(t: Tutor, title: string): Promise<void> {
  const page = t.page;
  await t.click(page.getByText("Templates", { exact: true }).first());
  await sleep(1500);
  const dialog = page.getByRole("dialog").last();
  // The extension's entry can sit below the fold of the dialog's nav, and its folder name differs
  // between a git clone and a Registry install.
  const entry = dialog.getByText(/^\s*comfyui[-_ ]wildcard[-_ ]pipeline\s*$/i).first();
  await entry.waitFor({ state: "attached", timeout: 15_000 });
  // Other installed packs list their templates beside ours even with custom nodes disabled: keep
  // them out of the video by hiding our entry's siblings in the nav (the recording only).
  await entry.evaluate((el) => {
    const item = el.closest(".cursor-pointer") ?? el.parentElement;
    for (const sib of Array.from(item?.parentElement?.children ?? [])) {
      if (sib !== item && sib.classList.contains("cursor-pointer")) (sib as HTMLElement).style.display = "none";
    }
  });
  await entry.scrollIntoViewIfNeeded();
  await sleep(400);
  await t.click(entry);
  await sleep(1200);
  const card = page.locator(`[data-testid="template-workflow-${title}"]`);
  await card.waitFor({ state: "attached", timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
  await sleep(400);
  await t.click(card);
  await page.waitForFunction(() => (window.app?.graph?.nodes?.length ?? 0) > 5, undefined, { timeout: 20_000 });
  await sleep(2500);
  const missing = page.getByRole("status").filter({ hasText: "is missing" });
  if ((await missing.count()) > 0) {
    await missing.first().getByRole("button").filter({ hasNotText: "View details" }).first().click().catch(() => undefined);
    await sleep(500);
  }
}

/** Points every Load Checkpoint at the pack's `checkpoint` (when ComfyUI has it). Returns whether it did. */
export async function useCheckpoint(t: Tutor): Promise<boolean> {
  const ckpt = String(t.params.checkpoint ?? "");
  if (!ckpt) return false;
  const info = await t.h.api("/object_info/CheckpointLoaderSimple");
  const known = ((info.json as Record<string, { input?: { required?: { ckpt_name?: [string[]] } } }> | undefined)?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []) as string[];
  const strip = (s: string) => s.replace(/\.(safetensors|ckpt)$/i, "");
  const name = known.find((k) => k === ckpt || strip(k) === strip(ckpt));
  if (!name) return false;
  await t.page.evaluate((n) => {
    type W = { name: string; value: unknown };
    const nodes = (window.app?.graph?.nodes ?? []) as unknown as { type: string; widgets?: W[] }[];
    for (const node of nodes) {
      if (node.type !== "CheckpointLoaderSimple") continue;
      const w = node.widgets?.find((x) => x.name === "ckpt_name");
      if (w) w.value = n;
    }
    window.app?.canvas?.setDirty(true, true);
  }, name);
  return true;
}

// ---- the AI assistant ------------------------------------------------------------------------------

/**
 * Waits (sped up in the video) until the assistant is done: nothing on the page says it's working for
 * `quiet` ms. The marks are the ones the bench watches.
 */
export async function aiWait(t: Tutor, { quiet = 3000, timeout = 30 * 60_000, speed = 20 }: { quiet?: number; timeout?: number; speed?: number } = {}): Promise<void> {
  await t.fastForward(async () => {
    const busy = () =>
      t.page
        .evaluate(() => {
          const shown = (e: Element) => {
            const r = (e as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          return [...document.querySelectorAll(".wp-aiw, .wp-wl, [data-test='pack-working'], [aria-busy='true'], [data-test='ai-chat-live'], [data-test='ai-loading']")].some(shown);
        })
        .catch(() => false);
    // The request can start a moment after the click.
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000 && !(await busy())) await sleep(300);
    let calm = Date.now();
    const end = await t.h.waitUntil(
      async () => {
        if (await busy()) calm = Date.now();
        return Date.now() - calm >= quiet;
      },
      { timeout, interval: 500, what: "the assistant to finish" },
    );
    if (end !== "done") throw new StepError("The assistant didn't finish.");
  }, speed);
}
