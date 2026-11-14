/**
 * Hide the name label on a WP node's multiline text box once it is scrolled.
 *
 * Under Nodes 2.0 ComfyUI's own `WidgetTextarea` draws the widget name
 * ("prompt", "negative", "template") as an absolutely placed label over the
 * box's top padding, with no background. At the top that padding keeps it
 * clear of the text, but as soon as the box scrolls (a long prompt, or typing
 * past its height) the lines slide up under the label and the two overlap.
 *
 * One capture-phase `scroll` listener for the whole document (scroll doesn't
 * bubble, capture still sees it): when a `<textarea>` inside a WP node scrolls
 * away from the top, its label (the `<label for>` that names it) fades out,
 * and it comes back at the top. Other nodes' boxes are left as ComfyUI draws
 * them. The legacy canvas has no such label, so nothing matches there.
 */

/** Opacity transition on the label, matching our skipped-node dim. */
const FADE = "opacity 120ms ease";

/** The `<label>` ComfyUI draws for `area`: the one whose `for` is its id. */
export function labelFor(area: HTMLTextAreaElement): HTMLLabelElement | null {
  if (!area.id) return null;
  // The label sits beside the textarea, or one level up if the textarea is
  // wrapped.
  for (const scope of [area.parentElement, area.parentElement?.parentElement]) {
    for (const el of scope?.querySelectorAll("label") ?? []) {
      if (el.htmlFor === area.id) return el;
    }
  }
  return null;
}

/** Fade `area`'s label out while it is scrolled, in at the top. */
export function syncLabel(area: HTMLTextAreaElement): void {
  const label = labelFor(area);
  if (!label) return;
  label.style.transition = FADE;
  label.style.opacity = area.scrollTop > 0 ? "0" : "";
}

/**
 * Install the listener once. `isWpNode(id)` says whether the node with that
 * `data-node-id` is one of ours. Returns the uninstall.
 */
export function installTextareaLabelFix(isWpNode: (nodeId: string) => boolean): () => void {
  if (typeof document === "undefined") return () => {};
  const onScroll = (e: Event): void => {
    const area = e.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    const id = area.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!id || !isWpNode(id)) return;
    syncLabel(area);
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => document.removeEventListener("scroll", onScroll, { capture: true });
}
