import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import { reactiveFromGraph } from "../extension/reactive";

const DebugViewer = defineAsyncComponent(() => import("../components/debug/DebugViewer.vue"));

interface DebugNode extends MountTargetNode {
  onExecuted?: (output: { wp_debug_snapshot?: string[] }) => void;
  mode?: number;
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
  let dynamicMinWidth = 372;
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
        "onUpdate:iterationIndex": (next: number) => {
          if (next >= 0 && next < snapshots.value.length) activeIdx.value = next;
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
  attachThemeDetector(host.widget.element, app);
  const orig = node.onExecuted;
  node.onExecuted = function (output) {
    orig?.call(this, output);
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
