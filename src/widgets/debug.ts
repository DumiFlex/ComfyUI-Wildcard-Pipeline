import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";

const DebugViewer = defineAsyncComponent(() => import("../components/debug/DebugViewer.vue"));

interface DebugNode extends MountTargetNode {
  onExecuted?: (output: { wp_debug_snapshot?: string[] }) => void;
}

export function create(node: DebugNode, inputName: string) {
  const snapshot = ref("");
  const wrapper: Component = {
    setup: () => () => h(DebugViewer, { snapshot: snapshot.value }),
  };
  // Backend declares `viewer` as required but ignores it at runtime — seed an
  // empty string so workflow serialization and prompt validation both pass.
  const host = createDomWidgetHost(node, inputName, wrapper, {
    initialValue: "",
    // Fill mode — viewer fills whatever node size the user gives it. Snapshot
    // doesn't push the node larger; oversized snapshots scroll inside.
    fillHost: true,
    minHeight: 200,
    minWidth: 280,
  });
  attachThemeDetector(host.widget.element, app);
  const orig = node.onExecuted;
  node.onExecuted = function (output) {
    orig?.call(this, output);
    const snap = output?.wp_debug_snapshot;
    if (Array.isArray(snap) && typeof snap[0] === "string") snapshot.value = snap[0];
  };
  return host;
}
