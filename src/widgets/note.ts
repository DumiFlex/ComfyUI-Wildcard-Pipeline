import { defineAsyncComponent, h, ref, type Component } from "vue";
import { createDomWidgetHost, serializeWidgetJson, type MountTargetNode } from "./_shared";
import { reactiveFromGraph } from "../extension/reactive";
import { defaultNoteConfig, docUrl, parseNoteConfig, type NoteConfig } from "../extension/note";

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
}

type NodeBase = new (title?: string) => NoteNode;

interface LiteGraphStatic {
  LGraphNode?: NodeBase;
  registerNodeType?: (type: string, ctor: unknown) => void;
  NO_TITLE?: number;
}

function setPinned(node: NoteNode, pinned: boolean): void {
  // ComfyUI's own pin (the right-click Pin), so its lock icon and menu agree.
  if (node.pin) node.pin(pinned);
  else node.flags = { ...(node.flags ?? {}), pinned };
  node.setDirtyCanvas?.(true, true);
}

/**
 * Lets clicks through the note to the canvas, so the note drags, selects and
 * zooms like a node while it looks like a panel. ComfyUI's wrapper around a
 * DOM widget takes pointer events and its style binding writes `auto` back
 * on every layout change, so keep it at `none` with an observer. The note's
 * buttons and its edit form take events again in their own CSS. Returns a
 * stop function, or null while the wrapper isn't there yet.
 */
function passPointerThrough(el: HTMLElement): (() => void) | null {
  const wrap = el.closest<HTMLElement>(".dom-widget");
  if (!wrap) return null;
  const apply = (): void => {
    if (wrap.style.getPropertyValue("pointer-events") !== "none") {
      wrap.style.setProperty("pointer-events", "none", "important");
    }
  };
  apply();
  const obs = new MutationObserver(apply);
  obs.observe(wrap, { attributes: true, attributeFilter: ["style"] });
  return () => obs.disconnect();
}

/** Mounts the note's one widget. Its value is the JSON NoteConfig. */
export function mountNote(node: NoteNode) {
  const config = ref<NoteConfig>(defaultNoteConfig());
  // A saved note reads; a brand-new one opens in the editor (below).
  const editing = ref(false);
  let restored = false;

  const wrapper: Component = {
    setup() {
      const graphNode = node as unknown as Parameters<typeof reactiveFromGraph>[0];
      const pinned = reactiveFromGraph(graphNode, () => node.flags?.pinned === true, Object.is);
      const title = reactiveFromGraph(graphNode, () => node.title, Object.is);
      function onConfig(next: NoteConfig): void {
        config.value = next;
        host.setValue(serializeWidgetJson(next));
        node.setDirtyCanvas?.(true, true);
      }
      function onTitle(next: string): void {
        node.title = next;
        title.value = next;
        node.setDirtyCanvas?.(true, true);
      }
      function onPinned(next: boolean): void {
        setPinned(node, next);
        pinned.value = next;
      }
      function onOpenDoc(id: string): void {
        window.open(docUrl(id, window.location.origin), "_blank", "noopener");
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
        onOpenDoc,
      });
    },
  };

  const host = createDomWidgetHost(node, "wp_note", wrapper, {
    initialValue: serializeWidgetJson(config.value),
    minHeight: 30,
    minWidth: 120,
    autoHeight: true,
    onValueRestored: (raw: string) => {
      restored = true;
      config.value = parseNoteConfig(raw);
      editing.value = false;
      fitHeight();
    },
  });

  // Shrink the node to the panel once its height settles (the widget only
  // ever grows it), so the selection outline hugs the note.
  function fitHeight(): void {
    let frames = 3;
    const step = (): void => {
      if (--frames > 0) { requestAnimationFrame(step); return; }
      const min = node.computeSize?.();
      if (min && node.setSize && Math.abs(min[1] - node.size[1]) > 1) node.setSize([node.size[0], min[1]]);
    };
    requestAnimationFrame(step);
  }
  function setEditing(v: boolean): void {
    editing.value = v;
    fitHeight();
  }
  // Nothing restored by the next tick: the user just added this note.
  setTimeout(() => { if (!restored) setEditing(true); }, 0);

  // Keep ComfyUI's wrapper letting clicks through. It is created after the
  // node, and again when the graph is re-shown, so check on each draw.
  let wrap: HTMLElement | null = null;
  let stopPass: (() => void) | null = null;
  host.onCleanup(() => stopPass?.());
  const prevDraw = node.onDrawForeground;
  node.onDrawForeground = function (this: NoteNode, ...args: unknown[]) {
    prevDraw?.apply(this, args);
    const parent = host.element.closest<HTMLElement>(".dom-widget");
    if (parent && parent !== wrap) {
      stopPass?.();
      stopPass = passPointerThrough(host.element);
      wrap = stopPass ? parent : null;
    }
  };
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
    "A note that explains a workflow: steps, tips and a link to the docs. It never runs.");
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
  const lg = (globalThis as { LiteGraph?: LiteGraphStatic }).LiteGraph;
  const Base = lg?.LGraphNode;
  if (!lg?.registerNodeType || !Base) return;

  class WPNoteNode extends Base {
    static title = "WP Note";
    static category = "wildcard-pipeline";
    // No title bar and no node box: the note draws its own panel.
    static title_mode = lg?.NO_TITLE ?? 1;
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
      // Pinned by default. A loaded note's saved flags replace this.
      this.flags = { ...(this.flags ?? {}), pinned: true };
    }
  }
  lg.registerNodeType(NOTE_NODE_TYPE, WPNoteNode);
}
