import { defineAsyncComponent, h, ref, type Component } from "vue";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import { defaultNoteConfig, noteColorCss, parseNoteConfig, type NoteConfig } from "../extension/note";
import { defaultBookmarkConfig, jumpFields, type BookmarkConfig } from "../extension/bookmarks";
import { bookmarkCells } from "../extension/_stashes";
import { bookmarksChanged, currentViewPoint, currentZoom, freshJump, keymapFor, noteBookmarkAdded, setRecording, type BookmarkNode } from "./bookmark";
import { isVueNodes } from "../extension/renderer";
import { panelAt, trackPeek } from "./note-peek";
import { keepPassThrough, publishTitleHeight, setPinned } from "./_frameless";

const NoteWidget = defineAsyncComponent(() => import("../components/note/NoteWidget.vue"));

/** The node type name. Frontend-only: nothing on the Python side. */
export const NOTE_NODE_TYPE = "WP_Note";

interface NoteNode extends MountTargetNode {
  title: string;
  size: [number, number] | number[];
  flags?: { pinned?: boolean; collapsed?: boolean };
  pin?: (v?: boolean) => void;
  onDblClick?: (...args: unknown[]) => void;
  onDrawForeground?: (...args: unknown[]) => void;
  computeSize?: () => [number, number];
  setSize?: (size: [number, number]) => void;
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
  resizable?: boolean;
  graph?: unknown;
}

type NodeBase = new (title?: string) => NoteNode;

interface LiteGraphStatic {
  LGraphNode?: NodeBase;
  registerNodeType?: (type: string, ctor: unknown) => void;
  NO_TITLE?: number;
}



/**
 * Double-click to edit in Nodes 2.0. There the note's node never gets
 * LiteGraph's onDblClick (its body lets the pointer through to the canvas),
 * so one document listener hit-tests the notes' panels instead. Classic
 * keeps onDblClick.
 */
interface EditTarget { panel(): HTMLElement | null; edit(): void }
const editTargets = new Set<EditTarget>();
let dblWired = false;
function wireDblClick(): void {
  if (dblWired || typeof document === "undefined") return;
  dblWired = true;
  document.addEventListener("dblclick", (e) => {
    if (!isVueNodes()) return;
    const hit = panelAt(editTargets, e.clientX, e.clientY);
    if (!hit) return;
    e.stopPropagation();
    hit.edit();
  }, true);
}

/** The narrowest a card note gets, and the width a label opens its editor at. */
const CARD_MIN_WIDTH = 160;
const FORM_WIDTH = 340;

/** Mounts the note's one widget. Its value is the JSON NoteConfig. */
export function mountNote(node: NoteNode) {
  const config = ref<NoteConfig>(defaultNoteConfig());
  // A saved note reads; a brand-new one opens in the editor (below).
  const editing = ref(false);
  let restored = false;

  // With its Bookmark switch on the note is also a bookmark: the dock, the
  // shortcuts and Next / Previous read it through this cell. It never hides
  // and takes its icon and colour from the note.
  bookmarkCells.set(node, {
    kind: "note",
    get: (): BookmarkConfig | null => {
      const c = config.value;
      if (!c.bookmark) return null;
      return {
        ...defaultBookmarkConfig(),
        ...c.bookmark,
        icon: c.tone === "icon" ? c.icon : "bookmark",
        ...(c.tone === "step" ? { step: c.step } : {}),
        color: c.color ? noteColorCss(c.color) : "",
        hidden: false,
      };
    },
    set: (next) => {
      if (config.value.bookmark) writeNote({ ...config.value, bookmark: jumpFields(next as BookmarkConfig) });
    },
  });
  const isLabel = (): boolean => config.value.look === "label" && !editing.value;
  // A label sizes itself to its text; a card's width is the user's. Pinned
  // never resizes (ComfyUI's pin() and configure() write this too).
  const syncResizable = (): void => { node.resizable = node.flags?.pinned !== true && !isLabel(); };

  const wrapper: Component = {
    setup() {
      const graphNode = node as unknown as Parameters<typeof reactiveFromGraph>[0];
      const pinned = reactiveFromGraph(graphNode, () => node.flags?.pinned === true, Object.is);
      const title = reactiveFromGraph(graphNode, () => node.title, Object.is);
      function onConfig(next: NoteConfig): void {
        writeNote(next);
      }
      function onTitle(next: string): void {
        node.title = next;
        title.value = next;
        fitSize();
      }
      function onPinned(next: boolean): void {
        setPinned(node, next);
        pinned.value = next;
        syncResizable();
      }
      return () => h(NoteWidget, {
        config: config.value,
        title: title.value,
        pinned: pinned.value,
        editing: editing.value,
        "onUpdate:editing": setEditing,
        "onUpdate:config": onConfig,
        "onUpdate:title": onTitle,
        "onUpdate:pinned": onPinned,
        getKeymap: () => keymapFor(node as unknown as BookmarkNode),
        getZoom: currentZoom,
        getView: currentViewPoint,
        freshJump: () => freshJump(node),
        onRecording: setRecording,
      });
    },
  };

  // The panel's own width, which is the label's width.
  const panel = (): HTMLElement | null =>
    host.element.querySelector<HTMLElement>(".wp-note__panel");
  const labelWidth = (): number => Math.ceil(panel()?.scrollWidth ?? 0);

  function writeNote(next: NoteConfig): void {
    const was = config.value.bookmark;
    config.value = next;
    host.setValue(serializeWidgetJson(next));
    syncResizable();
    fitSize();
    if (!was && next.bookmark) noteBookmarkAdded();
    else if (was || next.bookmark) bookmarksChanged();
  }

  const host = createDomWidgetHost(node, "wp_note", wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 30,
    minWidth: () => minWidth(),
    ownSize: true,
    margin: 0,
    onValueRestored: (raw: string) => {
      restored = true;
      config.value = parseNoteConfig(raw);
      if (config.value.bookmark) noteBookmarkAdded();
      editing.value = false;
      syncResizable();
      fitSize();
    },
  });

  function minWidth(): number {
    if (isLabel()) return Math.max(labelWidth(), 40);
    return editing.value ? FORM_WIDTH : CARD_MIN_WIDTH;
  }
  /** The size the panel needs: its own height, and a label's own width. */
  function contentSize(): [number, number] | null {
    const el = host.element.querySelector<HTMLElement>(".wp-note");
    if (!el?.isConnected || el.offsetHeight <= 0) return null;
    return [minWidth(), Math.ceil(el.offsetHeight)];
  }
  // The node is exactly the panel, so the selection outline hugs the note:
  // LiteGraph's resize floor and every layout pass ask this.
  node.computeSize = () => contentSize() ?? [minWidth(), 30];

  // Make the node exactly the panel once the layout settles: a label's
  // width is its text, a card's width is the user's, and the height is the
  // text. Checked again whenever the panel's height changes.
  function fitSize(): void {
    node.setDirtyCanvas?.(true, true);
    let frames = 2;
    const step = (): void => {
      if (--frames > 0) { requestAnimationFrame(step); return; }
      applySize();
    };
    requestAnimationFrame(step);
  }
  function applySize(): void {
    const want = contentSize();
    if (!want) return;
    const size = node.size;
    const w = isLabel() ? want[0] : Math.max(size[0], want[0]);
    const h = want[1];
    if (Math.abs(w - size[0]) <= 1 && Math.abs(h - size[1]) <= 1) return;
    size[0] = w;
    size[1] = h;
    node.setDirtyCanvas?.(true, true);
  }
  const sizeObserver = new ResizeObserver(() => applySize());
  sizeObserver.observe(host.element);
  host.onCleanup(() => sizeObserver.disconnect());
  function setEditing(v: boolean): void {
    editing.value = v;
    syncResizable();
    fitSize();
  }
  // Nothing restored by the next tick: the user just added this note. It
  // starts pinned. (Pinning in the constructor would also pin every loaded
  // note: an unpinned one saves no flag, so the default would win.)
  setTimeout(() => {
    if (restored) return;
    setPinned(node, true);
    setEditing(true);
  }, 0);

  // A label keeps its text for a hover card (see note-peek.ts).
  const stopPeek = trackPeek({
    panel: () => (config.value.look === "label" && !editing.value ? panel() : null),
    config: () => config.value,
    title: () => node.title,
    active: () => config.value.look === "label" && !editing.value && !!node.graph,
    edit: () => setEditing(true),
  });
  host.onCleanup(stopPeek);
  wireDblClick();
  const editTarget: EditTarget = { panel: () => (editing.value ? null : panel()), edit: () => setEditing(true) };
  editTargets.add(editTarget);
  host.onCleanup(() => editTargets.delete(editTarget));

  // Keep ComfyUI's wrapper letting clicks through (see _frameless.ts).
  keepPassThrough(node, host);
  // Double-click anywhere on the note (it reaches the canvas) edits it.
  const prevDbl = node.onDblClick;
  node.onDblClick = function (this: NoteNode, ...args: unknown[]) {
    prevDbl?.apply(this, args);
    setEditing(true);
  };
  return host;
}

interface NodeDefLike {
  name: string;
  display_name?: string;
  category?: string;
  python_module?: string;
  description?: string;
}

/**
 * ComfyUI makes a stand-in definition for a frontend-only node, filed under
 * `custom_nodes.frontend_only`, which shows as a "frontend_only" badge on
 * the node and in search. Point WP Note's at our own package instead, read
 * off another WP node, so it badges and searches like the rest of ours.
 */
export function fixNoteDef(defs: NodeDefLike[]): void {
  fixFrontendDef(defs, NOTE_NODE_TYPE, "WP Note",
    "A note that explains a workflow: steps, warnings and labels, with links to the docs. It never runs.");
}

/** The same fix for any of our frontend-only nodes. */
export function fixFrontendDef(defs: NodeDefLike[], type: string, displayName: string, description: string): void {
  const def = defs.find((d) => d.name === type);
  if (!def) return;
  const ours = defs.find((d) => d.name !== type && d.name.startsWith("WP_") && d.python_module && !d.python_module.includes("frontend_only"));
  if (ours?.python_module) def.python_module = ours.python_module;
  def.display_name = displayName;
  def.category = "wildcard-pipeline";
  def.description = description;
}

/**
 * Registers WP Note: a frontend-only node like ComfyUI's own Note. It is
 * virtual, so it never runs and is left out of the prompt; its text is
 * saved with the workflow. A new note starts pinned.
 */
export function registerNoteNode(): void {
  publishTitleHeight();
  const lg = (globalThis as { LiteGraph?: LiteGraphStatic }).LiteGraph;
  const Base = lg?.LGraphNode;
  if (!lg?.registerNodeType || !Base) return;

  class WPNoteNode extends Base {
    static title = "WP Note";
    static category = "wildcard-pipeline";
    // No title bar and no node box: the note draws its own panel.
    static title_mode = lg?.NO_TITLE ?? 1;
    // The widget starts at the node's top edge, not 2 px under it.
    widgets_start_y = 0;
    isVirtualNode = true;
    serialize_widgets = true;
    collapsable = true;

    get renderingBgColor(): string {
      return "transparent";
    }

    // ComfyUI's source badge would float over the panel's top edge.
    drawBadges(): void {}

    // The panel is the whole node: a press on it drags, selects or
    // double-clicks the node rather than going to the widget.
    getWidgetOnPos(): undefined {
      return undefined;
    }

    constructor(title?: string) {
      super(title ?? "WP Note");
      mountNote(this);
      this.size = [360, 100];
    }
  }
  lg.registerNodeType(NOTE_NODE_TYPE, WPNoteNode);
}
