/**
 * Is a key combo already answered by something on this page?
 *
 * A browser can't list another script's key listeners, and an extension that
 * reads `keydown` itself declares nothing ComfyUI's keymap could show. So
 * this asks the page: it sends a synthetic keydown (then keyup) for the
 * combo, the way a real press would arrive, and watches for a listener that
 * claims it with `preventDefault`, `stopPropagation` or
 * `stopImmediatePropagation`. Those three throw on the probe's event, so a
 * handler that claims the key before acting on it (ComfyUI's keybindings,
 * most extensions) stops right there and does nothing. The throw is caught
 * from the window's error event and kept out of the console.
 *
 * The event also carries the legacy `keyCode` / `which` a real press has:
 * libraries like hotkeys-js (ComfyUI-Easy-Use binds Alt+0…9 to its node
 * templates with it) match on `keyCode` alone, and a constructed
 * KeyboardEvent has 0 there, so without it the probe walked past them and
 * Suggest handed out keys they take.
 *
 * What it can't see: a handler that acts without claiming the key, or that
 * claims it only after acting (that one does run once), or that ignores
 * synthetic events. Browser shortcuts never fire for synthetic events, which
 * is why `BROWSER_RESERVED` lists them instead.
 */
import { parseCombo } from "./bookmarks";

const STOP = Symbol("wp-key-probe");
const probes = new WeakSet<Event>();

/** True for the probe's own events, which no real handler of ours should
 *  act on. */
export function isProbeEvent(e: Event): boolean {
  return probes.has(e);
}

/** The physical key a real press of `key` would carry (`Digit1`, `KeyA`,
 *  `F5`), for handlers that read `code`. */
export function codeFor(key: string): string {
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  const named: Record<string, string> = { " ": "Space", Space: "Space", "-": "Minus", "=": "Equal", ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "`": "Backquote" };
  return named[key] ?? key;
}

const LEGACY_NAMED: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, Space: 32, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45, Delete: 46,
  ";": 186, "=": 187, ",": 188, "-": 189, ".": 190, "/": 191, "`": 192, "[": 219, "\\": 220, "]": 221, "'": 222,
};

/** The legacy `keyCode` a real press of `key` carries (`1` → 49, `K` → 75,
 *  `F5` → 116), 0 when it has none we know. */
export function keyCodeFor(key: string): number {
  if (/^[0-9]$/.test(key)) return 48 + Number(key);
  if (/^[A-Z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (f) return 111 + Number(f[1]);
  return LEGACY_NAMED[key] ?? 0;
}

function send(type: "keydown" | "keyup", combo: string, target: EventTarget): boolean {
  const p = parseCombo(combo);
  if (!p) return false;
  const key = p.key === "Space" ? " " : p.key.length === 1 ? p.key.toLowerCase() : p.key;
  const ev = new KeyboardEvent(type, {
    key: p.shift && key.length === 1 ? key.toUpperCase() : key,
    code: codeFor(p.key),
    ctrlKey: !!p.ctrl,
    altKey: !!p.alt,
    shiftKey: !!p.shift,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  // A constructed event can't set these; real presses always have them.
  const legacy = keyCodeFor(p.key);
  for (const name of ["keyCode", "which"] as const) Object.defineProperty(ev, name, { value: legacy, configurable: true });
  probes.add(ev);
  let claimed = false;
  const claim = (): never => {
    claimed = true;
    throw STOP;
  };
  for (const name of ["preventDefault", "stopPropagation", "stopImmediatePropagation"] as const) {
    Object.defineProperty(ev, name, { value: claim, configurable: true });
  }
  // A listener that threw STOP is reported through the window's error event:
  // swallow those, and only those.
  const hush = (e: ErrorEvent): void => {
    if (e.error === STOP) e.preventDefault();
  };
  window.addEventListener("error", hush, true);
  try {
    target.dispatchEvent(ev);
  } catch (err) {
    if (err !== STOP) throw err;
  } finally {
    window.removeEventListener("error", hush, true);
  }
  return claimed;
}

/**
 * True when something on the page claims `combo`. `target` is where a real
 * press would land (the canvas while you work on it); the event bubbles from
 * there to the document and the window.
 */
export function probeCombo(combo: string, target?: EventTarget | null): boolean {
  if (typeof window === "undefined" || typeof KeyboardEvent === "undefined") return false;
  const at = target ?? document.body ?? window;
  return send("keydown", combo, at) || send("keyup", combo, at);
}
