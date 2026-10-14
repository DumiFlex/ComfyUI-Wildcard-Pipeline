/**
 * Viewport position of a caret offset inside a `<textarea>`.
 *
 * The mirror-div technique (component/textarea-caret-position): an
 * off-screen div copies the textarea's box and text styles, holds the text up
 * to the offset, then a marker span; the span's offset is the caret's. Used
 * to anchor the chat boxes' completion popover at the word being typed.
 */
const COPIED = [
  "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "letterSpacing", "wordSpacing", "tabSize",
] as const;

export function textareaCaretRect(el: HTMLTextAreaElement, offset: number): { top: number; left: number; height: number } {
  const box = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  const m = mirror.style;
  for (const key of COPIED) m[key] = style[key];
  m.position = "absolute";
  m.visibility = "hidden";
  m.top = "0";
  m.left = "-9999px";
  m.whiteSpace = "pre-wrap";
  m.overflowWrap = "break-word";
  mirror.textContent = el.value.slice(0, offset);
  const mark = document.createElement("span");
  mark.textContent = el.value.slice(offset) || ".";
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3 || 16;
  const top = box.top + mark.offsetTop + (parseFloat(style.borderTopWidth) || 0) - el.scrollTop;
  const left = box.left + mark.offsetLeft + (parseFloat(style.borderLeftWidth) || 0) - el.scrollLeft;
  document.body.removeChild(mirror);
  return { top, left, height: lineHeight };
}
