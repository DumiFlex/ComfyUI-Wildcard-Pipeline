/**
 * What the Image Filter picker knows about the Context Loop that made its
 * frames: the swept wildcards (to label frames and lay a sweep out as a
 * grid), and a way to send the picks back (lock the picked frames' seeds,
 * bypass the rest). Lives in the picker's lazy chunk.
 *
 * The pure parts (`sweepGrid`, `frameParts`, `loopEdit`) take plain data and
 * are unit-tested; `findLoop` reads the live graph.
 */
import {
  collectDownstreamContextNodes,
  findRootGraph,
  walkAllNodes,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../../extension/graph";
import { assignCodenames, baseCodename } from "../../extension/node-codename";
import { collectSweepCandidates, sweepSourcesFromRaw } from "../context-loop/sweep-candidates";
import { parseContextLoopConfig, type ContextLoopConfig } from "../context-loop/types";
import type { FrameLabel } from "./types";

export interface SweepAxisInfo {
  uid: string;
  /** `$binding` of the swept wildcard. */
  name: string;
  /** Option id -> option text. */
  labels: Record<string, string>;
}

export interface LoopLink {
  node: LiteNodeLike;
  /** Swept wildcards in the loop's axis order (only those the frames pin). */
  axes: SweepAxisInfo[];
}

function widgetValue(node: LiteNodeLike, name: string): string {
  const w = (node.widgets ?? []).find((x) => x.name === name);
  return typeof w?.value === "string" ? w.value : "";
}

function loopConfig(node: LiteNodeLike): ContextLoopConfig {
  return parseContextLoopConfig(widgetValue(node, "wp_context_loop_config"));
}

function pinUids(labels: readonly FrameLabel[]): Set<string> {
  const out = new Set<string>();
  for (const l of labels) for (const uid of Object.keys(l.pins ?? {})) out.add(uid);
  return out;
}

/**
 * The Context Loop the frames came from: the one whose sweep pins them, or
 * the only loop in the graph when the frames carry a loop index. Null when
 * there is no loop, or several and nothing tells them apart.
 */
export function findLoop(labels: readonly FrameLabel[], graph: LiteGraphLike | undefined): LoopLink | null {
  if (!graph) return null;
  const root = findRootGraph(graph);
  const loops: LiteNodeLike[] = [];
  for (const { node } of walkAllNodes(root)) {
    if (node.type === "WP_ContextLoop") loops.push(node);
  }
  const uids = pinUids(labels);
  let node: LiteNodeLike | undefined;
  if (uids.size) {
    node = loops.find((n) => {
      const have = new Set(loopConfig(n).sweep.axes.map((a) => a.uid));
      return [...uids].every((u) => have.has(u));
    });
  } else if (loops.length === 1 && labels.some((l) => typeof l.loop_index === "number")) {
    node = loops[0];
  }
  if (!node) return null;

  const axes: SweepAxisInfo[] = [];
  if (uids.size) {
    const downstream = collectDownstreamContextNodes(root, node);
    const names = assignCodenames(downstream.map((n) => n.id));
    const candidates = collectSweepCandidates(sweepSourcesFromRaw(downstream.map((n) => ({
      label: names.get(String(n.id)) ?? baseCodename(n.id),
      raw: widgetValue(n, "wp_modules"),
    }))));
    for (const axis of loopConfig(node).sweep.axes) {
      if (!uids.has(axis.uid)) continue;
      const c = candidates.find((x) => x.uid === axis.uid);
      axes.push({
        uid: axis.uid,
        name: `$${c?.binding || c?.name || axis.label || axis.uid}`,
        labels: Object.fromEntries((c?.options ?? []).map((o) => [o.id, o.label])),
      });
    }
  }
  return { node, axes };
}

/** A frame's caption pieces: `#n`, then each swept option's text. */
export function frameParts(label: FrameLabel | undefined, frame: number, axes: readonly SweepAxisInfo[]): string[] {
  const n = typeof label?.loop_index === "number" ? label.loop_index + 1 : frame + 1;
  const parts = [`#${n}`];
  for (const a of axes) {
    const id = label?.pins?.[a.uid];
    if (id !== undefined) parts.push(a.labels[id] ?? id);
  }
  return parts;
}

export interface SweepGrid {
  /** Row header text (the swept options of every axis but the last). */
  rows: string[];
  /** Column header text (the last axis's options). */
  cols: string[];
  rowAxis: string;
  colAxis: string;
  /** `cells[r][c]` is a frame index, or -1 for a combination not present. */
  cells: number[][];
}

/**
 * Lay a sweep of two or more wildcards out as a grid: the last wildcard's
 * options across, every combination of the others down. Null when the frames
 * don't all carry a pin for every axis (not a sweep, or a mixed list).
 */
export function sweepGrid(labels: readonly FrameLabel[], axes: readonly SweepAxisInfo[]): SweepGrid | null {
  if (axes.length < 2 || !labels.length) return null;
  const rowAxes = axes.slice(0, -1);
  const colAxis = axes[axes.length - 1];
  const rowKeys: string[] = [];
  const colKeys: string[] = [];
  const at = new Map<string, number>();
  for (let f = 0; f < labels.length; f++) {
    const pins = labels[f].pins ?? {};
    if (!axes.every((a) => pins[a.uid] !== undefined)) return null;
    const rk = rowAxes.map((a) => pins[a.uid]).join("\u0000");
    const ck = pins[colAxis.uid];
    if (!rowKeys.includes(rk)) rowKeys.push(rk);
    if (!colKeys.includes(ck)) colKeys.push(ck);
    at.set(`${rk}\u0001${ck}`, f);
  }
  return {
    rows: rowKeys.map((rk) => rk.split("\u0000").map((id, i) => rowAxes[i].labels[id] ?? id).join(" · ")),
    cols: colKeys.map((id) => colAxis.labels[id] ?? id),
    rowAxis: rowAxes.map((a) => a.name).join(" · "),
    colAxis: colAxis.name,
    cells: rowKeys.map((rk) => colKeys.map((ck) => at.get(`${rk}\u0001${ck}`) ?? -1)),
  };
}

export interface LoopEditResult {
  config: ContextLoopConfig;
  kept: number;
  bypassed: number;
  /** Kept frames whose seed got locked (frames only carry a seed when the
   *  loop overrides seeds; otherwise keeping the frame index is enough). */
  locked: number;
}

/**
 * Send picks back to the loop: lock the seed of every frame with a pick and
 * bypass every frame without one, so the next Generate reruns only the
 * frames you kept, with the same seeds. Frames without a loop index are left
 * alone.
 */
export function loopEdit(
  cfg: ContextLoopConfig,
  labels: readonly FrameLabel[],
  pickedFrames: ReadonlySet<number>,
): LoopEditResult {
  const locks = { ...cfg.seed_locks };
  const bypass = new Set(cfg.bypass_frames);
  let kept = 0;
  let bypassed = 0;
  let locked = 0;
  labels.forEach((l, f) => {
    const idx = l.loop_index;
    if (typeof idx !== "number") return;
    if (pickedFrames.has(f)) {
      kept += 1;
      bypass.delete(idx);
      if (typeof l.seed === "number") {
        locks[String(idx)] = l.seed;
        locked += 1;
      }
    } else {
      bypassed += 1;
      bypass.add(idx);
    }
  });
  return {
    config: { ...cfg, seed_locks: locks, bypass_frames: [...bypass].sort((a, b) => a - b) },
    kept,
    bypassed,
    locked,
  };
}
