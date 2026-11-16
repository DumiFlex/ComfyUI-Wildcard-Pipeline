/**
 * Placing a slot row level with its field (Nodes 2.0), shared by
 * `field-sockets.ts` (input dots) and `row-outputs.ts` (output dots).
 */

/** Under a pixel: what our own re-measure nudge (or a zoom's rounding)
 *  moves a row by. Following it re-measured, moved it back, and so on every
 *  frame: the page never went idle (184.7 px ↔ 185 px on the Assembler). */
export const PLACE_TOLERANCE = 1;

/** Put a row at `top` / `left` (px) unless it is already within
 *  PLACE_TOLERANCE of there. Returns whether it moved. */
export function place(row: HTMLElement, top: number, left: number): boolean {
  const near = (now: string, want: number): boolean =>
    now !== "" && Math.abs(Number.parseFloat(now) - want) < PLACE_TOLERANCE;
  if (near(row.style.top, top) && near(row.style.left, left)) return false;
  row.style.top = `${Math.round(top * 10) / 10}px`;
  row.style.left = `${Math.round(left * 10) / 10}px`;
  return true;
}
