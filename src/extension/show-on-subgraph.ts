/**
 * "Show on subgraph node": a panel of a node inside a subgraph, drawn on the
 * subgraph node outside too.
 *
 * Panels such as Toggles, Context or Label Grid have no input socket, so
 * ComfyUI cannot promote them to the subgraph node (`missingSourceSlot`).
 * Instead, a right-click item on the inner node builds a second copy of the
 * panel on every subgraph node made from that subgraph: the same glue
 * (`create(node, inputName)`) runs inside `buildMirror`, so the copy reads and
 * changes the inner node and shares its widget value with the node's own
 * panel (see `widgets/_shared.ts`, "Mirrors"). Only the inner widget is saved
 * and run; the subgraph node remembers which panels it shows in
 * `properties.wp_show_panels` and builds them again on load.
 */
import { buildMirror, primaryValue, type DomWidgetHost, type MountTargetNode } from "../widgets/_shared";

/** Saved on the subgraph node: the inner panels it shows. */
export const SHOW_KEY = "wp_show_panels";

export interface ShownPanel {
  node: string;
  widget: string;
  /** Parts the copy leaves out ("Choose what shows"); absent when none. */
  hide?: string[];
}

interface GraphLike {
  _nodes?: unknown[];
  rootGraph?: GraphLike;
  getNodeById?: (id: number | string) => unknown;
}

export interface PanelNode {
  id?: number | string;
  title?: string;
  graph?: GraphLike | null;
}

export interface SubgraphHost extends MountTargetNode {
  id?: number | string;
  graph?: GraphLike | null;
  subgraph?: GraphLike | null;
  properties?: Record<string, unknown>;
  isSubgraphNode?: () => boolean;
  removeWidget?: (widget: unknown) => void;
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void;
}

type Build = () => unknown;

/** How to build each panel of a node again: its glue's `create`, by widget. */
const offers = new WeakMap<object, Map<string, Build>>();
/** Copies on each subgraph node, by `innerId:widget`. */
const shown = new WeakMap<object, Map<string, DomWidgetHost>>();

/** Record how to build `node`'s panel `widget`, then build it. Every panel
 *  factory in `getCustomWidgets` goes through here. */
export function offerPanel<T>(node: object, widget: string, build: () => T): T {
  let byName = offers.get(node);
  if (!byName) offers.set(node, (byName = new Map()));
  byName.set(widget, build);
  return build();
}

function key(p: ShownPanel): string {
  return `${p.node}:${p.widget}`;
}

function readShown(host: SubgraphHost): ShownPanel[] {
  const raw = host.properties?.[SHOW_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is ShownPanel => !!p && typeof (p as ShownPanel).node === "string" && typeof (p as ShownPanel).widget === "string")
    .map((p) => {
      const hide = Array.isArray(p.hide) ? p.hide.filter((h): h is string => typeof h === "string") : [];
      return hide.length ? { node: p.node, widget: p.widget, hide } : { node: p.node, widget: p.widget };
    });
}

function writeShown(host: SubgraphHost, list: ShownPanel[]): void {
  host.properties = host.properties ?? {};
  if (list.length) host.properties[SHOW_KEY] = list;
  else delete host.properties[SHOW_KEY];
}

/** Panels of `node` that can be shown: offered, and built on the node. */
export function panelsOf(node: object): string[] {
  return [...(offers.get(node)?.keys() ?? [])].filter((w) => primaryValue(node, w) !== undefined);
}

function subgraphNodes(root: GraphLike | null | undefined, out: SubgraphHost[] = [], depth = 0): SubgraphHost[] {
  if (!root || depth > 16) return out;
  for (const n of root._nodes ?? []) {
    const s = n as SubgraphHost;
    if (!s.isSubgraphNode?.()) continue;
    out.push(s);
    subgraphNodes(s.subgraph, out, depth + 1);
  }
  return out;
}

/** The subgraph nodes made from the subgraph `node` sits in. */
export function hostsOf(node: PanelNode): SubgraphHost[] {
  const graph = node.graph;
  if (!graph) return [];
  const root = graph.rootGraph ?? null;
  if (!root || root === graph) return [];
  return subgraphNodes(root).filter((s) => s.subgraph === graph);
}

function mount(host: SubgraphHost, inner: PanelNode, widget: string): void {
  const id = String(inner.id);
  const k = key({ node: id, widget });
  let copies = shown.get(host);
  if (copies?.has(k)) return;
  const build = offers.get(inner as object)?.get(widget);
  if (!build || primaryValue(inner as object, widget) === undefined) return;
  let made: DomWidgetHost | null = null;
  const drop = (): void => {
    const copy = made;
    if (!copy) return;
    made = null;
    shown.get(host)?.delete(k);
    host.removeWidget?.(copy.widget);
    copy.unmount();
    host.setDirtyCanvas?.(true, true);
  };
  try {
    made = buildMirror(
      {
        dataNode: inner,
        hostNode: host,
        widgetName: `wp_show:${k}`,
        title: () => inner.title ?? "",
        // Every subgraph node made from this subgraph shows the same inner
        // node, so Hide takes it off all of them.
        onHide: () => hidePanel(inner, widget),
        onOrphan: drop,
        hidden: () => readShown(host).find((p) => key(p) === k)?.hide ?? [],
        onHiddenChange: (ids) => {
          writeShown(
            host,
            readShown(host).map((p) => {
              if (key(p) !== k) return p;
              return ids.length ? { node: p.node, widget: p.widget, hide: [...ids] } : { node: p.node, widget: p.widget };
            }),
          );
          host.setDirtyCanvas?.(true, true);
        },
        canMove: (dir) => {
          const list = readShown(host);
          const i = list.findIndex((p) => key(p) === k);
          return i >= 0 && i + dir >= 0 && i + dir < list.length;
        },
        onMove: (dir) => movePanel(host, k, dir),
      },
      build,
    ) as DomWidgetHost | null;
  } catch (err) {
    console.error("[wp] could not show the panel on the subgraph node", err);
    return;
  }
  if (!made?.widget) return;
  if (!copies) shown.set(host, (copies = new Map()));
  copies.set(k, made);
  host.setDirtyCanvas?.(true, true);
}

/** Whether `node`'s panel `widget` is shown on its subgraph node(s). */
export function isShown(node: PanelNode, widget: string): boolean {
  const k = key({ node: String(node.id), widget });
  return hostsOf(node).some((h) => readShown(h).some((p) => key(p) === k));
}

/** Show `node`'s panel on every subgraph node made from its subgraph. */
export function showPanel(node: PanelNode, widget: string): void {
  const entry = { node: String(node.id), widget };
  for (const host of hostsOf(node)) {
    const list = readShown(host);
    if (!list.some((p) => key(p) === key(entry))) writeShown(host, [...list, entry]);
    mount(host, node, widget);
  }
}

/** Take `node`'s panel off its subgraph node(s). */
export function hidePanel(node: PanelNode, widget: string): void {
  const k = key({ node: String(node.id), widget });
  for (const host of hostsOf(node)) {
    writeShown(host, readShown(host).filter((p) => key(p) !== k));
    const copy = shown.get(host)?.get(k);
    shown.get(host)?.delete(k);
    if (copy) {
      host.removeWidget?.(copy.widget);
      copy.unmount();
    }
    host.setDirtyCanvas?.(true, true);
  }
}

/** Move the copy `k` (`innerId:widget`) up (-1) or down (1) among the
 *  copies on `host`. The copies are built again in the new order, since the
 *  subgraph node draws its extra widgets in the order they were added. */
export function movePanel(host: SubgraphHost, k: string, dir: -1 | 1): void {
  const list = readShown(host);
  const i = list.findIndex((p) => key(p) === k);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const next = [...list];
  [next[i], next[j]] = [next[j] as ShownPanel, next[i] as ShownPanel];
  writeShown(host, next);
  const copies = shown.get(host);
  if (copies) {
    for (const copy of copies.values()) {
      host.removeWidget?.(copy.widget);
      copy.unmount();
    }
    copies.clear();
  }
  restoreShown(host);
  host.setDirtyCanvas?.(true, true);
}

/** Build the copies a subgraph node saved (on load, paste, or a graph change). */
export function restoreShown(host: SubgraphHost): void {
  if (!host.isSubgraphNode?.()) return;
  for (const p of readShown(host)) {
    const inner = host.subgraph?.getNodeById?.(p.node) ?? host.subgraph?.getNodeById?.(Number(p.node));
    if (inner) mount(host, inner as PanelNode, p.widget);
  }
}

/** Restore after the current task: the inner nodes' panels are built later
 *  in the same load than the subgraph node is created. */
export function restoreShownSoon(host: unknown): void {
  const h = host as SubgraphHost;
  if (!h.isSubgraphNode?.()) return;
  setTimeout(() => restoreShown(h), 0);
}

/** Every subgraph node in a graph and its subgraphs. */
export function restoreAllShown(root: GraphLike | null | undefined): void {
  for (const host of subgraphNodes(root)) restoreShown(host);
}

/** Right-click items for a node inside a subgraph: one Show / Hide per panel. */
export function menuItems(node: unknown): Array<{ content: string; callback: () => void } | null> {
  const n = node as PanelNode;
  const panels = panelsOf(n as object);
  if (!panels.length || !hostsOf(n).length) return [];
  const many = panels.length > 1;
  const items = panels.map((w) => {
    const on = isShown(n, w);
    const what = many ? ` (${w})` : "";
    return {
      content: on ? `Hide from subgraph node${what}` : `Show on subgraph node${what}`,
      callback: () => (on ? hidePanel(n, w) : showPanel(n, w)),
    };
  });
  return [null, ...items];
}
