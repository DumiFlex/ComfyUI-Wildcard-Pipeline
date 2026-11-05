/**
 * Host-independent caret placement helpers for `RichTextInput`'s
 * contenteditable. They only touch the nodes and `Range` they are handed, so
 * they are testable in jsdom without mounting the editor.
 */
import { rawIndexForVisible, visibleLength } from "./atom-edit";

/** Every text-node descendant of `root`, in document order. Used to land the
 *  caret inside coloured sub-spans (e.g. `<span class="wp-rt-dp-brace">
 *  {a|b|c}</span>`) rather than on the span element. */
export function textDescendants(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    out.push(node as Text);
    node = walker.nextNode();
  }
  return out;
}

/**
 * Put `range` at one edge of `span`, walking to a real text node.
 *
 * With coloured sub-spans inside `wp-rt__text` (`<span class="wp-rt-dp-brace">`
 * and friends), `firstChild` / `lastChild` are not guaranteed to be text
 * nodes, and placing the caret on the span ELEMENT at offset 0 drops typing in
 * front of the whole brace block instead of inside it. A span with no text at
 * all gets the caret on the span itself, at offset 0.
 */
export function setCaretAtSpanEdge(span: HTMLElement, edge: "start" | "end", range: Range): void {
  const nodes = textDescendants(span);
  if (nodes.length === 0) {
    range.setStart(span, 0);
    return;
  }
  if (edge === "start") {
    range.setStart(nodes[0], 0);
    return;
  }
  const last = nodes[nodes.length - 1];
  range.setStart(last, (last.textContent ?? "").length);
}

/**
 * Put `range` `visibleOffset` visible characters into `el` — ZWSP caret pads
 * do not count. `el` is either a bare text node (orphan typed text under the
 * host) or a `wp-rt__text` span, whose text-node descendants are walked so the
 * caret lands inside whichever coloured sub-span owns the offset. An offset
 * past the end lands at the end of the last text node.
 */
export function placeCaretInText(range: Range, el: HTMLElement | Text, visibleOffset: number): void {
  // Plain text-node child of host (orphan typed text) — single node.
  if (el.nodeType === Node.TEXT_NODE) {
    range.setStart(el, rawIndexForVisible(el.textContent ?? "", visibleOffset));
    return;
  }
  const nodes = textDescendants(el);
  if (nodes.length === 0) {
    range.setStart(el, 0);
    return;
  }
  let want = visibleOffset;
  for (const tn of nodes) {
    const raw = tn.textContent ?? "";
    const nodeVisible = visibleLength(raw);
    if (want <= nodeVisible) {
      range.setStart(tn, rawIndexForVisible(raw, want));
      return;
    }
    want -= nodeVisible;
  }
  // Past the last text node — land at end of last node.
  const last = nodes[nodes.length - 1];
  range.setStart(last, (last.textContent ?? "").length);
}

/** Visible characters inside `root` before (`node`, `offset`), where `node`
 *  is one of its text descendants. Null when `node` is not one of them. */
export function visibleOffsetWithin(root: Node, node: Node, offset: number): number | null {
  let acc = 0;
  for (const tn of textDescendants(root)) {
    const text = tn.textContent ?? "";
    if (tn === node) return acc + visibleLength(text.slice(0, offset));
    acc += visibleLength(text);
  }
  return null;
}

/** Collapse `range` to its start and make it the document selection. */
export function selectCollapsed(range: Range, sel: Selection | null = window.getSelection()): void {
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** True for an element carrying class `cls` (text nodes and nulls are not). */
function isElementWith(n: Node | null | undefined, cls: string): boolean {
  return !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains(cls);
}

/** A `wp-rt__text` span — an editable text run of the host. */
export function isTextSpan(n: Node | null | undefined): boolean {
  return isElementWith(n, "wp-rt__text");
}

/** A rendered chip element (`RefChip`'s root). */
export function isChipEl(n: Node | null | undefined): boolean {
  return isElementWith(n, "wp-refchip");
}

/** True when `node` is, or sits inside, a `wp-rt__text` span (directly or via
 *  a coloured sub-span like `wp-rt-dp-brace`). */
export function inTextSpan(node: Node): boolean {
  const el: HTMLElement | null =
    node.nodeType === Node.TEXT_NODE
      ? (node as Text).parentElement
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : null;
  return !!el && !!el.closest(".wp-rt__text");
}
