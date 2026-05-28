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
  injMod,
  cleanerMod,
  varPickerMod,
  ctxLoopMod,
  seedListMod,
  graphEventsMod,
  ToastModule,
  graphMod,
  toastStoreMod,
  badgeMod,
  settingsMod,
  aboutMod,
  topbarMod,
  PlaygroundModule,
  playgroundStoreMod,
] = await Promise.all([
  import("./widgets/context"),
  import("./widgets/debug"),
  import("./widgets/assembler"),
  import("./widgets/injector"),
  import("./widgets/cleaner"),
  import("./widgets/var_picker"),
  import("./widgets/context_loop"),
  import("./widgets/seed_list"),
  import("./extension/graph-events"),
  import("./components/shared/Toast.vue"),
  import("./extension/graph"),
  import("./components/shared/toast-store"),
  import("./extension/subgraph-badge"),
  import("./extension/settings"),
  import("./extension/about-badges"),
  import("./extension/topbar"),
  import("./components/settings/DisplayPlaygroundModal.vue"),
  import("./components/settings/playground-store"),
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

// Singleton Display Playground modal — same lifecycle pattern as the
// toast root. The `settings.ts` launcher button flips the reactive
// `playgroundOpen` ref; this app renders the modal on top of any
// surface (settings panel, canvas, anywhere). Capture the app
// reference so the modal can read/write settings via
// extensionManager.setting.set/get.
const playgroundRoot = document.createElement("div");
playgroundRoot.id = "wp-playground-root";
document.body.appendChild(playgroundRoot);
createApp(PlaygroundModule.default).mount(playgroundRoot);
playgroundStoreMod.setComfyApp(app);

// ComfyUI hands us untyped LiteGraph nodes; we only care about the surface
// the glue files import. Typing the param as the parameter of `create` /
// `mountHelper` makes TS pick the right shape without explicit casts.
type ContextCreateNode = Parameters<typeof ctxMod.create>[0];
type DebugCreateNode = Parameters<typeof dbgMod.create>[0];
type InjectorCreateNode = Parameters<typeof injMod.create>[0];
type CleanerCreateNode = Parameters<typeof cleanerMod.create>[0];
type VarPickerCreateNode = Parameters<typeof varPickerMod.create>[0];
type CtxLoopCreateNode = Parameters<typeof ctxLoopMod.create>[0];
type SeedListCreateNode = Parameters<typeof seedListMod.create>[0];
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
settingsMod.applyDisplayPrefs(app);
settingsMod.watchA11ySystemPrefs();
// Wire the toast store to read its default lifeMs + suppress-info
// filter from the settings store. Setter pattern avoids the circular
// import that would form if toast-store imported from settings
// directly (settings already imports pushToast).
toastStoreMod.setLifetimeProvider(() => settingsMod.getToastLifetimeMs());
toastStoreMod.setSuppressInfoFilter(() => settingsMod.shouldSuppressInfoToasts());
// Dev-only: expose `wpDebugA11y` on window so contributors can flip
// reduce-motion / high-contrast classes from the DevTools console
// without touching OS-level settings.
settingsMod.installDebugHelpers();
// Defer marking boot complete by a short tick so ComfyUI's load-fire
// onChange (which replays the stored value into our handlers) runs
// while toast feedback is still suppressed. Without this, every page
// load would pop a toast for whichever a11y mode is currently saved.
setTimeout(() => settingsMod.markBootCompleted(), 100);

// Detect ComfyUI frontend version BEFORE registerExtension so we can
// pick the right topbar render path. ≥ 1.33.9 → declarative
// `actionBarButtons` extension property (LoRA Manager's modern path).
// Older builds → manual attach in `setup()`. The version probe is
// cheap (window var or one fetch to /system_stats) and runs once.
const useActionBar = await topbarMod.supportsActionBar();

app.registerExtension({
  name: "wildcard-pipeline",

  // About panel — small badges under our extension's row, link out to
  // the repo, issue tracker, and docs. Uses PrimeIcons shipped by ComfyUI.
  aboutPageBadges: aboutMod.ABOUT_BADGES,

  // Topbar dropdown entry — opens the SPA at /wp/dashboard. The direct
  // toolbar button (mounted via actionBarButtons / setup() below) is
  // the primary surface; this command is the dropdown twin so the SPA
  // is reachable on builds where neither toolbar path works.
  commands: topbarMod.TOPBAR_COMMANDS,
  menuCommands: topbarMod.TOPBAR_MENU_COMMANDS,

  // Modern actionbar entry — only included on ComfyUI ≥ 1.33.9.
  // Including it on older builds would either be silently ignored or
  // throw, depending on the frontend's strictness; conditional include
  // is the safe path.
  ...(useActionBar ? { actionBarButtons: topbarMod.ACTION_BAR_BUTTONS } : {}),

  // ComfyUI Settings panel entries — accessibility tri-state combos. Their
  // onChange handlers re-run applyA11yClasses to flip the body markers.
  settings,

  // Mount the brand button. Two paths:
  //   - actionBar: Vue actionbar already rendered our entry from
  //     `actionBarButtons` above; we just need the rAF loop that
  //     swaps the Iconify placeholder `<i>` for our brand SVG once
  //     Vue's mount cycle settles. ComfyUI's default button styling
  //     handles padding/hover/text-color — no inline overrides.
  //   - legacy: manually build a default ComfyButton + group and
  //     attach before app.menu.settingsGroup, then run the same
  //     icon swap loop.
  async setup() {
    if (!useActionBar) {
      await topbarMod.attachLegacyTopbarButton(app);
    }
    topbarMod.startIconReplaceLoop();
  },

  getCustomWidgets() {
    return {
      WP_CONTEXT_MODULES: (node: ContextCreateNode, inputName: string) =>
        ctxMod.create(node, inputName),
      WP_DEBUG_VIEWER: (node: DebugCreateNode, inputName: string) =>
        dbgMod.create(node, inputName),
      WP_INJECTOR_ROWS: (node: InjectorCreateNode, inputName: string) =>
        injMod.create(node, inputName),
      WP_CLEANER: (node: CleanerCreateNode, inputName: string) =>
        cleanerMod.create(node, inputName),
      WP_VAR_PICKER: (node: VarPickerCreateNode, inputName: string) =>
        varPickerMod.create(node, inputName),
      // Loop's DOM widget uses `WP_CONTEXT_LOOP_WIDGET` — a widget-only
      // TYPE (see `wp_nodes/types.py::ContextLoopWidgetInput`) distinct
      // from the wire-payload TYPE `WP_CONTEXT_LOOP_CONFIG` carried on
      // the loop's output + WP_SeedList's `loop_config` socket. NO
      // factory is registered for `WP_CONTEXT_LOOP_CONFIG` here — that's
      // deliberate, so consumers of that type render as plain sockets
      // (gated factories returning `{widget: undefined}` ended up
      // hiding the socket entirely, see the type's docstring).
      WP_CONTEXT_LOOP_WIDGET: (node: CtxLoopCreateNode, inputName: string) =>
        ctxLoopMod.create(node, inputName),
      WP_SEED_LIST_CONFIG: (node: SeedListCreateNode, inputName: string) =>
        seedListMod.create(node, inputName),
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
// upstream Context provides. One toast per offending assembler with a
// Focus button that scrolls + selects that node, so users with several
// assemblers can jump straight to the broken one (the runtime drops
// missing vars cleanly anyway, this just nudges them to fix the wire).
interface AppWithQueue {
  queuePrompt?: (...args: unknown[]) => unknown;
  graph?: unknown;
  canvas?: AppCanvas;
}
interface AppCanvas {
  canvas?: HTMLCanvasElement;
  ds?: { scale?: number; offset?: [number, number] };
  centerOnNode?: (n: unknown) => void;
  selectNode?: (n: unknown, addToCurrentSelection?: boolean) => void;
  setDirty?: (foreground: boolean, background: boolean) => void;
}
interface FocusableNode {
  id: number;
  pos?: [number, number] | number[];
  size?: [number, number] | number[];
  flags?: { collapsed?: boolean };
  collapse?: (force?: boolean) => void;
}
const appQ = app as unknown as AppWithQueue;

const FLASH_DURATION_MS = 1500;
const FLASH_STYLE_ID = "wp-node-flash-style";

/** Inject the keyframes/border CSS for the node-flash overlay once.
 *  Idempotent — re-calling skips if the style tag is already in head. */
function ensureFlashStyle() {
  if (document.getElementById(FLASH_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FLASH_STYLE_ID;
  // Three-pulse border flash. Border-radius 8px matches LiteGraph node
  // corners closely enough at default scale; an exact pixel match isn't
  // required because the flash is temporary + slightly larger than the
  // node so the border reads as a halo, not an inset outline.
  style.textContent = `
@keyframes wp-node-flash-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--wp-accent, #ffd400), 0 0 12px 4px rgba(255, 212, 0, 0.6); opacity: 1; }
  50%      { box-shadow: 0 0 0 4px var(--wp-accent, #ffd400), 0 0 20px 8px rgba(255, 212, 0, 0.85); opacity: 1; }
}
.wp-node-flash {
  position: fixed;
  pointer-events: none;
  z-index: 10000;
  border-radius: 8px;
  animation: wp-node-flash-pulse 0.5s ease-in-out 3;
}
`;
  document.head.appendChild(style);
}

/** Focus + select a node, uncollapsing it first if needed and pulsing
 *  a brief border around it so the user's eye lands on it instantly.
 *  No-op when the canvas surface doesn't expose the calls (e.g.
 *  headless tests). Subgraph-resident nodes can still be focused once
 *  the user navigates into the subgraph; we don't auto-navigate to
 *  keep the flow predictable.
 *
 *  Flash strategy: a position:fixed DOM overlay anchored to the node's
 *  screen-space bounds via the canvas's drag-state transform. LiteGraph
 *  nodes are drawn on a `<canvas>`, so there's no per-node DOM to
 *  style — an overlay div is the cleanest way to add a CSS border
 *  without monkey-patching the canvas render loop. */
function focusNode(node: FocusableNode) {
  const canvas = appQ.canvas;
  if (!canvas) return;
  try {
    // Uncollapse before centering — a collapsed node has tiny bounds,
    // so centerOnNode would scroll to a hard-to-spot strip. Only call
    // collapse() to TOGGLE off when it's currently collapsed; calling
    // it on an expanded node would collapse it.
    if (node.flags?.collapsed && typeof node.collapse === "function") {
      try { node.collapse(true); } catch { /* fall through */ }
    }
    canvas.centerOnNode?.(node);
    canvas.selectNode?.(node, false);
    canvas.setDirty?.(true, true);

    // Flashing-border overlay. Compute screen-space bounds AFTER the
    // centerOnNode pan settles (next frame) — pulling them now would
    // anchor the overlay to the pre-pan position and the border would
    // drift off the node.
    requestAnimationFrame(() => mountFlashOverlay(node, canvas));
  } catch (err) {
    console.warn("[wildcard-pipeline] focusNode failed:", err);
  }
}

function mountFlashOverlay(node: FocusableNode, canvas: AppCanvas) {
  const lcMaybe = canvas.canvas;
  const dsMaybe = canvas.ds;
  if (!lcMaybe || !dsMaybe) return;
  // Re-bind into non-optional locals so the rAF closure below
  // captures definite types (TS narrowing doesn't carry across
  // function boundaries).
  const lc: HTMLCanvasElement = lcMaybe;
  const ds: NonNullable<AppCanvas["ds"]> = dsMaybe;
  // LiteGraph transform: screen = (graph_pos + offset) * scale.
  // Node body sits BELOW the title bar; the title bar (~22px in graph
  // units) is drawn above pos[1]. Pad the overlay slightly above pos[1]
  // so the flash wraps the title too — that's the "node card" the user
  // perceives. The padding is in graph units, scaled with the viewport.
  const TITLE_PAD = 24;

  ensureFlashStyle();
  const overlay = document.createElement("div");
  overlay.className = "wp-node-flash";
  document.body.appendChild(overlay);

  // The focused node may resize after we mount the overlay — common
  // for our DOM widgets where uncollapsing triggers a content
  // measurement that grows the node's height. A static overlay
  // anchored once would drift off the node mid-flash. Drive position
  // + size from `node.pos`/`node.size` every frame for the flash
  // duration so the border tracks the node as it grows / settles.
  // Pan/zoom likewise pick up via the live `ds.offset`/`ds.scale`
  // reads, so dragging the canvas during the flash also stays
  // anchored.
  const start = performance.now();
  let raf = 0;
  function tick() {
    const r = lc.getBoundingClientRect();
    const scale = ds.scale ?? 1;
    const offset = ds.offset ?? [0, 0];
    const pos = node.pos ?? [0, 0];
    const size = node.size ?? [200, 80];
    const sx = (pos[0] + offset[0]) * scale;
    const sy = (pos[1] - TITLE_PAD + offset[1]) * scale;
    const sw = size[0] * scale;
    const sh = (size[1] + TITLE_PAD) * scale;
    overlay.style.left = `${r.left + sx}px`;
    overlay.style.top = `${r.top + sy}px`;
    overlay.style.width = `${sw}px`;
    overlay.style.height = `${sh}px`;
    if (performance.now() - start < FLASH_DURATION_MS) {
      raf = requestAnimationFrame(tick);
    }
  }
  raf = requestAnimationFrame(tick);
  window.setTimeout(() => {
    cancelAnimationFrame(raf);
    overlay.remove();
  }, FLASH_DURATION_MS);
}

const origQueuePrompt = appQ.queuePrompt;
if (typeof origQueuePrompt === "function") {
  appQ.queuePrompt = function (...args: unknown[]) {
    try {
      const graph = appQ.graph as unknown as LiteGraphLike;
      // Note: per-Context seed snapshot now happens via each
      // seed widget's `beforeQueued` hook (registered in
      // widgets/context.ts). That fires after queue submit but
      // BEFORE control_after_generate rotates the value, capturing
      // exactly the seed that's about to run.
      const TEMPLATE_VAR = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;
      // walkAllNodes recurses into nested subgraphs so assemblers inside a
      // subgraph still get their templates scanned. collectUpstreamVariables
      // crosses boundaries the other direction.
      for (const { node } of graphMod.walkAllNodes(graph)) {
        if (node.type !== "WP_PromptAssembler") continue;
        // Skip bypassed (mode=4) + muted (mode=2) nodes — LiteGraph
        // omits them from execution, so flagging unresolved vars on a
        // node that won't run is just noise. mode is a bare number on
        // LGraphNode; missing/0 = ALWAYS (normal execution).
        const mode = (node as { mode?: number }).mode;
        if (mode === 2 || mode === 4) continue;
        const w = node.widgets?.find((x: { name: string; value: unknown }) => x.name === "template");
        const tmpl = typeof w?.value === "string" ? w.value : "";
        if (!tmpl) continue;
        const upstream = new Set(graphMod.collectUpstreamVariables(graph, node));
        const missing = new Set<string>();
        for (const m of tmpl.matchAll(TEMPLATE_VAR)) {
          const name = m[1];
          if (!name.startsWith("__") && !upstream.has(name)) missing.add(name);
        }
        if (missing.size === 0) continue;
        const list = [...missing].map((v) => `$${v}`).join(", ");
        // Capture node by closure — the Focus action calls into
        // app.canvas at click time, not push time, so the reference
        // stays live even if the graph is re-rendered.
        const targetNode = node;
        toastStoreMod.pushToast(
          `Assembler #${node.id}: ${list} unresolved — will render empty.`,
          {
            severity: "warning",
            lifeMs: 8000,
            action: { label: "Focus", onSelect: () => focusNode(targetNode as unknown as FocusableNode) },
          },
        );
      }
    } catch (err) {
      // Validation must never block the queue — log and proceed.
      console.warn("[wildcard-pipeline] pre-run scan failed:", err);
    }
    return origQueuePrompt.apply(this, args);
  };
}

console.info("[wildcard-pipeline] extension loaded");
