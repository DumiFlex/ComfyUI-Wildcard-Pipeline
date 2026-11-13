/**
 * Keep a DOM editor on the node while a link drives its input.
 *
 * ComfyUI treats a linked widget input as "the wire replaces the control":
 * each draw, `updateComputedDisabled` sets `computedDisabled` and
 * `connectionSuppressed` on the widget, a DOM widget whose `computedDisabled`
 * is set reports `isVisible() === false` (so its element is hidden), and a
 * suppressed widget's row only draws its name. For the stock text box that is
 * fine. For the Assembler's editors it left a hole the size of the editor in
 * the middle of the node, with nothing drawn in it (the host's row label is
 * covered by our own layout), and the wire landing in empty space.
 *
 * Our editors render the linked state themselves ("from the template input",
 * `templateEditor.ts` checks the link), so the host should keep drawing them.
 * This pins both flags on the widget instance: `computedDisabled` follows only
 * the widget's own `disabled`, and `connectionSuppressed` stays false. Writes
 * from the host are dropped. Nothing else changes: the input keeps its link,
 * its dot and its value, and the linked value still wins at run time.
 */

interface PinnableWidget {
  disabled?: boolean;
  computedDisabled?: boolean;
  connectionSuppressed?: boolean;
}

export function keepEditorWhenLinked(widget: object): void {
  const w = widget as PinnableWidget;
  Object.defineProperty(w, "computedDisabled", {
    configurable: true,
    enumerable: true,
    get: () => w.disabled === true,
    set: () => {},
  });
  Object.defineProperty(w, "connectionSuppressed", {
    configurable: true,
    enumerable: true,
    get: () => false,
    set: () => {},
  });
}
