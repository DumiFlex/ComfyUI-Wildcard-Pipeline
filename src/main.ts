import { app } from "#comfyui/app";
import { createApp } from "vue";
import type { LiteGraphLike } from "./extension/graph";

// ComfyUI's `getCustomWidgets` invokes each factory synchronously and destructures
// the return value. Returning a Promise from `import()` yields `{ widget: undefined }`
// and the widget never mounts. Resolve all widget chunks at module load via top-level
// await so factories can run sync. Vite still emits the chunks separately, so the
// entry stays small (~0.5 KB gzip) and the heavy `_shared` chunk only fetches once.
const [
  ctxMod,
  dbgMod,
  asmMod,
  graphEventsMod,
  ToastModule,
  graphMod,
  toastStoreMod,
  badgeMod,
  settingsMod,
  aboutMod,
] = await Promise.all([
  import("./widgets/context"),
  import("./widgets/debug"),
  import("./widgets/assembler"),
  import("./extension/graph-events"),
  import("./components/shared/Toast.vue"),
  import("./extension/graph"),
  import("./components/shared/toast-store"),
  import("./extension/subgraph-badge"),
  import("./extension/settings"),
  import("./extension/about-badges"),
  // Webfonts (Inter 400/600 + JetBrains Mono 400) — side-effect import,
  // the module just owns the @font-face CSS chunk.
  import("./extension/fonts"),
]);

// Singleton toast container — one Vue app mounted to a body-level div renders
// every toast pushed via shared/toast-store. Each Context node's Vue app
// imports the same store module, so toasts surface from anywhere.
const toastRoot = document.createElement("div");
toastRoot.id = "wp-toast-root";
document.body.appendChild(toastRoot);
createApp(ToastModule.default).mount(toastRoot);

// ComfyUI hands us untyped LiteGraph nodes; we only care about the surface
// the glue files import. Typing the param as the parameter of `create` /
// `mountHelper` makes TS pick the right shape without explicit casts.
type ContextCreateNode = Parameters<typeof ctxMod.create>[0];
type DebugCreateNode = Parameters<typeof dbgMod.create>[0];
type AssemblerHelperNode = Parameters<typeof asmMod.mountHelper>[0];

interface NodeData { name: string }
interface NodeType { prototype: { onNodeCreated?: (this: AssemblerHelperNode, ...args: unknown[]) => void } }

// Build the settings array eagerly — `app` is the same singleton ComfyUI
// will hand back at runtime, so onChange callbacks captured here read the
// extensionManager via the same reference.
const settings = settingsMod.buildSettings(app);

// Apply current a11y prefs on load + listen for OS-level changes so
// "Match system" reflects toggles in OS settings without a page reload.
// Note: ComfyUI also fires each setting's onChange on page load with the
// stored value, so applyA11yClasses is mostly belt-and-suspenders for
// the case where the extensionManager is ready before the load-fire.
settingsMod.applyA11yClasses(app);
settingsMod.watchA11ySystemPrefs();

app.registerExtension({
  name: "wildcard-pipeline",

  // About panel — small badges under our extension's row, link out to
  // the repo, issue tracker, and docs. Uses PrimeIcons shipped by ComfyUI.
  aboutPageBadges: aboutMod.ABOUT_BADGES,

  // ComfyUI Settings panel entries — accessibility tri-state combos. Their
  // onChange handlers re-run applyA11yClasses to flip the body markers.
  settings,

  getCustomWidgets() {
    return {
      WP_CONTEXT_MODULES: (node: ContextCreateNode, inputName: string) =>
        ctxMod.create(node, inputName),
      WP_DEBUG_VIEWER: (node: DebugCreateNode, inputName: string) =>
        dbgMod.create(node, inputName),
    };
  },

  beforeRegisterNodeDef(nodeType: unknown, nodeData: NodeData) {
    if (nodeData.name !== "WP_PromptAssembler") return;
    const nt = nodeType as NodeType;
    const orig = nt.prototype.onNodeCreated;
    nt.prototype.onNodeCreated = function (this: AssemblerHelperNode, ...args: unknown[]) {
      orig?.apply(this, args);
      asmMod.mountHelper(this);
    };
  },

  // Fires after ComfyUI restores all widget values from the loaded workflow.
  // Without this, assembler's snapshot is computed BEFORE upstream Context
  // values land — preview briefly shows missing-var warnings then settles
  // ~400ms later when the polling fallback catches up. Notify all reactive
  // widgets to recompute immediately.
  afterConfigureGraph() {
    graphEventsMod.notifyGraphLoaded();
    // Re-attach badges in case the loaded workflow contained SubgraphNodes
    // that bypassed nodeCreated (loaded path uses different hooks).
    const root = (app as unknown as { graph?: LiteGraphLike }).graph;
    if (root) badgeMod.attachAllSubgraphBadges(root);
  },

  // Fires for every node when it's instantiated — including SubgraphNodes,
  // which beforeRegisterNodeDef does NOT see (litegraph registers them at
  // runtime, not via ComfyUI's node-def pipeline). We attach a corner
  // conflict badge so users can spot WP issues nested inside a subgraph
  // without opening it.
  nodeCreated(node: unknown) {
    const n = node as { isSubgraphNode?: () => boolean };
    if (!n.isSubgraphNode?.()) return;
    const root = (app as unknown as { graph?: LiteGraphLike }).graph;
    if (root) badgeMod.attachSubgraphBadge(node as Parameters<typeof badgeMod.attachSubgraphBadge>[0], root);
  },

  // Same intent as nodeCreated but fires for nodes restored from a saved
  // workflow. ComfyUI splits the lifecycle so we cover both paths.
  loadedGraphNode(node: unknown) {
    const n = node as { isSubgraphNode?: () => boolean };
    if (!n.isSubgraphNode?.()) return;
    const root = (app as unknown as { graph?: LiteGraphLike }).graph;
    if (root) badgeMod.attachSubgraphBadge(node as Parameters<typeof badgeMod.attachSubgraphBadge>[0], root);
  },
});

// Pre-run validation — when the user queues a prompt, scan every
// WP_PromptAssembler in the graph for $vars in its template that no
// upstream Context provides. Surface a single toast listing them so the
// user can fix-or-accept (the runtime drops missing vars cleanly anyway).
interface AppWithQueue {
  queuePrompt?: (...args: unknown[]) => unknown;
  graph?: unknown;
}
const appQ = app as unknown as AppWithQueue;
const origQueuePrompt = appQ.queuePrompt;
if (typeof origQueuePrompt === "function") {
  appQ.queuePrompt = function (...args: unknown[]) {
    try {
      const graph = appQ.graph as unknown as LiteGraphLike;
      const TEMPLATE_VAR = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;
      const allMissing = new Set<string>();
      // walkAllNodes recurses into nested subgraphs so assemblers inside a
      // subgraph still get their templates scanned. collectUpstreamVariables
      // crosses boundaries the other direction.
      for (const { node } of graphMod.walkAllNodes(graph)) {
        if (node.type !== "WP_PromptAssembler") continue;
        const w = node.widgets?.find((x: { name: string; value: unknown }) => x.name === "template");
        const tmpl = typeof w?.value === "string" ? w.value : "";
        if (!tmpl) continue;
        const upstream = new Set(graphMod.collectUpstreamVariables(graph, node));
        for (const m of tmpl.matchAll(TEMPLATE_VAR)) {
          const name = m[1];
          if (!name.startsWith("__") && !upstream.has(name)) allMissing.add(name);
        }
      }
      if (allMissing.size > 0) {
        const list = [...allMissing].map((v) => `$${v}`).join(", ");
        toastStoreMod.pushToast(`Unresolved in templates: ${list} — will render empty.`, {
          severity: "warning",
          lifeMs: 6000,
        });
      }
    } catch (err) {
      // Validation must never block the queue — log and proceed.
      console.warn("[wildcard-pipeline] pre-run scan failed:", err);
    }
    return origQueuePrompt.apply(this, args);
  };
}

console.info("[wildcard-pipeline] extension loaded");
