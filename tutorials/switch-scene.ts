// The shared scene of N08 (WP Node Group) and N16 (WP Mode Relay): core nodes as stand-ins for a
// real workflow, never run. Two KSamplers, and a save branch (VAE Decode → Upscale Image By → Save
// Image) in a canvas group "Save branch" with a WP Node Group inside it. Plus helpers for node modes,
// the next free node_N dot, and a WP Toggles row whose When off mutes.
import { StepError } from "watchwright";
import type { Tutor } from "./tutorial.js";

export interface SwitchScene {
  ks1: string;
  ks2: string;
  dec: string;
  up: string;
  save: string;
  /** The Node Group inside the "Save branch" canvas group. */
  grpB: string;
}

export async function buildSwitchScene(t: Tutor): Promise<SwitchScene> {
  const page = t.page;
  await t.go("/");
  await t.setView({ scale: 0.8, offset: [0, 0] });
  await t.speedUp(12);
  const ks1 = await t.addNode("KSampler", { x: 230, y: 110 });
  const ks2 = await t.addNode("KSampler", { x: 230, y: 560 });
  const dec = await t.addNode("VAE Decode", { x: 1000, y: 150 });
  const up = await t.addNode("Upscale Image By", { x: 1000, y: 330 });
  const save = await t.addNode("Save Image", { x: 1400, y: 150 });
  await t.wire(ks1, "LATENT", dec, "samples");
  await t.wire(dec, "IMAGE", up, "image");
  await t.wire(up, "IMAGE", save, "images");
  const grpB = await t.addNode("WP Node Group", { x: 1060, y: 560 });
  await page.evaluate((ids) => {
    type N = { pos: [number, number]; size: [number, number] };
    const w = window as unknown as {
      LiteGraph?: { LGraphGroup?: new (title: string) => { pos: number[]; size: number[]; title: string } };
      app?: { graph?: { getNodeById(i: number): N | null; add(x: unknown): void }; canvas?: { setDirty(a: boolean, b: boolean): void } };
    };
    const g = w.app?.graph;
    const nodes = ids.map((i) => g?.getNodeById(Number(i))).filter((x): x is N => !!x);
    const x0 = Math.min(...nodes.map((x) => x.pos[0])) - 30;
    const y0 = Math.min(...nodes.map((x) => x.pos[1])) - 80;
    const x1 = Math.max(...nodes.map((x) => x.pos[0] + x.size[0])) + 30;
    const y1 = Math.max(...nodes.map((x) => x.pos[1] + x.size[1])) + 30;
    const Ctor = w.LiteGraph?.LGraphGroup;
    if (!Ctor || !g) return;
    const grp = new Ctor("Save branch");
    grp.pos = [x0, y0];
    grp.size = [x1 - x0, y1 - y0];
    g.add(grp);
    w.app?.canvas?.setDirty(true, true);
  }, [dec, up, save, grpB]);
  await t.normalSpeed();
  return { ks1, ks2, dec, up, save, grpB };
}

/** A node's ComfyUI mode: 0 runs, 2 muted, 4 bypassed. */
export function modeOf(t: Tutor, id: string): Promise<number> {
  return t.page.evaluate((nid) => {
    const g = window.app?.graph;
    const n = (g?.getNodeById(nid) ?? g?.getNodeById(Number(nid))) as { mode?: number } | null | undefined;
    return n?.mode ?? -1;
  }, id);
}

/** The first free node_N dot of a Node Group or Mode Relay. */
export function freeDot(t: Tutor, id: string): Promise<string> {
  return t.page.evaluate((nid) => {
    const g = window.app?.graph;
    const n = (g?.getNodeById(nid) ?? g?.getNodeById(Number(nid))) as { inputs?: { name: string; link: unknown }[] } | null | undefined;
    return n?.inputs?.find((i) => i.name.startsWith("node_") && i.link == null)?.name ?? "node_1";
  }, id);
}

export async function wireIn(t: Tutor, from: string, out: string, to: string): Promise<void> {
  await t.wire(from, out, to, await freeDot(t, to));
}

/** A WP Toggles with one toggle whose When off is Mute; returns the node and its control dot. */
export async function muteToggle(t: Tutor, name: string, at: { x: number; y: number }): Promise<{ tg: string; ctl: string }> {
  const page = t.page;
  const tg = await t.addNode("WP Toggles", at);
  const tb = await t.node(tg).boundingBox();
  if (tb) await t.click({ x: tb.x + tb.width / 2, y: tb.y + 14 });
  await t.beat(400);
  await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
  await t.beat(700);
  // Rename the new node's own first row (Toggle 1) rather than add a second one beside it.
  await t.click(t.node(tg).locator('[data-test^="tg-edit-"]:not([data-test="tg-edit-done"])').first());
  await t.beat(700);
  const win = page.getByRole("dialog").filter({ has: page.locator('[data-test="tg-window-done"]') }).last();
  await t.fill(win.locator('[data-test="tg-name"] input, input[data-test="tg-name"]').first(), name, { cps: 30 });
  await t.press("Tab");
  await t.click(win.locator('[data-test="tg-control-mute"]'));
  await t.beat(400);
  await t.click(win.locator('[data-test="tg-window-done"]'));
  await t.beat(500);
  await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
  await t.beat(500);
  await t.deselect();
  const ctl = await page.evaluate((id) => {
    const g = window.app?.graph;
    const nn = (g?.getNodeById(id) ?? g?.getNodeById(Number(id))) as { inputs?: { name: string }[] } | null | undefined;
    return nn?.inputs?.find((i) => i.name.startsWith("ctl_"))?.name ?? "";
  }, tg);
  if (!ctl) throw new StepError(`The ${name} toggle has no control dot.`);
  return { tg, ctl };
}

/** Flips a toggle until `id` has the wanted mode. */
export async function flipUntil(t: Tutor, tg: string, id: string, mode: number): Promise<void> {
  const sw = t.node(tg).locator('[data-test^="tg-ctl-"]').first();
  await t.click(sw);
  await t.beat(600);
  if ((await modeOf(t, id)) !== mode) {
    await t.click(sw);
    await t.beat(600);
  }
}
