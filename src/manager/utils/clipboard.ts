/**
 * clipboard — copy text, also where `navigator.clipboard` is missing.
 *
 * Browsers only give `navigator.clipboard` to secure pages (https or
 * localhost), so ComfyUI opened over plain http on the LAN has none. There a
 * hidden textarea is selected and copied with `execCommand("copy")`, which
 * still works inside a click.
 */

/** Copy `text`; true when it reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  const api = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (api?.writeText) {
    try {
      await api.writeText(text);
      return true;
    } catch {
      // Refused (no permission, page not focused): try the old way.
    }
  }
  return copyByTextarea(text);
}

function copyByTextarea(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  const focused = document.activeElement;
  const selection = document.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  document.body.appendChild(area);
  area.focus({ preventScroll: true });
  area.select();
  let ok = false;
  try {
    ok = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  if (range && selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (focused instanceof HTMLElement) focused.focus();
  return ok;
}
