/**
 * The real `<textarea>` / `<input>` inside a kit Textarea or Input, from a
 * template function ref. Both pieces render the field as their root element
 * (Input does unless it has an icon, prefix, suffix or readonly, when the
 * field sits inside it), so code that focuses, selects or reads the caret
 * keeps working on the element itself:
 *
 *   <Textarea :ref="(c) => (box = textareaEl(c))" … />
 */
function rootOf(c: unknown): Element | null {
  if (c instanceof Element) return c;
  const el = (c as { $el?: unknown } | null)?.$el;
  return el instanceof Element ? el : null;
}

export function textareaEl(c: unknown): HTMLTextAreaElement | null {
  const el = rootOf(c);
  if (el instanceof HTMLTextAreaElement) return el;
  const inner = el?.querySelector("textarea");
  return inner instanceof HTMLTextAreaElement ? inner : null;
}

export function inputEl(c: unknown): HTMLInputElement | null {
  const el = rootOf(c);
  if (el instanceof HTMLInputElement) return el;
  const inner = el?.querySelector("input");
  return inner instanceof HTMLInputElement ? inner : null;
}
