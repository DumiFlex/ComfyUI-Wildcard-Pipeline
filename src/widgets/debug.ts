import { defineAsyncComponent, h, ref, watch, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import { reactiveFromGraph } from "../extension/reactive";
import { findRootGraph, showGraph, type LiteGraphLike, type LiteNodeLike } from "../extension/graph";
import { baseCodename } from "../extension/node-codename";
import { flashInNode, type FlashTarget } from "./flash-target";
import { currentFrame, setFrame } from "../components/context-loop/frame-cursor";

const DebugViewer = defineAsyncComponent(() => import("../components/debug/DebugViewer.vue"));

interface DebugNode extends MountTargetNode {
  onExecuted?: (output: { wp_debug_snapshot?: string[] }) => void;
  mode?: number;
}

interface CanvasLike {
  graph?: LiteGraphLike;
  setGraph?: (graph: LiteGraphLike) => void;
  selectNode?: (node: LiteNodeLike) => void;
  centerOnNode?: (node: LiteNodeLike) => void;
  setDirty?: (fg: boolean, bg?: boolean) => void;
}

interface CollapsibleNode {
  flags?: { collapsed?: boolean };
  collapse?: (force?: boolean) => void;
}

/** Resolve an execution node id (`"12"`, or `"4:12"` inside subgraph 4)
 *  against the root graph. */
function findExecNode(id: string): { node: LiteNodeLike; graph: LiteGraphLike } | null {
  const start = app.graph as unknown as LiteGraphLike | undefined;
  if (!start || !id) return null;
  let graph: LiteGraphLike | undefined = findRootGraph(start);
  const path = id.split(":");
  for (let i = 0; graph && i < path.length; i++) {
    // Node ids can be text ("wpctx") in hand-written or converted workflows;
    // litegraph keys its node map by the id as given, so look up the raw
    // string first and fall back to the number.
    const raw = path[i];
    const n: LiteNodeLike | null = graph.getNodeById(raw as unknown as number)
      ?? (/^\d+$/.test(raw) ? graph.getNodeById(Number(raw)) : null);
    if (!n) return null;
    if (i === path.length - 1) return { node: n, graph };
    graph = n.subgraph;
  }
  return null;
}

/** The Context Loop frame a snapshot belongs to (`__wp_loop_index__`), read
 *  without parsing the whole snapshot; null when it has none. */
export function snapshotFrame(snapshot: string): number | null {
  const m = /"__wp_loop_index__"\s*:\s*(\d+)/.exec(snapshot);
  return m ? Number(m[1]) : null;
}

/** The snapshot to show for Edit frame `frame` (0-based): the one the Loop
 *  numbered so, else none (a frame this Debug didn't receive). */
export function snapshotForFrame(snapshots: readonly string[], frame: number): number | null {
  const i = snapshots.findIndex((s) => snapshotFrame(s) === frame);
  return i >= 0 ? i : null;
}

function nodeInfo(id: string): { title: string; codename: string } {
  const hit = findExecNode(id);
  if (!hit) return { title: "", codename: "" };
  const n = hit.node as LiteNodeLike & { title?: string };
  return {
    title: typeof n.title === "string" ? n.title : "",
    codename: n.type === "WP_Context" ? baseCodename(n.id) : "",
  };
}

/** Select + centre the node. A node in another graph than the one on screen
 *  (inside a subgraph, or back out at the root) opens that graph first, the
 *  same way the breadcrumb does. With a `target`, the row it names (a module,
 *  or the field that writes a variable) blinks once the node is in view. */
export function focusNode(id: string, target?: FlashTarget): void {
  const hit = findExecNode(id);
  if (hit) revealNode(hit.node, hit.graph, target);
}

/** Select + centre `node`, which lives in `graph` (opened first when it
 *  isn't the one on screen); with a `target`, blink that row of it. */
export function revealNode(node: LiteNodeLike, graph: LiteGraphLike, target?: FlashTarget): void {
  const canvas = (app as unknown as { canvas?: CanvasLike }).canvas;
  if (!canvas) return;
  const show = (): void => {
    const c = node as unknown as CollapsibleNode;
    if (c.flags?.collapsed && typeof c.collapse === "function") c.collapse(true);
    canvas.selectNode?.(node);
    canvas.centerOnNode?.(node);
    canvas.setDirty?.(true, true);
    if (target) flashInNode(node, target);
  };
  showGraph(canvas, graph, show);
}

export function create(node: DebugNode, inputName: string) {
  // Snapshots array — populated by `onExecuted` below. With a single
  // PIPELINE_CONTEXT upstream we get one snapshot per run; when a
  // WP_ContextLoop is upstream, ComfyUI iterates the chain N times and
  // ui.wp_debug_snapshot arrives as an N-item array. Iteration picker
  // lets the user step between them.
  const snapshots = ref<string[]>([]);
  const activeIdx = ref<number>(0);
  // State-driven minWidth — seed with the no-filter-visible value;
  // DebugViewer's `request-min-width` emit updates this when the user
  // switches tabs (trace/picks tabs reveal the filter input which
  // widens the toolbar) or the panel chrome otherwise changes.
  let dynamicMinWidth = 420;
  let host: ReturnType<typeof createDomWidgetHost> | null = null;
  const wrapper: Component = {
    setup() {
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => node.mode ?? 0,
        Object.is,
      );
      return () => h(DebugViewer, {
        snapshot: snapshots.value[activeIdx.value] ?? "",
        iterationCount: snapshots.value.length,
        iterationIndex: activeIdx.value,
        nodeMode: nodeMode.value,
        nodeInfo,
        focusNode,
        "onUpdate:iterationIndex": (next: number) => {
          if (next < 0 || next >= snapshots.value.length) return;
          activeIdx.value = next;
          // Stepping Debug picks the same frame in the Loop's Edit frame,
          // so the Context rows, Assembler and WP Seeds follow (as the
          // Assembler's own frame picker does).
          const k = snapshotFrame(snapshots.value[next] ?? "");
          if (k !== null && snapshots.value.length > 1) setFrame(k);
        },
        onRequestMinWidth: (w: number) => {
          if (w === dynamicMinWidth) return;
          dynamicMinWidth = w;
          // `host` is forward-declared so the immediate-mode emit
          // that fires during setup doesn't TDZ on it. By the time
          // a real tab-switch emit lands, host has been assigned.
          host?.requestRelayout();
        },
      });
    },
  };
  // Backend declares `viewer` as required but ignores it at runtime — seed an
  // empty string so workflow serialization and prompt validation both pass.
  host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: "",
    // Fill mode — viewer fills whatever node size the user gives it. Snapshot
    // doesn't push the node larger; oversized snapshots scroll inside.
    fillHost: true,
    minHeight: 200,
    // Pull-based getter — litegraph reads on each layout pass.
    // DebugViewer recomputes from CSS-known toolbar widths whenever
    // active tab changes; we expose the current value here.
    minWidth: () => dynamicMinWidth,
  });
  host.onCleanup(attachThemeDetector(host.widget.element, app));
  // Follow the Loop's Edit frame: picking frame #k there shows the snapshot
  // of frame k here. Base keeps whatever Debug shows.
  const follow = (): void => {
    const k = currentFrame.value;
    if (k === null || snapshots.value.length < 2) return;
    const i = snapshotForFrame(snapshots.value, k);
    if (i !== null) activeIdx.value = i;
  };
  host.onCleanup(watch([currentFrame, snapshots], follow));
  // A copy shown on a subgraph node chains the node's hook too, and stops
  // listening once it is hidden.
  let live = true;
  host.onCleanup(() => {
    live = false;
  });
  const orig = node.onExecuted;
  node.onExecuted = function (output) {
    orig?.call(this, output);
    if (!live) return;
    const snap = output?.wp_debug_snapshot;
    if (!Array.isArray(snap)) return;
    const next = snap.filter((s): s is string => typeof s === "string");
    if (next.length === 0) return;
    snapshots.value = next;
    // Reset active index to 0 on a fresh run so the user sees the
    // first iteration immediately. Preserve `activeIdx` only when the
    // same count came back (rare — N stays stable across rerun).
    if (activeIdx.value >= next.length) activeIdx.value = 0;
  };
  return host;
}
