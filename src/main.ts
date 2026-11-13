import { app } from "#comfyui/app";
import type { LiteGraphLike } from "./extension/graph";

// ComfyUI's `getCustomWidgets` invokes each factory synchronously and destructures
// the return value. Returning a Promise from `import()` yields `{ widget: undefined }`
// and the widget never mounts. So the widget glue is loaded at module load via
// top-level await, and the factories below can run sync. It all comes from one
// chunk — see `boot.ts` for why it is one, and why it has to be awaited here.
const {
  ctxMod,
  dbgMod,
  asmMod,
  tmplMod,
  injMod,
  cleanerMod,
  modelInfoMod,
  togglesMod,
  togglesMergeMod,
  imageFilterWidgetMod,
  labelGridMod,
  noteMod,
  nodeGroupMod,
  modeRelayMod,
  bookmarkMod,
  stripControlInputs,
  imageFilterMod,
  varPickerMod,
  ctxLoopMod,
  seedListMod,
  graphEventsMod,
  graphMod,
  assemblerVarsMod,
  toastStoreMod,
  settingsMod,
  aboutMod,
  topbarMod,
  playgroundStoreMod,
  installClipboardShield,
  dimWidgetsWhileSkipped,
  answerCanvasFacts,
  createApp,
  watch,
  loadToast,
  loadPlayground,
  loadSubgraphBadge,
  badgeSlotMod,
  promoteMod,
  showMod,
  eyeMod,
  textareaLabelMod,
  loadImageFilterPicker,
  loadBookmarkDock,
  loadNodeHelp,
  nodeToolbarMod,
} = await import("./boot");

// Singleton toast container — one Vue app mounted to a body-level div renders
// every toast pushed via shared/toast-store. Each Context node's Vue app
// imports the same store module, so toasts surface from anywhere.
//
// Mounted on the first toast rather than at startup: most sessions never show
// one, and the store queues whatever is pushed while the chunk loads. `appear`
// on the stack's TransitionGroup keeps that first toast's slide-in.
let toastMounted = false;
watch(
  () => toastStoreMod.toasts.value.length,
  (count) => {
    if (toastMounted || count === 0) return;
    toastMounted = true;
    void loadToast().then((m) => {
      const toastRoot = document.createElement("div");
      toastRoot.id = "wp-toast-root";
      document.body.appendChild(toastRoot);
      createApp(m.default).mount(toastRoot);
    });
  },
  { immediate: true },
);

// Singleton Display Playground modal — same lifecycle pattern as the toast
// root, and likewise mounted the first time the `settings.ts` launcher button
// flips the reactive `playgroundOpen` ref. The modal renders on top of any
// surface (settings panel, canvas, anywhere). Hand the store the app now so
// the modal can read/write settings via extensionManager.setting.set/get.
playgroundStoreMod.setComfyApp(app);
let playgroundMounted = false;
watch(playgroundStoreMod.playgroundOpen, (open) => {
  if (playgroundMounted || !open) return;
  playgroundMounted = true;
  void loadPlayground().then((m) => {
    const playgroundRoot = document.createElement("div");
    playgroundRoot.id = "wp-playground-root";
    document.body.appendChild(playgroundRoot);
    createApp(m.default).mount(playgroundRoot);
  });
});

// Node help dialog ("?" in the selection toolbar): one body-level app, mounted
// the first time help opens, like the playground above.
let helpMounted = false;
watch(nodeToolbarMod.helpTarget, (target) => {
  if (helpMounted || !target) return;
  helpMounted = true;
  void loadNodeHelp().then((m) => {
    const root = document.createElement("div");
    root.id = "wp-node-help-root";
    document.body.appendChild(root);
    createApp(m.default).mount(root);
  });
});

// WP Image Filter: listen for nodes that pause for a pick. The picker (its own
// chunk) mounts the first time one does, as one body-level app like the toasts.
imageFilterMod.installImageFilter(
  (app as unknown as { api?: Parameters<typeof imageFilterMod.installImageFilter>[0] }).api,
  () => {
    void loadImageFilterPicker().then((m) => {
      const root = document.createElement("div");
      root.id = "wp-image-filter-root";
      document.body.appendChild(root);
      createApp(m.default).mount(root);
    });
  },
);

// Global clipboard shield. WP modals Teleport to <body>, so their editable
// inputs (the Injector variable-binding field, instance-edit modals, blocklist,
// pickers, …) sit OUTSIDE the per-widget `inner` shield — Ctrl+A/C/V there
// would bubble to ComfyUI's canvas and select/copy/paste NODES instead of text.
// A body-level bubble shield is the catch-all: it fires before ComfyUI's
// document/window handlers, lets the native text op run, and never preventDefaults.
installClipboardShield(document.body);

// Conflict badge for SubgraphNodes holding WP nodes. It pulls in the conflict
// scanner, which nothing else on the startup path needs, so it loads the first
// time the graph actually has a subgraph node.
type BadgeModule = Awaited<ReturnType<typeof loadSubgraphBadge>>;
let badgeModPromise: Promise<BadgeModule> | null = null;
function withBadges(fn: (badgeMod: BadgeModule) => void): void {
  badgeModPromise ??= loadSubgraphBadge();
  void badgeModPromise.then(fn);
}
function isSubgraphNode(node: unknown): boolean {
  return (node as { isSubgraphNode?: () => boolean }).isSubgraphNode?.() === true;
}
// Nodes 2.0 only notices a badge that is in `node.badges` when it first
// renders the node, so every SubgraphNode gets its badge getter right away,
// before the badge module has loaded (see extension/badge-slot.ts).
badgeSlotMod.setBadgeHost(() => (app as unknown as { extensionManager?: unknown }).extensionManager);
function prepareBadge(node: unknown): void {
  badgeSlotMod.ensureBadgeSlot(node as { badges?: unknown[] });
}

// ComfyUI hands us untyped LiteGraph nodes; we only care about the surface
// the glue files import. Typing the param as the parameter of `create` /
// `mountHelper` makes TS pick the right shape without explicit casts.
type ContextCreateNode = Parameters<typeof ctxMod.create>[0];
type DebugCreateNode = Parameters<typeof dbgMod.create>[0];
type InjectorCreateNode = Parameters<typeof injMod.create>[0];
type CleanerCreateNode = Parameters<typeof cleanerMod.create>[0];
type ModelInfoCreateNode = Parameters<typeof modelInfoMod.create>[0];
type TogglesCreateNode = Parameters<typeof togglesMod.create>[0];
type ImageFilterCreateNode = Parameters<typeof imageFilterWidgetMod.create>[0];
type LabelGridCreateNode = Parameters<typeof labelGridMod.create>[0];
type VarPickerCreateNode = Parameters<typeof varPickerMod.create>[0];
type CtxLoopCreateNode = Parameters<typeof ctxLoopMod.create>[0];
type SeedListCreateNode = Parameters<typeof seedListMod.create>[0];
type TemplateEditorNode = Parameters<typeof tmplMod.create>[0];
type AssemblerHelperNode = Parameters<typeof asmMod.mountHelper>[0];

interface NodeData { name: string }
interface NodeType {
  prototype: {
    onNodeCreated?: (this: AssemblerHelperNode, ...args: unknown[]) => void;
    onConfigure?: (this: AssemblerHelperNode, info: unknown) => void;
  };
}

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
settingsMod.listenForManagerSettings(app);
// The manager's AI asks which variables this canvas sets at run time.
answerCanvasFacts(() => (app as unknown as { graph?: LiteGraphLike }).graph);
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

// WP Bookmark's dock lives in its own chunk: loaded by the top-bar button or
// once a workflow has a bookmark (unless the user closed the dock).
function toggleBookmarkDock(): void {
  void loadBookmarkDock().then((m) => m.toggleDock());
}
function maybeShowBookmarkDock(): void {
  if (bookmarkMod.dockWantsAutoOpen()) void loadBookmarkDock().then((m) => m.showDock());
}
const BOOKMARK_COMMANDS = [
  { id: "wildcardPipeline.bookmark.next", label: "WP Bookmarks: next bookmark", function: () => bookmarkMod.jumpStep(1) },
  { id: "wildcardPipeline.bookmark.previous", label: "WP Bookmarks: previous bookmark", function: () => bookmarkMod.jumpStep(-1) },
  { id: "wildcardPipeline.bookmark.back", label: "WP Bookmarks: back to where you were", function: () => bookmarkMod.jumpBack() },
  { id: "wildcardPipeline.bookmark.add", label: "WP Bookmarks: bookmark this view", function: () => bookmarkMod.addBookmarkHere() },
  { id: "wildcardPipeline.bookmark.dock", label: "WP Bookmarks: show or hide the dock", function: toggleBookmarkDock },
];

/** "Merge into WP Toggles" on a right-clicked Boolean-like node. */
function mergeMenuItems(node: unknown): Array<{ content: string; callback: () => void } | null> {
  type MergeNode = Parameters<typeof togglesMergeMod.isMergeable>[0];
  type MergeGraph = Parameters<typeof togglesMergeMod.mergeIntoToggles>[0];
  const canvas = (app as unknown as { canvas?: { selected_nodes?: Record<string, MergeNode>; graph?: MergeGraph } }).canvas;
  if (!togglesMergeMod.isMergeable(node as MergeNode)) return [];
  const picked = Object.values(canvas?.selected_nodes ?? {});
  const selected = picked.includes(node as MergeNode) ? picked : [node as MergeNode];
  const count = Math.min(selected.filter(togglesMergeMod.isMergeable).length, 16);
  return [null, {
    content: `Merge into WP Toggles (${count})`,
    callback: () => {
      const graph = canvas?.graph;
      if (!graph) return;
      const lg = (globalThis as { LiteGraph?: { createNode(type: string): MergeNode | null } }).LiteGraph;
      const res = togglesMergeMod.mergeIntoToggles(graph, selected, () => lg?.createNode("WP_Toggles") ?? null);
      if (res.skipped.length) {
        toastStoreMod.pushToast(`Not merged: ${res.skipped.join(", ")}. Only nodes with one on/off value, one BOOLEAN output and no wired inputs can merge (16 at most).`, { severity: "warning" });
      }
    },
  }];
}

app.registerExtension({
  name: "wildcard-pipeline",

  // About panel — small badges under our extension's row, link out to
  // the repo, issue tracker, and docs. Uses PrimeIcons shipped by ComfyUI.
  aboutPageBadges: aboutMod.ABOUT_BADGES,

  // "Show on / Hide from subgraph node" on a WP panel node inside a
  // subgraph, and "Merge into WP Toggles" on a Boolean-like node.
  getNodeMenuItems(node: unknown) {
    return [...showMod.menuItems(node), ...mergeMenuItems(node)];
  },

  // Topbar dropdown entry — opens the SPA at /wp/dashboard. The direct
  // toolbar button (mounted via actionBarButtons / setup() below) is
  // the primary surface; this command is the dropdown twin so the SPA
  // is reachable on builds where neither toolbar path works.
  // The bookmark commands ship without keys: bind them in ComfyUI's
  // Settings › Keybinding, where its own dialog flags clashes.
  commands: [
    ...topbarMod.TOPBAR_COMMANDS,
    ...BOOKMARK_COMMANDS,
    ...nodeToolbarMod.toolbarCommands(() => (app as unknown as { canvas?: Parameters<typeof nodeToolbarMod.selectedItems>[0] }).canvas),
  ],

  // Our "?" (help) and pencil (edit) in ComfyUI's selection toolbar, drawn
  // on an accent dot so they read as ours (extension/node-toolbar.ts).
  getSelectionToolboxCommands(item: unknown) {
    return nodeToolbarMod.toolboxCommandsFor(item);
  },
  menuCommands: [
    ...topbarMod.TOPBAR_MENU_COMMANDS,
    { path: ["Extensions", "Wildcard Pipeline", "Bookmarks"], commands: BOOKMARK_COMMANDS.map((c) => c.id) },
  ],

  // "Add WP Bookmark here" on a right-click of the empty canvas.
  getCanvasMenuItems(canvas: unknown) {
    const at = [...((canvas as { graph_mouse?: number[] }).graph_mouse ?? [])];
    return [null, { content: "Add WP Bookmark here", callback: () => bookmarkMod.addBookmarkHere(at.length >= 2 ? at : undefined) }];
  },

  // Modern actionbar entry — only included on ComfyUI ≥ 1.33.9.
  // Including it on older builds would either be silently ignored or
  // throw, depending on the frontend's strictness; conditional include
  // is the safe path.
  ...(useActionBar
    ? {
        actionBarButtons: [
          ...topbarMod.ACTION_BAR_BUTTONS,
          { icon: "pi pi-bookmark", tooltip: topbarMod.BOOKMARK_TOOLTIP, onClick: toggleBookmarkDock },
        ],
      }
    : {}),

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
    bookmarkMod.installBookmarkKeys();
    bookmarkMod.installHiddenFilter();
    // The eye in ComfyUI's subgraph Parameters panel shows WP panels too.
    eyeMod.installSubgraphEye(app as unknown as Parameters<typeof eyeMod.installSubgraphEye>[0]);
    // ComfyUI's text-box name label floats over the text once a WP node's
    // box scrolls; fade it out there (Nodes 2.0 only).
    textareaLabelMod.installTextareaLabelFix((id) => {
      const graph = (app as unknown as { canvas?: { graph?: { getNodeById(id: string | number): { type?: string } | null } } }).canvas?.graph;
      const type = graph?.getNodeById(id)?.type ?? graph?.getNodeById(Number(id))?.type;
      return typeof type === "string" && type.startsWith("WP_");
    });
    // A bookmark joining the graph (added, pasted or loaded) brings the
    // dock up unless the user closed it.
    bookmarkMod.onBookmarkAdded(maybeShowBookmarkDock);
    maybeShowBookmarkDock();
  },

  // WP Note: a frontend-only node (like ComfyUI's Note) that explains a
  // workflow. Registered here because it has no Python node definition.
  registerCustomNodes() {
    noteMod.registerNoteNode();
    nodeGroupMod.registerNodeGroupNode();
    modeRelayMod.registerModeRelayNode();
    bookmarkMod.registerBookmarkNode();
  },

  beforeRegisterVueAppNodeDefs(defs: unknown[]) {
    noteMod.fixNoteDef(defs as Parameters<typeof noteMod.fixNoteDef>[0]);
    noteMod.fixFrontendDef(
      defs as Parameters<typeof noteMod.fixFrontendDef>[0],
      nodeGroupMod.NODE_GROUP_TYPE,
      "WP Node Group",
      "Gathers nodes so one WP Toggles control can mute or bypass them all. It never runs.",
    );
    noteMod.fixFrontendDef(
      defs as Parameters<typeof noteMod.fixFrontendDef>[0],
      modeRelayMod.MODE_RELAY_TYPE,
      "WP Mode Relay",
      "Watches nodes' mute / bypass and passes a mode on to a WP Node Group. It never runs.",
    );
    noteMod.fixFrontendDef(
      defs as Parameters<typeof noteMod.fixFrontendDef>[0],
      bookmarkMod.BOOKMARK_NODE_TYPE,
      "WP Bookmark",
      "Marks a spot on the canvas to jump back to, with a shortcut or from the Bookmarks dock. It never runs.",
    );
  },

  // Each panel is offered to Show on subgraph node (offerPanel builds it
  // and remembers how, for the copy on the subgraph node).
  getCustomWidgets() {
    return {
      WP_CONTEXT_MODULES: (node: ContextCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => ctxMod.create(node, inputName)),
      WP_DEBUG_VIEWER: (node: DebugCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => dbgMod.create(node, inputName)),
      WP_INJECTOR_ROWS: (node: InjectorCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => injMod.create(node, inputName)),
      WP_CLEANER: (node: CleanerCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => cleanerMod.create(node, inputName)),
      WP_VAR_PICKER: (node: VarPickerCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => varPickerMod.create(node, inputName)),
      // Loop's DOM widget uses `WP_CONTEXT_LOOP_WIDGET` — a widget-only
      // TYPE (see `wp_nodes/types.py::ContextLoopWidgetInput`) distinct
      // from the wire-payload TYPE `WP_CONTEXT_LOOP_CONFIG` carried on
      // the loop's output + WP_SeedList's `loop_config` socket. NO
      // factory is registered for `WP_CONTEXT_LOOP_CONFIG` here — that's
      // deliberate, so consumers of that type render as plain sockets
      // (gated factories returning `{widget: undefined}` ended up
      // hiding the socket entirely, see the type's docstring).
      WP_CONTEXT_LOOP_WIDGET: (node: CtxLoopCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => ctxLoopMod.create(node, inputName)),
      WP_SEED_LIST_CONFIG: (node: SeedListCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => seedListMod.create(node, inputName)),
      WP_MODEL_INFO: (node: ModelInfoCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => modelInfoMod.create(node, inputName)),
      WP_TOGGLES: (node: TogglesCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => togglesMod.create(node, inputName)),
      WP_IMAGE_FILTER: (node: ImageFilterCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => imageFilterWidgetMod.create(node, inputName)),
      WP_LABEL_GRID: (node: LabelGridCreateNode, inputName: string) =>
        showMod.offerPanel(node, inputName, () => labelGridMod.create(node, inputName)),
      // The assembler's `template`. Unlike every other entry here, this key
      // is NOT the input's socket type — the socket stays STRING so links
      // still work, and the node ships `widgetType` in the input spec's
      // extra dict purely to route the lookup here. See
      // `widgets/templateEditor.ts`.
      WP_TEMPLATE_EDITOR: (node: TemplateEditorNode, inputName: string) =>
        tmplMod.create(node, inputName),
    };
  },

  beforeRegisterNodeDef(nodeType: unknown, nodeData: NodeData) {
    if (nodeData.name === "WP_PromptCleaner") {
      const ct = nodeType as { prototype: { onConfigure?: (this: unknown, info: unknown) => void } };
      const origConfigure = ct.prototype.onConfigure;
      ct.prototype.onConfigure = function (this: unknown, info: unknown) {
        origConfigure?.call(this, info);
        cleanerMod.upgradeLegacyValues(this as Parameters<typeof cleanerMod.upgradeLegacyValues>[0], info);
      };
      // The prompt + negative boxes are ComfyUI's own textareas, which stay
      // bright on a bypassed node while the rules widget below them dims.
      const cn = nodeType as { prototype: { onNodeCreated?: (this: CleanerCreateNode, ...args: unknown[]) => void } };
      const origCreated = cn.prototype.onNodeCreated;
      cn.prototype.onNodeCreated = function (this: CleanerCreateNode, ...args: unknown[]) {
        origCreated?.apply(this, args);
        dimWidgetsWhileSkipped(this, ["prompt", "negative"]);
      };
      return;
    }
    if (nodeData.name !== "WP_PromptAssembler") return;
    const nt = nodeType as NodeType;
    const orig = nt.prototype.onNodeCreated;
    nt.prototype.onNodeCreated = function (this: AssemblerHelperNode, ...args: unknown[]) {
      orig?.apply(this, args);
      asmMod.prefillNegativeSlot(this);
      asmMod.markNegativeOptIn(this);
      asmMod.mountHelper(this);
      dimWidgetsWhileSkipped(this, ["template", "negative_template"]);
    };
    // Negatives became opt-in: a node saved before that gets `$negatives`
    // added once, so the workflow prints the same negative as before.
    const origConfigure = nt.prototype.onConfigure;
    nt.prototype.onConfigure = function (this: AssemblerHelperNode, info: unknown) {
      origConfigure?.apply(this, [info]);
      asmMod.migrateNegativeOptIn(this, info);
    };
  },

  // Fires after ComfyUI restores all widget values from the loaded workflow.
  // Without this, assembler's snapshot is computed BEFORE upstream Context
  // values land — preview briefly shows missing-var warnings then settles
  // ~400ms later when the polling fallback catches up. Notify all reactive
  // widgets to recompute immediately.
  afterConfigureGraph() {
    graphEventsMod.notifyGraphLoaded();
    maybeShowBookmarkDock();
    // Re-attach badges in case the loaded workflow contained SubgraphNodes
    // that bypassed nodeCreated (loaded path uses different hooks).
    // Nested subgraph nodes always sit inside a top-level one, so the top
    // level alone says whether there is anything to badge.
    const root = (app as unknown as { graph?: LiteGraphLike }).graph;
    if (root?._nodes?.some(isSubgraphNode)) {
      withBadges((badgeMod) => badgeMod.attachAllSubgraphBadges(root));
    }
    // Our widgets wired out to a subgraph's inputs show on its node.
    promoteMod.refreshAllPromotedHosts(root);
    // Panels a subgraph node was set to show (Show on subgraph node).
    showMod.restoreAllShown(root ? (graphMod.findRootGraph(root) as Parameters<typeof showMod.restoreAllShown>[0]) : null);
  },

  // Fires for every node when it's instantiated — including SubgraphNodes,
  // which beforeRegisterNodeDef does NOT see (litegraph registers them at
  // runtime, not via ComfyUI's node-def pipeline). We attach a corner
  // conflict badge so users can spot WP issues nested inside a subgraph
  // without opening it.
  nodeCreated(node: unknown) {
    if (!isSubgraphNode(node)) return;
    promoteMod.installPromotedHosts(node);
    showMod.restoreShownSoon(node);
    prepareBadge(node);
    const root = (app as unknown as { graph?: LiteGraphLike }).graph;
    if (root) withBadges((badgeMod) => badgeMod.attachSubgraphBadge(node as Parameters<BadgeModule["attachSubgraphBadge"]>[0], root));
  },

  // Same intent as nodeCreated but fires for nodes restored from a saved
  // workflow. ComfyUI splits the lifecycle so we cover both paths.
  loadedGraphNode(node: unknown) {
    if (!isSubgraphNode(node)) return;
    promoteMod.installPromotedHosts(node);
    showMod.restoreShownSoon(node);
    prepareBadge(node);
    const root = (app as unknown as { graph?: LiteGraphLike }).graph;
    if (root) withBadges((badgeMod) => badgeMod.attachSubgraphBadge(node as Parameters<BadgeModule["attachSubgraphBadge"]>[0], root));
  },
});

// Pre-run validation — when the user queues a prompt, scan every
// WP_PromptAssembler in the graph for $vars in its template (or its
// negative template) that no upstream Context provides. One toast per offending assembler with a
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
  graph?: LiteGraphLike | null;
  setGraph?: (graph: LiteGraphLike) => void;
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
 *  headless tests). A node in another graph than the one on screen
 *  (inside a subgraph, or out at the root while the user is inside one)
 *  opens that graph first, the same way the breadcrumb does, so Focus
 *  reaches the node wherever it lives.
 *
 *  Flash strategy: a position:fixed DOM overlay anchored to the node's
 *  screen-space bounds via the canvas's drag-state transform. LiteGraph
 *  nodes are drawn on a `<canvas>`, so there's no per-node DOM to
 *  style — an overlay div is the cleanest way to add a CSS border
 *  without monkey-patching the canvas render loop. */
function focusNode(node: FocusableNode, graph: LiteGraphLike) {
  const canvas = appQ.canvas;
  if (!canvas) return;
  try {
    graphMod.showGraph(canvas, graph, () => showNode(node, canvas));
  } catch (err) {
    console.warn("[wildcard-pipeline] focusNode failed:", err);
  }
}

function showNode(node: FocusableNode, canvas: AppCanvas) {
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
  //
  // Under Nodes 2.0 the node is a real DOM element, laid out from its own
  // content rather than clamped to `node.size` — a node declaring 400 wide
  // measured 490 graph units, so the transform maths below draws a box 81px
  // too narrow at 0.9 zoom. Where that element exists its rect IS the node's
  // box, title bar included, so measure it rather than recomputing (which
  // also drops the TITLE_PAD estimate). The legacy renderer paints nodes on
  // the canvas and has no such element; there the maths is the only option,
  // and it is correct — the two agreed on position to the pixel.
  const nodeSelector = `[data-node-id="${node.id}"]`;
  let nodeEl = document.querySelector<HTMLElement>(nodeSelector);
  const start = performance.now();
  let raf = 0;
  function tick() {
    // The Vue renderer may recreate the element mid-flash, or (right after
    // Focus opened another graph) not have drawn it yet; re-resolve until
    // we hold one in the document.
    if (!nodeEl?.isConnected) {
      nodeEl = document.querySelector<HTMLElement>(nodeSelector);
    }
    const box = nodeEl?.getBoundingClientRect();
    if (box) {
      overlay.style.left = `${box.left}px`;
      overlay.style.top = `${box.top}px`;
      overlay.style.width = `${box.width}px`;
      overlay.style.height = `${box.height}px`;
    } else {
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
    }
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

// WP Toggles' mute / bypass dots are links on a server node: drop them from
// the prompt, or the server would run (or miss) the nodes wired into them.
const appG = app as unknown as { graphToPrompt?: (...args: unknown[]) => Promise<{ output?: unknown }> };
const origGraphToPrompt = appG.graphToPrompt;
if (typeof origGraphToPrompt === "function") {
  appG.graphToPrompt = async function (this: unknown, ...args: unknown[]) {
    const res = await origGraphToPrompt.apply(this, args);
    stripControlInputs(res?.output as Parameters<typeof stripControlInputs>[0]);
    return res;
  };
}

const origQueuePrompt = appQ.queuePrompt;
if (typeof origQueuePrompt === "function") {
  appQ.queuePrompt = function (...args: unknown[]) {
    try {
      // app.graph is the graph ON SCREEN, which is a subgraph while the user
      // is inside one; climb to the root so the scan sees every assembler.
      const graph = graphMod.findRootGraph(appQ.graph as unknown as LiteGraphLike);
      // Note: per-Context seed snapshot now happens via each
      // seed widget's `beforeQueued` hook (registered in
      // widgets/context.ts). That fires after queue submit but
      // BEFORE control_after_generate rotates the value, capturing
      // exactly the seed that's about to run.
      // walkAllNodes recurses into nested subgraphs so assemblers inside a
      // subgraph still get their templates scanned. collectUpstreamVariables
      // crosses boundaries the other direction.
      for (const { node, graph: home } of graphMod.walkAllNodes(graph)) {
        if (node.type !== "WP_PromptAssembler") continue;
        // Skip bypassed (mode=4) + muted (mode=2) nodes — LiteGraph
        // omits them from execution, so flagging unresolved vars on a
        // node that won't run is just noise. mode is a bare number on
        // LGraphNode; missing/0 = ALWAYS (normal execution).
        const mode = (node as { mode?: number }).mode;
        if (mode === 2 || mode === 4) continue;
        const textOf = (name: string): string => {
          const w = node.widgets?.find((x: { name: string; value: unknown }) => x.name === name);
          return typeof w?.value === "string" ? w.value : "";
        };
        const tmpl = textOf("template");
        // Send-to-negative: the negative template's `$vars` render too
        // (`$negatives` is its reserved slot, never missing).
        const negTmpl = textOf("negative_template");
        if (!tmpl && !negTmpl) continue;
        const missing = assemblerVarsMod.missingAssemblerVars(
          tmpl,
          negTmpl,
          // A name a Loop sets on some frames only is intended, not missing:
          // the Assembler shows it as "on some frames", so stay quiet here.
          graphMod.collectUpstreamVariablesAnyFrame(graph, node),
        );
        if (missing.length === 0) continue;
        const list = missing.map((v) => `$${v}`).join(", ");
        // Capture node by closure — the Focus action calls into
        // app.canvas at click time, not push time, so the reference
        // stays live even if the graph is re-rendered.
        const targetNode = node;
        toastStoreMod.pushToast(
          `Assembler #${node.id}: ${list} unresolved — will render empty.`,
          {
            severity: "warning",
            lifeMs: 8000,
            action: { label: "Focus", onSelect: () => focusNode(targetNode as unknown as FocusableNode, home) },
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
