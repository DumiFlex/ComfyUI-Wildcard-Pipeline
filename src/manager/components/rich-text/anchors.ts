/**
 * Virtual anchors for `RichTextInput`'s floating panels (the suggestion list,
 * the filter picker and the remap popup). The kit's `Popover` places itself
 * against them; these only say WHERE the thing it belongs to is, read live so
 * the panel follows it on scroll.
 */
import type { Rect, VirtualAnchor } from "@/kit/floating";

function toRect(r: Rect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** An element as an anchor, with the box it had when handed in kept for when
 *  it has left the page (a chip re-rendered under the open panel). */
export function followAnchor(el: Element): VirtualAnchor {
  let last = toRect(el.getBoundingClientRect());
  return {
    getBoundingClientRect: () => {
      if (el.isConnected) last = toRect(el.getBoundingClientRect());
      return last;
    },
  };
}

/** True when a range has a box of its own: a collapsed range at the start of
 *  an empty line reports all zeros. */
function hasBox(r: Rect): boolean {
  return r.width > 0 || r.height > 0 || r.left !== 0 || r.top !== 0;
}

/**
 * The text being completed, as an anchor: the caret moved back `back`
 * characters (to the trigger), so the list starts under the `@` / `$` and
 * stays put while the word grows. Falls back to `fallback` (the field) when
 * the caret is not in `host` or has no box.
 */
export function caretAnchor(host: Element, fallback: Element, back = 0): VirtualAnchor {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  let range: Range | null = null;
  if (sel && sel.rangeCount > 0 && sel.anchorNode && host.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const node = range.startContainer;
    if (back > 0 && node.nodeType === Node.TEXT_NODE && range.startOffset >= back) {
      range.setStart(node, range.startOffset - back);
      range.collapse(true);
    }
  }
  const field = followAnchor(fallback);
  return {
    getBoundingClientRect: () => {
      // jsdom has no Range#getBoundingClientRect.
      const r = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      return r && hasBox(r) ? toRect(r) : field.getBoundingClientRect();
    },
  };
}
