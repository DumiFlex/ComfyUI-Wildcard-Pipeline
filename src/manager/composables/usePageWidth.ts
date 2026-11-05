/**
 * usePageWidth — page-width breakpoints for the manager's page area.
 *
 * Pages used to lay out by the window width (`@media`), but the page area
 * is the window minus the sidebar and, on wide screens, the assistant chat
 * beside it: with a wide chat a page laid out for 1920px got 700px and
 * overflowed. This watches the page area and lists, in `data-lt` on it,
 * each breakpoint the area is narrower than, so a page's CSS can say
 * `.wp-content[data-lt~="800"] .wp-x { … }` (works in scoped styles too).
 *
 * Not a CSS container query: `container-type` contains layout, which would
 * turn the page into the containing block of every `position: fixed`
 * popover inside it.
 */
import { onBeforeUnmount, onMounted, type Ref } from "vue";

/** The page-area widths pages break at, in px. */
export const PAGE_BREAKS = [400, 520, 560, 660, 680, 700, 800, 860, 900] as const;

export function pageBreaks(width: number): string {
  return PAGE_BREAKS.filter((b) => width < b).join(" ");
}

export function usePageWidth(el: Ref<HTMLElement | null>): void {
  let ro: ResizeObserver | null = null;
  const apply = (w: number): void => {
    const node = el.value;
    if (!node) return;
    const lt = pageBreaks(w);
    if (lt) node.setAttribute("data-lt", lt);
    else node.removeAttribute("data-lt");
  };
  onMounted(() => {
    const node = el.value;
    if (!node) return;
    apply(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width);
    });
    ro.observe(node);
  });
  onBeforeUnmount(() => ro?.disconnect());
}
