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

/** Which swept wildcard goes where in the grid (indices into the axes).
 *  Every axis not on rows or columns splits the grid into groups. */
export interface GridLayout {
  rows: number;
  cols: number;
}

export interface GridHeader {
  /** Index of the axis, for its colour. */
  axis: number;
  name: string;
}

export interface GridGroup {
  /** One `{axis, name, value}` per split axis; empty when nothing splits. */
  title: { axis: number; name: string; value: string }[];
  /** `cells[r][c]` is a frame index, or -1 for a combination not present. */
  cells: number[][];
  /** Every frame in the group, for "pick the whole group". */
  frames: number[];
}

export interface SweepGrid {
  rowAxis: GridHeader;
  colAxis: GridHeader;
  splitAxes: GridHeader[];
  /** Row header text (the row axis's options). */
  rows: string[];
  /** Column header text (the column axis's options). */
  cols: string[];
  groups: GridGroup[];
}

/** Rows on the first axis, columns on the second, the rest split. */
export function defaultGridLayout(): GridLayout {
  return { rows: 0, cols: 1 };
}

/**
 * Put `axis` in `slot`; the axis that held the slot takes `axis`'s old place
 * (the other slot, or the split). Rows and columns never share an axis.
 */
export function moveAxis(layout: GridLayout, slot: "rows" | "cols", axis: number): GridLayout {
  const other = slot === "rows" ? "cols" : "rows";
  if (layout[other] === axis) return { rows: layout.cols, cols: layout.rows };
  return { ...layout, [slot]: axis };
}

/**
 * Lay a sweep of two or more wildcards out as a grid: one axis down, one
 * across, and one small grid per combination of the others. Options keep
 * the order the loop swept them in. Null when the frames don't all carry a
 * pin for every axis (not a sweep, or a mixed list) or the layout doesn't fit.
 */
export function sweepGrid(
  labels: readonly FrameLabel[],
  axes: readonly SweepAxisInfo[],
  layout: GridLayout = defaultGridLayout(),
): SweepGrid | null {
  const n = axes.length;
  const { rows: ri, cols: ci } = layout;
  if (n < 2 || !labels.length || ri === ci || ri < 0 || ci < 0 || ri >= n || ci >= n) return null;
  const split = axes.map((_, i) => i).filter((i) => i !== ri && i !== ci);
  const rowAxis = axes[ri];
  const colAxis = axes[ci];
  const rowIds: string[] = [];
  const colIds: string[] = [];
  const groupKeys: string[] = [];
  const groupIds: string[][] = [];
  const at = new Map<string, number>();
  const SEP = "\u0000";
  for (let f = 0; f < labels.length; f++) {
    const pins = labels[f].pins ?? {};
    if (!axes.every((a) => pins[a.uid] !== undefined)) return null;
    const r = pins[rowAxis.uid];
    const c = pins[colAxis.uid];
    const gIds = split.map((i) => pins[axes[i].uid]);
    const g = gIds.join(SEP);
    if (!rowIds.includes(r)) rowIds.push(r);
    if (!colIds.includes(c)) colIds.push(c);
    if (!groupKeys.includes(g)) {
      groupKeys.push(g);
      groupIds.push(gIds);
    }
    at.set([g, r, c].join("\u0001"), f);
  }
  const header = (i: number): GridHeader => ({ axis: i, name: axes[i].name });
  return {
    rowAxis: header(ri),
    colAxis: header(ci),
    splitAxes: split.map(header),
    rows: rowIds.map((id) => rowAxis.labels[id] ?? id),
    cols: colIds.map((id) => colAxis.labels[id] ?? id),
    groups: groupKeys.map((g, gi) => {
      const cells = rowIds.map((r) => colIds.map((c) => at.get([g, r, c].join("\u0001")) ?? -1));
      return {
        title: split.map((i, k) => ({ axis: i, name: axes[i].name, value: axes[i].labels[groupIds[gi][k]] ?? groupIds[gi][k] })),
        cells,
        frames: cells.flat().filter((f) => f >= 0),
      };
    }),
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
