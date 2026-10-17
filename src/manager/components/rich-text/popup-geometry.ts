/**
 * Viewport placement math for `RichTextInput`'s body-teleported overlays (the
 * autocomplete popover, the sub-category picker and the remap popup). Pure:
 * callers pass in the measured rects and the viewport size.
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  width?: number;
  height?: number;
}

/** Max-height of the suggestion popover in CSS (keep in sync). */
export const POPUP_H = 240;

/** Autocomplete popover anchored to the wrapper's box: below it, or above
 *  when there is no room below and room above. */
export function popupPlacement(
  rect: RectLike & { width: number },
  viewport: Pick<Viewport, "height">,
): { top: number; left: number; width: number; flipped: boolean } {
  const spaceBelow = viewport.height - rect.bottom;
  const flipped = spaceBelow < POPUP_H && rect.top > POPUP_H;
  return {
    top: flipped ? rect.top - 4 : rect.bottom + 4,
    left: rect.left,
    width: Math.max(200, rect.width),
    flipped,
  };
}

// Rough first-paint bounds for the flip decision; the precise size (which
// grows with the target's palette) is measured after paint by
// `hugTrigger`, which then re-anchors the popover snug against the trigger.
export const PICKER_APPROX_H = 380;
export const PICKER_W = 440;

/** First-paint anchor for the picker under (or above) its trigger, clamped
 *  so it stays on-screen before its exact size is known. */
export function pickerAnchorFor(
  rect: RectLike,
  viewport: Viewport,
): { top: number; left: number; flipped: boolean } {
  const spaceBelow = viewport.height - rect.bottom;
  const flipped = spaceBelow < PICKER_APPROX_H && rect.top > spaceBelow;
  // Clamp horizontally so the picker doesn't run off the right edge.
  const maxLeft = viewport.width - PICKER_W - 8;
  const left = Math.max(8, Math.min(rect.left, maxLeft));
  let top = flipped ? rect.top - PICKER_APPROX_H - 6 : rect.bottom + 6;
  // Keep both ends on-screen even before the exact measure lands.
  top = Math.max(8, Math.min(top, viewport.height - PICKER_APPROX_H - 8));
  return { top, left, flipped };
}

/** Re-anchor a painted overlay of real size `box` tight against `trigger`
 *  (6px gap) — above it when `flipped`, else below — then clamp into the
 *  viewport. A zero dimension (not measured yet) skips that axis's clamp. */
export function hugTrigger(
  trigger: Pick<RectLike, "top" | "bottom">,
  box: { width: number; height: number },
  flipped: boolean,
  left: number,
  viewport: Viewport,
): { top: number; left: number } {
  const gap = 6;
  let top = flipped ? trigger.top - box.height - gap : trigger.bottom + gap;
  let outLeft = left;
  if (box.height > 0) top = Math.max(8, Math.min(top, viewport.height - box.height - 8));
  if (box.width > 0) outLeft = Math.max(8, Math.min(outLeft, viewport.width - box.width - 8));
  return { top, left: outLeft };
}

/** Whether a popup of real height `boxHeight` must flip above `trigger`:
 *  only when it does not fit below and there is more room above. */
export function shouldFlipAbove(
  trigger: Pick<RectLike, "top" | "bottom">,
  boxHeight: number,
  viewportHeight: number,
): boolean {
  const spaceBelow = viewportHeight - trigger.bottom;
  return boxHeight > 0 && spaceBelow < boxHeight && trigger.top > spaceBelow;
}
