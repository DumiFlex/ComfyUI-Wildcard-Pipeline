/**
 * One sizing policy for every WP node's DOM widget (`createDomWidgetHost`).
 *
 * A widget states only what differs from the default: its width floor (and
 * whether the content's own width raises it), how its height behaves, the
 * widths at which it calls itself narrow or wide, and whether the host is a
 * CSS container its content can query (`@container wp-node (…)`).
 *
 * The older one-job flags (`minWidth`, `autoHeight`, `fillHost`,
 * `fitContent`, `ownSize`) still work: `resolveSizing` folds them and
 * `sizing` into one shape, `sizing` winning where both speak.
 */

/** How the node's height behaves:
 *  - `content`: always the content's height; a drag taller is undone.
 *  - `grow`: grows with the content; a drag taller is kept (and kept on reload).
 *  - `fill`: the user owns it; the content fills it and scrolls.
 *  - `fit`: never taller than the content (a box sharing a node with a filler).
 *  - `own`: the node is exactly its content; the host never resizes it. */
export type HeightMode = "content" | "grow" | "fill" | "fit" | "own";

export interface SizingPolicy {
  width?: {
    /** The floor in node px; a getter is read on every layout pass. */
    min?: number | (() => number) | undefined;
    /** Raise the floor to the content's min-content width (its widest
     *  word, fixed box or control), so a drag never squeezes it below that. */
    content?: boolean | undefined;
  } | undefined;
  height?: HeightMode | undefined;
  /** Widths (node px) below / above which the host is `narrow` / `wide`
   *  (`data-wp-width` on the host). */
  breakpoints?: { narrow?: number | undefined; wide?: number | undefined } | undefined;
  /** Make the host a size container named `wp-node`, so the content can
   *  reflow with `@container wp-node (max-width: …)`. */
  container?: boolean | undefined;
}

/** The flags `createDomWidgetHost` took before `sizing`. */
export interface LegacySizingFlags {
  minWidth?: number | (() => number) | undefined;
  autoHeight?: boolean | undefined;
  fillHost?: boolean | undefined;
  fitContent?: boolean | undefined;
  ownSize?: boolean | undefined;
}

export interface ResolvedSizing {
  minWidth: (() => number) | null;
  contentWidth: boolean;
  height: HeightMode;
  narrow: number | null;
  wide: number | null;
  container: boolean;
}

export function resolveSizing(sizing: SizingPolicy | undefined, flags: LegacySizingFlags): ResolvedSizing {
  const min = sizing?.width?.min ?? flags.minWidth;
  const legacyHeight: HeightMode = flags.ownSize ? "own"
    : flags.fillHost ? "fill"
    : flags.fitContent ? "fit"
    : flags.autoHeight ? "content"
    : "grow";
  return {
    minWidth: typeof min === "function" ? min : typeof min === "number" ? () => min : null,
    contentWidth: !!sizing?.width?.content,
    height: sizing?.height ?? legacyHeight,
    narrow: sizing?.breakpoints?.narrow ?? null,
    wide: sizing?.breakpoints?.wide ?? null,
    container: !!sizing?.container,
  };
}

/** The legacy flags the host's internals still branch on, from a policy. */
export function flagsOf(r: ResolvedSizing): Required<Omit<LegacySizingFlags, "minWidth">> {
  return {
    autoHeight: r.height === "content",
    fillHost: r.height === "fill",
    fitContent: r.height === "fit",
    ownSize: r.height === "own",
  };
}

export type WidthBand = "narrow" | "normal" | "wide";

export function widthBand(width: number, r: Pick<ResolvedSizing, "narrow" | "wide">): WidthBand {
  if (r.narrow !== null && width < r.narrow) return "narrow";
  if (r.wide !== null && width >= r.wide) return "wide";
  return "normal";
}

/** The width floor: the declared minimum, raised to what the content needs
 *  (its min-content width plus the widget's side insets) when asked. */
export function widthFloor(declared: number, contentMin: number | null, inset: number): number {
  if (contentMin === null || !(contentMin > 0)) return declared;
  return Math.max(declared, Math.ceil(contentMin + inset * 2));
}

/**
 * Whether the height a node had when its widget first measured belongs to
 * the user. A saved workflow restores its node sizes before the content is
 * measured; under `grow` a node taller than its content was made taller by
 * hand and keeps that height. Under `content` the content always decides.
 */
export function heightOwnedAtLoad(mode: HeightMode, current: number, contentMin: number): boolean {
  if (mode === "content" || mode === "own") return false;
  if (mode === "fill") return true;
  return current > contentMin + 1;
}
