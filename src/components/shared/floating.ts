/**
 * Where a floating panel (popover, menu, tooltip) goes next to its anchor:
 * on the preferred side when it fits, on the other side when it doesn't,
 * and always kept inside the viewport. Pure maths, no DOM, so it is the
 * same on the canvas and in the manager. `Popover`, `ContextMenu` and the
 * tooltip directive all place themselves through it.
 */

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Placement = Side | `${Side}-${Exclude<Align, "center">}`;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlaceOptions {
  placement?: Placement;
  /** Space between the anchor and the panel. */
  gap?: number;
  /** Space the panel keeps from the viewport edge. */
  margin?: number;
}

export interface Placed {
  x: number;
  y: number;
  /** The side it ended up on, after any flip. */
  side: Side;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

export function splitPlacement(p: Placement): { side: Side; align: Align } {
  const [side, align] = p.split("-") as [Side, Exclude<Align, "center"> | undefined];
  return { side, align: align ?? "center" };
}

function room(side: Side, a: Rect, view: Size, gap: number, margin: number): number {
  switch (side) {
    case "top": return a.top - gap - margin;
    case "bottom": return view.height - (a.top + a.height) - gap - margin;
    case "left": return a.left - gap - margin;
    case "right": return view.width - (a.left + a.width) - gap - margin;
  }
}

function clamp(v: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(v, min), max);
}

export function placeFloating(anchor: Rect, panel: Size, view: Size, opts: PlaceOptions = {}): Placed {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const { side: want, align } = splitPlacement(opts.placement ?? "bottom-start");
  const vertical = want === "top" || want === "bottom";
  const need = vertical ? panel.height : panel.width;

  // Flip only when the other side has more room; a panel too big for both
  // stays on the side with more space and gets clamped.
  let side = want;
  if (room(want, anchor, view, gap, margin) < need) {
    const other = OPPOSITE[want];
    if (room(other, anchor, view, gap, margin) > room(want, anchor, view, gap, margin)) side = other;
  }

  let x: number;
  let y: number;
  if (vertical) {
    y = side === "bottom" ? anchor.top + anchor.height + gap : anchor.top - gap - panel.height;
    x = align === "start" ? anchor.left
      : align === "end" ? anchor.left + anchor.width - panel.width
      : anchor.left + (anchor.width - panel.width) / 2;
  } else {
    x = side === "right" ? anchor.left + anchor.width + gap : anchor.left - gap - panel.width;
    y = align === "start" ? anchor.top
      : align === "end" ? anchor.top + anchor.height - panel.height
      : anchor.top + (anchor.height - panel.height) / 2;
  }

  return {
    x: Math.round(clamp(x, margin, view.width - margin - panel.width)),
    y: Math.round(clamp(y, margin, view.height - margin - panel.height)),
    side,
  };
}

/** The viewport, for callers that have a window. */
export function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}
