/**
 * The manager tab asking an open canvas tab which variables the canvas
 * sets at run time (WP Context Injector rows, the Loop's iteration
 * variables, WP Model Info), so its AI counts them as set. Same-origin
 * `BroadcastChannel`, like the settings channel; names only, never values.
 *
 * `ids` and `reads` (added for Library health; optional, so an older
 * canvas tab's answer still parses): the library ids the canvas uses and
 * the variables its Assemblers read.
 */
import type { CanvasVar } from "./graph";

export const CANVAS_FACTS_CHANNEL = "wp-canvas-facts";

export type CanvasFactsMessage =
  | { type: "ask"; id: string }
  | { type: "facts"; id: string; vars: CanvasVar[]; ids?: string[]; reads?: string[] };
