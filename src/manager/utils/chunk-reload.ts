/**
 * Recovery when the manager's code files go missing under a live page.
 *
 * A tab left asleep across a server restart or rebuild can wake holding an
 * old page whose chunk names no longer exist. Before the app mounts, the
 * boot watchdog in `src/manager.html` catches that (it waits for the server
 * and reloads). After mount, a route's lazy chunk fails the same way; this
 * reloads straight to the route that was asked for.
 *
 * Both share one reload budget in sessionStorage (`RELOAD_KEY`, the same
 * key the inline watchdog uses) so a build that is truly broken stops after
 * a few tries instead of reloading forever.
 */
import type { Router } from "vue-router";

export const RELOAD_KEY = "wp-boot-reloads";
export const MAX_RELOADS = 3;
export const RELOAD_WINDOW_MS = 60_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The messages browsers give a dynamic import whose file failed to load. */
const CHUNK_ERROR =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i;

export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return CHUNK_ERROR.test(message);
}

/** Claims one automatic reload. False once the budget for the window is spent. */
export function takeReloadSlot(storage: Store | undefined, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    let count = 0;
    const raw = storage.getItem(RELOAD_KEY);
    if (raw) {
      const seen = JSON.parse(raw) as { n?: unknown; t?: unknown };
      if (typeof seen.n === "number" && typeof seen.t === "number" && now - seen.t < RELOAD_WINDOW_MS) count = seen.n;
    }
    if (count >= MAX_RELOADS) return false;
    storage.setItem(RELOAD_KEY, JSON.stringify({ n: count + 1, t: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearReloads(storage: Store | undefined): void {
  try {
    storage?.removeItem(RELOAD_KEY);
  } catch {
    /* storage unavailable */
  }
}

function sessionStore(): Store | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function installChunkRecovery(router: Router, go: (href: string) => void = (href) => window.location.assign(href)): void {
  let reloading = false;
  router.onError((err, to) => {
    if (reloading || !isChunkLoadError(err)) return;
    if (!takeReloadSlot(sessionStore())) return;
    reloading = true;
    go(router.resolve(to).href);
  });
  // The page loaded and routed fine, so the budget starts fresh.
  void router.isReady().then(() => clearReloads(sessionStore()), () => undefined);
}
