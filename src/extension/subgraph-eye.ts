/**
 * The eye in ComfyUI's subgraph Parameters panel, for WP panels.
 *
 * ComfyUI lists every widget of the nodes inside a subgraph under "Hidden /
 * nested parameters", each with an eye that promotes it to the subgraph node.
 * Promotion needs an input socket (`promoteValueWidgetViaSubgraphInput` →
 * `missingSourceSlot`), and our panels have none, so the eye did nothing.
 *
 * This listens (capture phase) for a click on that eye. When the row is a WP
 * panel ("Show on subgraph node" can build it), the click shows or hides our
 * copy instead, and ComfyUI never sees it. Rows of panels that are shown get
 * the open eye. "Show all" in that list shows the WP panels too.
 *
 * It reads ComfyUI's own test ids (`subgraph-widget-item`, `data-nodeid`,
 * `subgraph-widget-toggle`, `subgraph-editor-hidden-section`), which its e2e
 * tests rely on. If they change, the eye goes back to doing nothing and the
 * right-click item still works.
 */
import { hidePanel, isShown, panelsOf, showPanel, type PanelNode, type SubgraphHost } from "./show-on-subgraph";

const ROW = '[data-testid="subgraph-widget-item"]';
const TOGGLE = '[data-testid="subgraph-widget-toggle"]';
const HIDDEN = '[data-testid="subgraph-editor-hidden-section"]';
const EYE_OFF = "icon-[lucide--eye-off]";
const EYE_ON = "icon-[lucide--eye]";

interface CanvasLike {
  selected_nodes?: Record<string, unknown> | null;
  graph?: unknown;
}

export interface EyeApp {
  canvas?: CanvasLike | null;
}

interface GraphWithNodes {
  getNodeById?: (id: number | string) => unknown;
}

/** The node a row names and which of its WP panels, if it is one. */
export interface EyeTarget {
  node: PanelNode;
  widget: string;
}

function innerById(host: SubgraphHost, id: string): PanelNode | null {
  const g = host.subgraph as GraphWithNodes | null | undefined;
  const n = g?.getNodeById?.(id) ?? g?.getNodeById?.(Number(id));
  return (n as PanelNode | undefined) ?? null;
}

/** The subgraph nodes the Parameters panel can be about: the selected ones. */
function selectedHosts(app: EyeApp): SubgraphHost[] {
  const sel = app.canvas?.selected_nodes;
  if (!sel) return [];
  return Object.values(sel).filter((n): n is SubgraphHost => !!(n as SubgraphHost | null)?.isSubgraphNode?.());
}

/** The texts in a row, in order (node title, widget name). */
function rowTexts(row: Element): string[] {
  const out: string[] = [];
  for (const el of row.querySelectorAll("div")) {
    if (el.children.length) continue;
    const t = el.textContent?.trim();
    if (t) out.push(t);
  }
  return out;
}

/** The WP panel a Parameters row stands for, or null. */
export function targetOf(row: Element, app: EyeApp): EyeTarget | null {
  const id = (row as HTMLElement).dataset?.nodeid;
  if (!id) return null;
  const texts = rowTexts(row);
  for (const host of selectedHosts(app)) {
    const node = innerById(host, id);
    if (!node) continue;
    const panels = panelsOf(node as object);
    const widget = texts.find((t) => panels.includes(t));
    if (widget) return { node, widget };
  }
  return null;
}

/** Give the rows of shown WP panels the open eye, and the others the closed one. */
export function markRows(root: ParentNode, app: EyeApp): void {
  for (const section of root.querySelectorAll(HIDDEN)) {
    for (const row of section.querySelectorAll(ROW)) {
      const t = targetOf(row, app);
      const icon = row.querySelector(`${TOGGLE} i`);
      if (!t || !icon) continue;
      const on = isShown(t.node, t.widget);
      icon.classList.toggle(EYE_ON, on);
      icon.classList.toggle(EYE_OFF, !on);
      (row as HTMLElement).dataset.wpShown = on ? "true" : "false";
    }
  }
}

/** Handle a click; true when it was a WP panel's eye (and ComfyUI must not see it). */
export function handleClick(target: Element | null, app: EyeApp, root: ParentNode): boolean {
  if (!target) return false;
  const section = target.closest(HIDDEN);
  if (!section) return false;
  const toggle = target.closest(TOGGLE);
  if (toggle) {
    const row = toggle.closest(ROW);
    const t = row ? targetOf(row, app) : null;
    if (!t) return false;
    if (isShown(t.node, t.widget)) hidePanel(t.node, t.widget);
    else showPanel(t.node, t.widget);
    markRows(root, app);
    return true;
  }
  // "Show all": the section's header link. ComfyUI promotes what it can;
  // the WP panels it can't are shown here.
  if (target.closest("a") && !target.closest(ROW)) {
    for (const row of section.querySelectorAll(ROW)) {
      const t = targetOf(row, app);
      if (t && !isShown(t.node, t.widget)) showPanel(t.node, t.widget);
    }
    setTimeout(() => markRows(root, app), 0);
  }
  return false;
}

let installed = false;

/** Listen for the eye once, and keep the rows marked while the panel is open. */
export function installSubgraphEye(app: EyeApp, doc: Document = document): void {
  if (installed) return;
  installed = true;
  doc.addEventListener(
    "click",
    (e) => {
      if (handleClick(e.target instanceof Element ? e.target : null, app, doc)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  let queued = false;
  const view = doc.defaultView;
  if (!view || typeof view.MutationObserver !== "function") return;
  new view.MutationObserver(() => {
    if (queued) return;
    queued = true;
    view.requestAnimationFrame(() => {
      queued = false;
      if (doc.querySelector(HIDDEN)) markRows(doc, app);
    });
  }).observe(doc.body, { childList: true, subtree: true });
}
