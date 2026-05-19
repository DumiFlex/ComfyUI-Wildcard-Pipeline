/**
 * Platform detection helpers.
 *
 * `navigator.platform` is deprecated in modern specs, but the modern
 * replacement (`navigator.userAgentData.platform`) isn't in Safari yet
 * and isn't typed in lib.dom. Read the user agent string instead — it
 * still distinguishes Mac/iOS reliably for keyboard-shortcut UX.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iP(hone|ad|od)/i.test(navigator.userAgent);
}
