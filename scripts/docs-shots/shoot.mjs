#!/usr/bin/env node
/**
 * Docs node pictures, shot from a real ComfyUI.
 *
 *   node scripts/docs-shots/shoot.mjs [--url http://127.0.0.1:8188] [--only wp-toggles,wp-debug]
 *
 * Needs a running ComfyUI with this extension built (`pnpm build`) and
 * Playwright. Each scene (scenes.mjs) builds its graph from the example
 * workflows, runs it when the picture should show a result, frames it and
 * writes `public/images/docs/<image>.png` (1720 px wide). A scene with a
 * `node` also writes `src/manager/docs/pins/<image>.json`: where each field
 * of that node (`src/manager/docs/node-fields.ts`, its `sockets` or `pin`)
 * sits on the picture, which `DocAnnotated` draws as numbered pins.
 *
 * The first run fills an empty library from the example workflows' own rows
 * (their Start here note's Add to library button), so nothing shows MISSING.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { NODE_FIELDS } from "../../src/manager/docs/node-fields.ts";
import { SCENES } from "./scenes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const URL = arg("url", "http://127.0.0.1:8188");
const ONLY = (arg("only", "") || "").split(",").filter(Boolean);
/** Picture width in CSS px; shot at device scale 2, so the file is 1720 wide. */
const CLIP_W = 860;
const MARGIN = 36;

const WORKFLOWS = {
  one: JSON.parse(readFileSync(resolve(ROOT, "example_workflows/1 - One image.json"), "utf8")),
  grids: JSON.parse(readFileSync(resolve(ROOT, "example_workflows/2 - Batches and grids.json"), "utf8")),
  pick: JSON.parse(readFileSync(resolve(ROOT, "example_workflows/3 - Pick and refine.json"), "utf8")),
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1150 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.warn("page error:", e.message));
await page.addInitScript({ path: resolve(HERE, "page-helper.js") });
await page.goto(URL);
await page.waitForFunction(() => window.app?.graph && window.LiteGraph && window.__shot, null, { timeout: 90_000 });
await page.waitForTimeout(2500);
await page.evaluate(async () => {
  const s = window.app.extensionManager.setting;
  await s.set("Comfy.VueNodes.Enabled", true);
  // DOM widgets vanish below this font size when zoomed out.
  await s.set("LiteGraph.Canvas.MinFontSizeForLOD", 1);
  await s.set("Comfy.Minimap.Visible", false).catch(() => {});
});
await page.keyboard.press("Escape");

await seedLibrary();

for (const scene of SCENES) {
  if (ONLY.length && !ONLY.includes(scene.image)) continue;
  console.log(`· ${scene.image}`);
  try {
    await shoot(scene);
  } catch (e) {
    console.error(`  failed: ${e.message}`);
    process.exitCode = 1;
  }
}
await browser.close();

async function seedLibrary() {
  // Each workflow's button offers only what the library lacks (Add is off when nothing is).
  console.log("· adding the example workflows' rows to the library");
  for (const wf of Object.values(WORKFLOWS)) {
    await page.evaluate((json) => window.__shot.load(json), wf);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__shot.focus(1));
    await page.waitForTimeout(1500);
    const btn = page.locator("[data-test='note-library-button']").first();
    if ((await btn.getAttribute("aria-disabled")) === "true") continue;
    await btn.click();
    const add = page.locator("[data-test='note-library-add']");
    await add.waitFor();
    await page.waitForTimeout(800);
    if (await add.isEnabled()) await add.click();
    else await page.locator("[data-test='note-library-cancel']").click();
    await page.waitForTimeout(1500);
  }
}

async function shoot(scene) {
  const wf = scene.from ? WORKFLOWS[scene.from] : { nodes: [], links: [], version: 0.4 };
  await page.evaluate((json) => window.__shot.load(json), wf);
  await page.waitForTimeout(800);
  const target = await page.evaluate(
    ({ src, arg }) => new Function("S", "arg", `return (${src})(S, arg);`)(window.__shot, arg),
    { src: scene.build.toString(), arg: scene.arg ?? null },
  );
  await page.evaluate(() => {
    window.app.canvas.deselectAll?.();
    window.__shot.dirty();
  });
  await page.waitForTimeout(1500);
  if (scene.run) await run(scene.answer);
  if (scene.after) await scene.after(page);
  if (scene.edit && target != null) {
    // Open the node's edit view the way a user does: select it, press the toolbar pencil.
    await page.evaluate((id) => window.app.canvas.select(window.__shot.node(id)), target);
    await page.waitForTimeout(600);
    await page.locator(".wp-tb-icon--edit").first().click();
    await page.waitForTimeout(800);
    await page.evaluate(() => window.app.canvas.deselectAll?.());
    await page.waitForTimeout(400);
  }
  if (scene.select && target != null) {
    await page.evaluate((id) => window.app.canvas.select(window.__shot.node(id)), target);
    await page.waitForTimeout(600);
  }

  const height = scene.height ?? 752;
  const clip = await frame(height / 2, scene.scale, scene.select ? 56 : 0);
  await page.waitForTimeout(900);
  // Leave the pointer off the picture (hover states, tooltips).
  await page.mouse.move(4, 4);
  await page.waitForTimeout(300);

  const out = resolve(ROOT, "public/images/docs", `${scene.image}.png`);
  await page.screenshot({ path: out, clip });

  const id = target ?? null;
  if (scene.node && id != null) {
    const pins = await locatePins(scene.node, id, scene.groups ?? ["ports", "controls"], clip);
    const file = resolve(ROOT, "src/manager/docs/pins", `${scene.image}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ node: scene.node, image: `images/docs/${scene.image}.png`, pins }, null, 2)}\n`);
    const missing = fieldsFor(scene.node, scene.groups ?? ["ports", "controls"])
      .filter((f) => !pins.some((p) => p.term === f.term && p.group === f.group))
      .map((f) => f.term);
    console.log(`  ${pins.length} pins${missing.length ? `; not on the picture: ${missing.join(", ")}` : ""}`);
  }
}

/** Queue the graph and wait for it. `answer` replies to a WP Image Filter that pauses. */
async function run(answer) {
  await page.evaluate(() => window.app.queuePrompt(0, 1));
  await page.waitForTimeout(800);
  for (let i = 0; i < 480; i++) {
    const q = await page.evaluate(async () => (await fetch("/queue")).json());
    if (!q.queue_running.length && !q.queue_pending.length) break;
    if (answer) {
      await page.evaluate(async (body) => {
        const res = await (await fetch("/wp/api/image-filter/pending")).json();
        for (const req of res.data?.pending ?? res.pending ?? []) {
          await fetch("/wp/api/image-filter/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: req.token, ...body }),
          });
        }
      }, answer);
    }
    await page.waitForTimeout(500);
  }
  const err = await page.evaluate(async () => {
    const h = await (await fetch("/history?max_items=1")).json();
    const last = Object.values(h)[0];
    return last?.status?.status_str === "error" ? JSON.stringify(last.status.messages?.slice(-1)) : "";
  });
  if (err) console.warn(`  run error: ${err.slice(0, 400)}`);
  await page.waitForTimeout(1500);
  // A run toast or an error dialog must not land in the picture.
  await page.keyboard.press("Escape");
}

/** Centre every node in a CLIP_W × h box in the middle of the canvas; returns the clip. */
async function frame(h, maxScale = 1, above = 0) {
  return page.evaluate(({ W, H, M, maxScale, above }) => {
    const c = window.app.canvas;
    const T = window.LiteGraph.NODE_TITLE_HEIGHT;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of window.app.graph.nodes) {
      const el = document.querySelector(`[data-node-id="${n.id}"]`);
      const hgt = el ? el.getBoundingClientRect().height / c.ds.scale : n.size[1] + T;
      x0 = Math.min(x0, n.pos[0]); y0 = Math.min(y0, n.pos[1] - T);
      x1 = Math.max(x1, n.pos[0] + n.size[0]); y1 = Math.max(y1, n.pos[1] - T + hgt);
    }
    y0 -= above;
    const scale = Math.min(maxScale, (W - 2 * M) / (x1 - x0), (H - 2 * M) / (y1 - y0));
    const box = c.canvas.getBoundingClientRect();
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    const clip = { x: Math.round(cx - W / 2), y: Math.round(cy - H / 2), width: W, height: H };
    c.ds.scale = scale;
    // Screen = (graph + offset) * scale, relative to the canvas element.
    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    c.ds.offset = [(cx - box.left) / scale - midX, (cy - box.top) / scale - midY];
    c.setDirty(true, true);
    return clip;
  }, { W: CLIP_W, H: h, M: MARGIN, maxScale, above });
}

function fieldsFor(node, groups) {
  const all = NODE_FIELDS[node] ?? {};
  return groups.flatMap((g) => (all[g] ?? []).map((f) => ({ ...f, group: g }))).filter((f) => f.pin !== "none");
}

async function locatePins(node, id, groups, clip) {
  const fields = fieldsFor(node, groups).map((f) => ({ group: f.group, term: f.term, sockets: f.sockets ?? [], pin: f.pin ?? "" }));
  const found = await page.evaluate(({ id, fields }) => {
    const root = document.querySelector(`[data-node-id="${id}"]`);
    if (!root) return [];
    const visible = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? r : null;
    };
    const textIs = (el, t) => (el.textContent ?? "").trim() === t;
    const lnode = window.__shot.node(id);
    const slot = (side, name) => {
      const glob = name.endsWith("*") ? name.slice(0, -1) : null;
      const list = (side === "input" ? lnode.inputs : lnode.outputs) ?? [];
      const i = list.findIndex((s) => (glob !== null ? s.name.startsWith(glob) : s.name === name));
      if (i < 0) return null;
      const key = `${id}-${side === "input" ? "in" : "out"}-${i}`;
      return visible(root.querySelector(`[data-slot-key="${key}"]`));
    };
    const find = (loc) => {
      const [kind, ...rest] = loc.split(":");
      const what = rest.join(":");
      if (kind === "in" || kind === "out") {
        const r = slot(kind === "in" ? "input" : "output", what);
        if (r) return { r, side: kind === "in" ? "left" : "right" };
        if (kind === "in") {
          const w = visible(root.querySelector(`[data-widget-name="${what}"]`));
          if (w) return { r: w, side: "left" };
        }
        return null;
      }
      if (kind === "widget") {
        const w = visible(root.querySelector(`[data-widget-name="${what}"]`));
        return w ? { r: w, side: "left" } : null;
      }
      if (kind === "css") {
        const r = visible(root.querySelector(what));
        return r ? { r, side: "left" } : null;
      }
      if (kind === "text") {
        const el = [...root.querySelectorAll("*")].find((e) => textIs(e, what) && visible(e));
        const r = visible(el);
        return r ? { r, side: "left" } : null;
      }
      if (kind === "page") {
        const el = document.querySelector(what);
        const r = visible(el?.closest("button") ?? el);
        return r ? { r, side: "top" } : null;
      }
      if (kind === "title") {
        const r = visible(root.querySelector("[data-testid^='node-header']"));
        return r ? { r, side: "left" } : null;
      }
      return null;
    };
    const out = [];
    for (const f of fields) {
      const [loc, at] = f.pin.split("@");
      const tries = loc ? [loc] : f.sockets;
      for (const t of tries) {
        const hit = find(t);
        if (!hit) continue;
        const side = at ?? hit.side;
        const { r } = hit;
        const p = side === "right" ? { x: r.right + 13, y: r.top + r.height / 2 }
          : side === "top" ? { x: r.left + r.width / 2, y: r.top - 11 }
            : side === "inside" ? { x: r.left + 12, y: r.top + r.height / 2 }
              : { x: r.left - 13, y: r.top + r.height / 2 };
        out.push({ group: f.group, term: f.term, ...p });
        break;
      }
    }
    return out;
  }, { id, fields });
  return found.map((p) => ({
    group: p.group,
    term: p.term,
    x: +((p.x - clip.x) / clip.width).toFixed(4),
    y: +((p.y - clip.y) / clip.height).toFixed(4),
  }));
}
