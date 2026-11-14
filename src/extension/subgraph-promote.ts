/**
 * Our widgets on a subgraph node.
 *
 * Wiring a widget's input to a subgraph's input "promotes" it: the subgraph
 * node on the outer graph shows a copy of the widget, and the value typed
 * there is what the inner node runs with. ComfyUI (frontend 1.57) keeps that
 * value in its widget value store and gives the outer node only a plain
 * stand-in object (type, value, options). It draws the stand-in by its type,
 * and for a DOM widget it looks for a real DOM widget of that name on the
 * outer node. It builds one for exactly one case, the stock multiline
 * `<textarea>` (`SubgraphNode.createPromotedHostWidget`, overridden in
 * `litegraphService.registerSubgraphNodeDef`). Every other DOM widget,
 * ours included, is promoted to an empty row: the Assembler's template box
 * vanished from the subgraph node the moment it was wired out.
 *
 * `createPromotedHostWidget` is the app-layer hook ComfyUI calls to build
 * that DOM widget ("the default falls back to the store-backed projection").
 * Each subgraph gets its own node class, so on every subgraph node we see
 * (`nodeCreated` / `loadedGraphNode`) we wrap the hook on its class once:
 * a source widget that registered a factory here gets OUR widget on the
 * outer node; anything else goes to ComfyUI's own hook unchanged. The value
 * still lives in ComfyUI's store: the factory reads and writes it through the
 * stand-in ComfyUI made for the input, so saving, running and undo keep
 * working the way they do for the stock textarea.
 *
 * Socketless panels (the Context's modules, Toggles, Label Grid, …) have no
 * input to wire to a subgraph input, so ComfyUI cannot promote them at all;
 * this module does not change that.
 */

/** The value of a promoted input, as ComfyUI stores it for the outer node. */
export interface PromotedValue {
  get(): string;
  set(v: string): void;
}

export interface PromotedHostContext {
  /** The subgraph node the widget is drawn on. */
  subgraphNode: SubgraphHostNode;
  /** The outer input's name (also the promoted widget's name). */
  inputName: string;
  value: PromotedValue;
}

/** What a factory hands back: the DOM widget `node.addDOMWidget` made. */
export interface PromotedHostWidget {
  element?: unknown;
  onRemove?: (...a: unknown[]) => unknown;
}

export type PromotedHostFactory = (ctx: PromotedHostContext) => PromotedHostWidget | null;

interface SourceWidget {
  element?: unknown;
  type?: string;
  name?: string;
}

interface StoreProjection {
  value?: unknown;
}

interface LinkLike {
  resolve?: (graph: unknown) => { inputNode?: SubgraphHostNode | null; input?: InputSlot | null };
}

interface InputSlot {
  name: string;
  link?: number | null;
  widgetId?: string;
  _widget?: unknown;
  _subgraphSlot?: { linkIds?: readonly (number | string)[] };
}

export interface SubgraphHostNode {
  id?: number | string;
  graph?: { getNodeById?: (id: number | string) => unknown } | null;
  inputs?: InputSlot[];
  widgets?: unknown[];
  properties?: Record<string, unknown>;
  subgraph?: { getLink?: (id: number | string) => LinkLike | null | undefined };
  isSubgraphNode?: () => boolean;
  getWidgetFromSlot?: (input: InputSlot) => SourceWidget | undefined;
  rebuildInputWidgetBindings?: () => void;
  /** Private in ComfyUI; the store-backed stand-in for a promoted input. */
  _projectPromotedWidget?: (input: InputSlot) => StoreProjection | undefined;
  /** Private in ComfyUI; widgets added with `addDOMWidget` outside promotion. */
  _extraWidgets?: unknown[];
}

type CreateHook = (this: SubgraphHostNode, input: InputSlot, id: string, source: SourceWidget) => unknown;

interface HookedProto {
  createPromotedHostWidget?: CreateHook;
}

/** Factories, keyed by the source widget's DOM element. The element is the
 *  one thing ComfyUI hands back unchanged: the widget object itself may be
 *  re-wrapped on its way into `node.widgets`. */
const factories = new WeakMap<object, PromotedHostFactory>();
/** Widgets built here, so a re-check can tell ours from ComfyUI's stand-in. */
const ourWidgets = new WeakSet<object>();
const hookedProtos = new WeakSet<object>();
/** Name of the placeholder an input holds while ours is built. */
const PENDING_NAME = "\u200bwp-pending";

/** Offer a widget for promotion: when its input is wired to a subgraph input,
 *  `factory` builds the copy shown on the subgraph node. */
export function registerPromotedHost(widget: { element?: unknown }, factory: PromotedHostFactory): void {
  if (widget.element && typeof widget.element === "object") factories.set(widget.element, factory);
}

function factoryFor(source: SourceWidget | undefined): PromotedHostFactory | undefined {
  const el = source?.element;
  return el && typeof el === "object" ? factories.get(el) : undefined;
}

/** True when ComfyUI has settled the node in its graph. Clones and nodes still
 *  being configured carry a passing id, and a DOM widget made for one would be
 *  left behind (ComfyUI's own textarea makes the same check). */
function settled(node: SubgraphHostNode): boolean {
  const id = node.id;
  return id != null && node.graph?.getNodeById?.(id) === node;
}

/** Take a widget `addDOMWidget` filed under the node's extra widgets back out:
 *  a promoted widget is listed through its input, and listing it twice would
 *  draw it twice. False when this ComfyUI keeps extra widgets elsewhere. */
function detachExtra(node: SubgraphHostNode, widget: object): boolean {
  const extras = node._extraWidgets;
  if (!Array.isArray(extras)) return false;
  const i = extras.indexOf(widget);
  if (i === -1) return !(node.widgets ?? []).includes(widget);
  extras.splice(i, 1);
  return true;
}

function stringValue(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Build our copy of a promoted widget, or null to leave it to ComfyUI. */
export function buildPromotedHost(
  node: SubgraphHostNode,
  input: InputSlot,
  source: SourceWidget,
): PromotedHostWidget | null {
  const factory = factoryFor(source);
  if (!factory || !settled(node)) return null;
  const projection = node._projectPromotedWidget?.(input);
  if (!projection) return null;
  const value: PromotedValue = {
    get: () => stringValue(projection.value),
    set: (v) => {
      projection.value = v;
    },
  };
  // While ours is made, the input holds a placeholder. Asking for the
  // stand-in filed it as the input's widget, and `node.widgets` would make a
  // new one on every read: either way `addDOMWidget` finds the name taken and
  // renames ours "template#1", which the Nodes 2.0 row (it looks the DOM
  // widget up by name) never finds. With the name free ours is filed under
  // the input's own store id, so it reads and writes the promoted value.
  const placeholder = { name: PENDING_NAME, type: "wp-pending" };
  input._widget = placeholder;
  let widget: PromotedHostWidget | null = null;
  try {
    widget = factory({ subgraphNode: node, inputName: input.name, value });
  } catch (err) {
    console.error("[wp] promoted widget failed", err);
    return null;
  } finally {
    if (input._widget === placeholder) input._widget = undefined;
  }
  if (!widget) return null;
  if (!detachExtra(node, widget)) {
    widget.onRemove?.();
    return null;
  }
  ourWidgets.add(widget);
  return widget;
}

/** The widget inside the subgraph that an outer input forwards to, following
 *  nested subgraph nodes down to the real one. */
export function promotedSource(node: SubgraphHostNode, input: InputSlot, depth = 0): SourceWidget | undefined {
  if (depth > 16) return undefined;
  for (const linkId of input._subgraphSlot?.linkIds ?? []) {
    const link = node.subgraph?.getLink?.(linkId);
    const resolved = link?.resolve?.(node.subgraph);
    const inner = resolved?.inputNode;
    const target = resolved?.input;
    if (!inner || !target) continue;
    const widget = inner.getWidgetFromSlot?.(target);
    if (widget && !inner.isSubgraphNode?.()) return widget;
    if (inner.isSubgraphNode?.()) {
      const innerInput = inner.inputs?.find((i) => i.name === target.name);
      const deep = innerInput ? promotedSource(inner, innerInput, depth + 1) : undefined;
      if (deep) return deep;
    }
    if (widget) return widget;
  }
  return undefined;
}

/** Whether an input of this node shows ComfyUI's empty stand-in where one of
 *  our widgets belongs. */
export function needsOurHost(node: SubgraphHostNode): boolean {
  return (node.inputs ?? []).some((input) => {
    if (!input.widgetId) return false;
    if (input._widget && ourWidgets.has(input._widget as object)) return false;
    return factoryFor(promotedSource(node, input)) !== undefined;
  });
}

/** Wrap the class's hook (once per subgraph class). */
function hook(node: SubgraphHostNode): boolean {
  const proto = Object.getPrototypeOf(node) as HookedProto | null;
  if (!proto || typeof proto.createPromotedHostWidget !== "function") return false;
  if (hookedProtos.has(proto)) return true;
  const original = proto.createPromotedHostWidget;
  proto.createPromotedHostWidget = function (this: SubgraphHostNode, input, id, source) {
    return buildPromotedHost(this, input, source) ?? original.call(this, input, id, source);
  };
  hookedProtos.add(proto);
  return true;
}

/** Re-bind the node's promoted inputs when one of ours is still showing the
 *  stand-in (the node resolved its inputs before the hook was on its class,
 *  or before the inner widget offered itself). ComfyUI keeps each value. */
export function refreshPromotedHosts(node: SubgraphHostNode): void {
  if (!node.isSubgraphNode?.() || !hook(node)) return;
  if (!settled(node) || !needsOurHost(node)) return;
  try {
    node.rebuildInputWidgetBindings?.();
  } catch (err) {
    console.error("[wp] could not re-bind promoted widgets", err);
  }
}

/** Hook a subgraph node and re-bind it once the current task (its configure,
 *  and the inner nodes' widget factories) has finished. */
export function installPromotedHosts(node: unknown): void {
  const n = node as SubgraphHostNode;
  if (!n.isSubgraphNode?.()) return;
  hook(n);
  setTimeout(() => refreshPromotedHosts(n), 0);
}

/** Every subgraph node in a graph and its subgraphs. */
export function refreshAllPromotedHosts(root: { _nodes?: unknown[] } | null | undefined, depth = 0): void {
  if (!root || depth > 16) return;
  for (const node of root._nodes ?? []) {
    const n = node as SubgraphHostNode & { subgraph?: { _nodes?: unknown[] } };
    if (!n.isSubgraphNode?.()) continue;
    refreshPromotedHosts(n);
    refreshAllPromotedHosts(n.subgraph as { _nodes?: unknown[] } | undefined, depth + 1);
  }
}
