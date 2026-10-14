/**
 * Grows a textarea to fit what is typed, up to `max` pixels, and never
 * shrinks it below a height the user dragged it to (it only grows while
 * typing), so the resize grip and the auto-size don't fight.
 */
export function autogrow(el: HTMLTextAreaElement, max = 200): void {
  const want = Math.min(max, el.scrollHeight + (el.offsetHeight - el.clientHeight));
  if (want > el.offsetHeight) el.style.height = `${want}px`;
}
