/**
 * Platform-correct labels for the modifier we actually listen for.
 *
 * The save shortcut in our modals is `(ev.ctrlKey || ev.metaKey) && Enter`, so
 * it has always worked on both platforms — but the hint rendered a hardcoded
 * `⌘`, which reads as a Mac-only binding to the ~90% of ComfyUI users on
 * Windows and Linux.
 */

/** True on macOS/iPadOS, where the command key is the accelerator. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  // `navigator.platform` is deprecated; prefer the UA-CH hint and fall back to
  // the user-agent string, which still carries "Macintosh" / "iPhone".
  const hint = nav.userAgentData?.platform ?? "";
  if (hint) return /mac/i.test(hint);
  return /mac|iphone|ipad|ipod/i.test(nav.userAgent ?? "");
}

/** The accelerator key's symbol: `⌘` on Apple platforms, `Ctrl` elsewhere. */
export function accelLabel(): string {
  return isApplePlatform() ? "⌘" : "Ctrl";
}

/** The full "save" chord as shown in modal footers — `⌘↵` or `Ctrl+↵`. */
export function saveChordLabel(): string {
  return isApplePlatform() ? "⌘↵" : "Ctrl+↵";
}
