/**
 * Canvas side of the WP Toggles lock setting (`extension/toggle-lock.ts`):
 * find the WP Context nodes by codename, read what their last run left in
 * the stashes, and write the locked values back through their widget (the
 * Context widget takes a new value the same way a workflow load gives it).
 */
import { walkAllNodes, type LiteGraphLike, type LiteNodeLike } from "../extension/graph";
import { assignCodenames } from "../extension/node-codename";
import { nodeBadge, nodeFrameSeeds, nodeLastPicks, nodeLastUsedPerModule, nodeLastUsedSeed } from "../extension/_stashes";
import { bumpBadgeRevision, ensureBadgeSlot, hasBadgeSlot } from "../extension/badge-slot";
import { parseTogglesConfig } from "../extension/toggles";
import {
  contextChoices,
  missingByToggle,
  emptyRun,
  lockOwner,
  lockRows,
  releaseRows,
  type LastRun,
  type LockAction,
  type LockChoice,
} from "../extension/toggle-lock";
import { parseWidgetJson, serializeWidgetJson, type ContextWidgetValue } from "./_shared";

const WIDGET = "wp_modules";

/** Every WP Context on the canvas (subgraphs too) by codename. */
export function contextsByCodename(root: LiteGraphLike | null | undefined): Map<string, LiteNodeLike> {
  const out = new Map<string, LiteNodeLike>();
  if (!root) return out;
  const found: LiteNodeLike[] = [];
  for (const { node } of walkAllNodes(root)) if (node.type === "WP_Context") found.push(node);
  const names = assignCodenames(found.map((n) => n.id));
  for (const n of found) out.set(names.get(String(n.id)) ?? String(n.id), n);
  return out;
}

/** Last parse per node: the picker polls every Context on the canvas. */
const parsed = new WeakMap<object, { raw: string; value: ContextWidgetValue }>();

function readValue(node: LiteNodeLike): ContextWidgetValue {
  const w = node.widgets?.find((x) => x.name === WIDGET);
  const raw = typeof w?.value === "string" ? w.value : "";
  const hit = parsed.get(node);
  if (hit && hit.raw === raw) return hit.value;
  const value = parseWidgetJson<ContextWidgetValue>(raw, { version: 1, modules: [] });
  parsed.set(node, { raw, value });
  return value;
}

function writeValue(node: LiteNodeLike, value: ContextWidgetValue): void {
  const w = node.widgets?.find((x) => x.name === WIDGET);
  if (!w) return;
  w.value = serializeWidgetJson(value);
  (node.graph as { setDirtyCanvas?: (fg: boolean, bg: boolean) => void } | undefined)?.setDirtyCanvas?.(true, true);
}

/** Every row the lock picker can offer, across the canvas. */
export function lockChoices(root: LiteGraphLike | null | undefined): LockChoice[] {
  const out: LockChoice[] = [];
  for (const [code, node] of contextsByCodename(root)) {
    const title = typeof node.title === "string" && node.title.trim() ? node.title.trim() : "WP Context";
    out.push(...contextChoices(code, title, readValue(node)));
  }
  return out;
}

/** What the node's last run left behind (empty before its first run). */
export function lastRunOf(node: object): LastRun {
  const run = emptyRun();
  run.seeds = { ...(nodeLastUsedPerModule.get(node) ?? {}) };
  const chain = nodeLastUsedSeed.get(node);
  run.chainSeed = typeof chain === "number" && Number.isFinite(chain) ? chain : null;
  const picks = nodeLastPicks.get(node);
  if (picks) {
    run.picks = { ...picks.all };
    run.framePicks = picks.frames;
  }
  const frames = nodeFrameSeeds.get(node);
  if (frames) run.frameSeeds = frames;
  return run;
}

export interface LockOutcome {
  locked: number;
  released: number;
  /** Rows left alone (locked by hand or by another toggle). */
  kept: number;
  /** Rows with no run to lock them to yet. */
  noRun: number;
}

/** Carry out `actions` for the toggles node `togglesId`. */
export function applyLockActions(
  root: LiteGraphLike | null | undefined,
  togglesId: string | number,
  actions: readonly LockAction[],
): LockOutcome {
  const total: LockOutcome = { locked: 0, released: 0, kept: 0, noRun: 0 };
  if (!actions.length) return total;
  const nodes = contextsByCodename(root);
  // One read and one write per Context, however many toggles touch it.
  const values = new Map<LiteNodeLike, ContextWidgetValue>();
  const valueOf = (n: LiteNodeLike): ContextWidgetValue => values.get(n) ?? readValue(n);
  for (const a of actions) {
    const owner = lockOwner(togglesId, a.toggleId);
    for (const [node, uids] of byNode(nodes, a.release)) {
      const r = releaseRows(valueOf(node), owner, uids);
      total.released += r.released;
      values.set(node, r.value);
    }
    for (const [node, uids] of byNode(nodes, a.lock)) {
      const r = lockRows(valueOf(node), uids, a.mode, owner, lastRunOf(node));
      total.locked += r.locked;
      total.kept += r.kept;
      total.noRun += r.noRun;
      values.set(node, r.value);
    }
  }
  for (const [node, value] of values) {
    if (serializeWidgetJson(value) !== serializeWidgetJson(readValue(node))) writeValue(node, value);
  }
  return total;
}

function byNode(nodes: Map<string, LiteNodeLike>, targets: readonly { node: string; uid: string }[]): Map<LiteNodeLike, Set<string>> {
  const out = new Map<LiteNodeLike, Set<string>>();
  for (const t of targets) {
    const n = nodes.get(t.node);
    if (!n) continue;
    const set = out.get(n) ?? new Set<string>();
    set.add(t.uid);
    out.set(n, set);
  }
  return out;
}

interface Badge { text: string; bgColor: string; fgColor: string }
type BadgeCtor = new (opts: Record<string, unknown>) => Badge;

/** The Toggles node's red badge while `count` lock targets are missing
 *  (`--wp-red`, as the subgraph conflict badge draws it). */
export function setMissingBadge(node: object, count: number): void {
  const current = nodeBadge.get(node) as Badge | undefined;
  if (!count) {
    if (!current) return;
    const host = node as { badges?: unknown[] };
    if (!hasBadgeSlot(host) && Array.isArray(host.badges)) {
      const i = host.badges.indexOf(current);
      if (i >= 0) host.badges.splice(i, 1);
    }
    nodeBadge.delete(node);
    bumpBadgeRevision();
    return;
  }
  const text = `${count} missing lock target${count === 1 ? "" : "s"}`;
  if (current) {
    current.text = text;
    bumpBadgeRevision();
    return;
  }
  const Ctor = (window as unknown as { LGraphBadge?: BadgeCtor }).LGraphBadge;
  if (!Ctor) return;
  const badge = new Ctor({ text, bgColor: "#f87171", fgColor: "#ffffff", fontSize: 12, padding: 6, height: 18, cornerRadius: 4 });
  nodeBadge.set(node, badge);
  const host = node as { badges?: unknown[] };
  if (!ensureBadgeSlot(host)) {
    if (!Array.isArray(host.badges)) host.badges = [];
    host.badges.push(badge);
  }
  bumpBadgeRevision();
}

/** WP Toggles nodes with lock targets that are gone, for the pre-run check:
 *  each node (and its graph, for Focus) with how many are missing. */
export function missingLocksOnCanvas(
  root: LiteGraphLike | null | undefined,
): Array<{ node: LiteNodeLike; graph: LiteGraphLike; count: number }> {
  if (!root) return [];
  const out: Array<{ node: LiteNodeLike; graph: LiteGraphLike; count: number }> = [];
  let choices: LockChoice[] | null = null;
  for (const { node, graph } of walkAllNodes(root)) {
    if (node.type !== "WP_Toggles") continue;
    const mode = (node as { mode?: number }).mode;
    if (mode === 2 || mode === 4) continue;
    const raw = node.widgets?.find((w) => w.name === "wp_toggles")?.value;
    if (typeof raw !== "string" || !raw.includes("lock_targets")) continue;
    choices ??= lockChoices(root);
    let count = 0;
    for (const gone of missingByToggle(parseTogglesConfig(raw), choices).values()) count += gone.length;
    if (count) out.push({ node, graph, count });
  }
  return out;
}
