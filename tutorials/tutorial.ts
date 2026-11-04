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

export class Tutor {
  readonly page: Page;
  private readonly lines: Record<string, VoiceLine>;
  private readonly t0 = Date.now();
  private pos: Point = { x: 960, y: 560 };
  private busyUntil = 0;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** The caption on screen and when it goes, so a page load can put it back. */
  private caption: { text: string; until: number } | null = null;
  readonly cues: Cue[] = [];
  readonly fast: FastRange[] = [];
  /** Where the video starts showing the tutorial (after the canvas has loaded). */
  startAt = 0;
  /** When the sync mark went up (render.mjs finds it in the video). */
  markAt = 0;

  constructor(
    readonly h: Helpers,
    packDir: string,
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
    this.cues.push({ id, text, at: this.now(), ms, voiced: !!known });
    this.busyUntil = Date.now() + ms + 350;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.caption = { text, until: Date.now() + ms + 500 };
    await this.page.evaluate((t) => window.__tut?.caption(t), text).catch(() => undefined);
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
    if (missing) this.h.note(`${missing} line(s) have no voice yet: run python tutorials/voice/speak.py and record again.`);
    await this.h.file("cues.json", JSON.stringify({ t0: this.t0, mark: this.markAt, start: this.startAt, cues: this.cues, fast: this.fast, ended: this.now() }, null, 1), "application/json");
  }

  /** Marks the start of the tutorial: the video before it (loading the page) is cut. */
  async begin(): Promise<void> {
    await this.page.mouse.move(this.pos.x, this.pos.y);
    await sleep(500);
    this.markAt = this.now();
    await this.page.evaluate(() => window.__tut?.mark(400));
    await sleep(700);
    this.startAt = this.now();
    await sleep(600);
  }

  /** Runs `fn`; the final video plays that part `speed` times faster (a long wait, a model run). */
  async fastForward<T>(fn: () => Promise<T>, speed = 6): Promise<T> {
    const from = this.now();
    try {
      return await fn();
    } finally {
      this.fast.push({ from, to: this.now(), speed });
    }
  }

  // ---- the hand ------------------------------------------------------------------------------

  /** Moves the pointer to a point along a gentle curve, about as fast as a hand. */
  async moveTo(to: Point, { speed = 1 }: { speed?: number } = {}): Promise<void> {
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
  async click(target: Locator | Point, { double = false }: { double?: boolean } = {}): Promise<void> {
    const isPoint = "x" in target && "y" in target && typeof target.x === "number";
    if (!isPoint) await this.bringIntoView(target as Locator);
    const at = isPoint ? (target as Point) : await this.centre(target as Locator);
    await this.moveTo(at);
    await sleep(140);
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    if (double) {
      await sleep(90);
      await this.page.mouse.down();
      await sleep(60);
      await this.page.mouse.up();
    }
    await sleep(260);
  }

  /** Scrolls a part into view first when it sits under the page's edges (a sticky footer, the caption). */
  private async bringIntoView(target: Locator): Promise<void> {
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
    await this.page.keyboard.type(text, { delay: Math.round(1000 / cps) });
    await sleep(300);
  }

  async press(key: string): Promise<void> {
    await sleep(120);
    await this.page.keyboard.press(key);
    await sleep(250);
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
  async scrollTo(target: Locator, { at = 0.22 }: { at?: number } = {}): Promise<void> {
    await target.waitFor({ state: "attached", timeout: 15_000 });
    const view = this.page.viewportSize() ?? { width: 1920, height: 1080 };
    let first = await target.boundingBox();
    if (!first) return;
    if (first.y >= 90 && first.y <= view.height * 0.55) return;
    await this.moveTo({ x: Math.min(view.width - 60, Math.max(60, first.x + first.width / 2)), y: view.height * 0.5 });
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
   * (`/wp/…`). The page load plays fast in the video, and the caption on screen stays up.
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
        await sleep(400);
      }
      await this.page.mouse.move(this.pos.x, this.pos.y);
    }, 12);
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
      const b = await one.boundingBox();
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
  }

  async uncallout(id: string): Promise<void> {
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

  /** Node ids on the canvas now. */
  private async nodeIds(): Promise<string[]> {
    return this.page.evaluate(() => (window.app?.graph?.nodes ?? []).map((n) => String(n.id)));
  }

  /**
   * Adds a node the way a person does: double-click empty canvas at `at`, type `search`, Enter,
   * then click to drop it there. Returns the new node's id.
   */
  async addNode(search: string, at: Point): Promise<string> {
    const before = new Set(await this.nodeIds());
    await this.click(at, { double: true });
    await sleep(500);
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
    return this.centre(this.page.locator(`[data-slot-key="${nodeId}-${side}-${index}"]`));
  }

  /** Drags a wire from one node's output to another node's input. */
  async wire(fromId: string, output: string, toId: string, input: string): Promise<void> {
    const from = await this.slot(fromId, "out", output);
    const to = await this.slot(toId, "in", input);
    await this.drag(from, to);
    const linked = await this.page.evaluate(
      ([id, n]) => {
        const node = window.app?.graph?.getNodeById(id) ?? window.app?.graph?.getNodeById(Number(id));
        return (node?.inputs ?? []).some((x) => x.name === n && x.link != null);
      },
      [toId, input] as const,
    );
    if (!linked) throw new StepError(`The wire into ${input} didn't connect.`);
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
  from: string;
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

/** Whether takes make real images (the pack's `showcase` setting; it needs a model, so it's off in the cloud). */
export function showcasing(t: Tutor): boolean {
  return t.params.showcase === true;
}

/**
 * Wires the prompt into a checkpoint, sampler and image preview, runs it `runs` times and lets each
 * image land on screen. The stack of loader, encoders and sampler is built folded, since the video
 * is about the prompt; the narration around it is the test's. Returns the preview node's id.
 */
export async function showcase(t: Tutor, o: ShowcaseOptions): Promise<string> {
  const ckpt = String(t.params.checkpoint ?? "");
  const info = await t.h.api("/object_info/CheckpointLoaderSimple");
  const known = ((info.json as Record<string, { input?: { required?: { ckpt_name?: [string[]] } } }> | undefined)?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []) as string[];
  const name = known.find((k) => k === ckpt || k.replace(/\.(safetensors|ckpt)$/i, "") === ckpt.replace(/\.(safetensors|ckpt)$/i, ""));
  if (!name) throw new StepError(`The checkpoint "${ckpt}" isn't in ComfyUI's models/checkpoints. It has: ${known.slice(0, 8).join(", ") || "none"}.`);
  const chainAt = await toGraph(t.page, o.chain);
  const previewAt = await toGraph(t.page, o.preview);
  const steps = Number(t.params.steps ?? 24);
  const cfg = Number(t.params.cfg ?? 5);
  const previewId = await t.page.evaluate(
    ({ from, name, chainAt, previewAt, size, steps, cfg }) => {
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
      const src = graph.getNodeById(from) ?? graph.getNodeById(Number(from));
      if (!src) throw new Error("no prompt node");
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
      const load = make("CheckpointLoaderSimple", cx, cy);
      set(load, "ckpt_name", name);
      const pos = make("CLIPTextEncode", cx, cy + 50);
      const neg = make("CLIPTextEncode", cx, cy + 100);
      const latent = make("EmptyLatentImage", cx, cy + 150);
      set(latent, "width", 832);
      set(latent, "height", 1216);
      const sampler = make("KSampler", cx, cy + 200);
      set(sampler, "steps", steps);
      set(sampler, "cfg", cfg);
      set(sampler, "sampler_name", "euler_ancestral");
      set(sampler, "seed", 1234);
      for (const w of sampler.widgets ?? []) if (w.name === "control_after_generate") w.value = "fixed";
      const decode = make("VAEDecode", cx, cy + 250);
      const preview = make("PreviewImage", previewAt[0], previewAt[1], false);
      preview.size = [size[0], size[1]];
      link(load, "CLIP", pos, "clip");
      link(load, "CLIP", neg, "clip");
      link(src, "prompt", pos, "text");
      if (outIdx(src, "negative") >= 0) link(src, "negative", neg, "text");
      link(load, "MODEL", sampler, "model");
      link(pos, "CONDITIONING", sampler, "positive");
      link(neg, "CONDITIONING", sampler, "negative");
      link(latent, "LATENT", sampler, "latent_image");
      link(sampler, "LATENT", decode, "samples");
      link(load, "VAE", decode, "vae");
      link(decode, "IMAGE", preview, "images");
      (window.app as unknown as { canvas: { setDirty(a: boolean, b: boolean): void } }).canvas.setDirty(true, true);
      return String(preview.id);
    },
    { from: o.from, name, chainAt, previewAt, size: [o.preview.width ?? 460, o.preview.height ?? 700] as [number, number], steps, cfg },
  );
  await t.beat(600);
  const runs = o.runs ?? 3;
  for (let i = 0; i < runs; i++) {
    if (i > 0 && o.between) await o.between(i);
    await t.fastForward(() => t.run(), 8);
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
