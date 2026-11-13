// The shared scene of the four Var node videos (N10 Int, N17 Float, N18 Choice, N19 Bool):
// WP Toggles (a Hires switch) → WP Model Info (family pinned to sdxl) → a Context with Settings per
// model, which sets $size, $sampler and $cfg. Built sped up; each video narrates over it.
import type { Locator } from "playwright";
import type { Tutor } from "./tutorial.js";

export interface VarScene {
  tg: string;
  mi: string;
  ctx: string;
}

export async function buildVarScene(t: Tutor): Promise<VarScene> {
  const page = t.page;
  await t.go("/");
  // 0.65 so Toggles, Model Info and the Context fit left of the Var nodes the tests drop at x 900.
  await t.setView({ scale: 0.65, offset: [0, 0] });
  // The build was 11 s of silence at the usual 6×: go faster.
  await t.speedUp(12);
  // addNode takes a SCREEN point (it double-clicks there) and centres the node on it. At 0.65 Toggles
  // spans about 74-366, Model Info and the Context about 400-760, and the Var nodes at 900 start near 780.
  const tg = await t.addNode("WP Toggles", { x: 220, y: 230 });
  const tb = await t.node(tg).boundingBox();
  if (tb) await t.click({ x: tb.x + tb.width / 2, y: tb.y + 14 });
  await t.beat(400);
  await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
  await t.beat(700);
  // Rename the new node's own first row (Toggle 1) rather than add a second one beside it.
  await t.click(t.node(tg).locator('[data-test^="tg-edit-"]:not([data-test="tg-edit-done"])').first());
  await t.beat(700);
  const win = page.getByRole("dialog").filter({ has: page.locator('[data-test="tg-window-done"]') }).last();
  const field = (test: string) => win.locator(`[data-test="${test}"] input, input[data-test="${test}"]`).first();
  await t.fill(field("tg-name"), "Hires", { cps: 30 });
  await t.press("Tab");
  await t.fill(field("tg-var"), "hires", { cps: 30 });
  await t.press("Tab");
  await t.click(win.locator('[data-test="tg-window-done"]'));
  await t.beat(500);
  await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
  await t.beat(500);
  await t.deselect();
  const mi = await t.addNode("WP Model Info", { x: 580, y: 130 });
  await t.wire(tg, "context", mi, "upstream");
  await t.click(t.node(mi).locator('[data-test="mi-pin-family"]'));
  await t.beat(400);
  await t.fill(t.node(mi).locator('input[data-test="mi-pin-input-family"], [data-test="mi-pin-input-family"] input').first(), "sdxl", { cps: 30 });
  await t.press("Enter");
  const ctx = await t.addNode("WP Context", { x: 580, y: 560 });
  await t.wire(mi, "context", ctx, "upstream");
  await t.pickModules(ctx, ["Settings per model"]);
  await t.normalSpeed();
  return { tg, mi, ctx };
}

/** A widget row on a node, by the widget's name. */
export function widget(t: Tutor, node: string, name: string): Locator {
  return t.node(node).locator(`[data-widget-name="${name}"]`);
}

/** What a Var node read on its last run. */
export function readOf(t: Tutor, node: string): Locator {
  return t.node(node).locator('[data-test="var-picker-preview"]');
}

export async function pickVar(t: Tutor, node: string, name: string): Promise<void> {
  await t.click(t.node(node).getByRole("combobox", { name: "Variable" }).first());
  await t.type(name, { cps: 14, rest: false });
  await t.beat(500);
  await t.click(t.page.getByRole("option", { name: new RegExp(`^\\$?${name}\\b`) }).first());
  await t.beat(500);
}

export async function setNumber(t: Tutor, node: string, name: string, value: string): Promise<void> {
  await t.fill(widget(t, node, name).locator("input").first(), value, { cps: 10 });
  await t.press("Tab");
  await t.beat(400);
}

export async function chooseCombo(t: Tutor, node: string, name: string, option: RegExp): Promise<void> {
  await t.click(widget(t, node, name).getByRole("combobox").first());
  await t.beat(500);
  await t.click(t.page.getByRole("option", { name: option }).first());
  await t.beat(500);
}

/** Runs, and closes ComfyUI's error dialog a stopped run leaves up. */
export async function runVar(t: Tutor): Promise<void> {
  await t.run();
  await t.beat(1000);
  await t.press("Escape");
  await t.beat(300);
}
