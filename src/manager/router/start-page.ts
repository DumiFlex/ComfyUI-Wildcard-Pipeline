/**
 * Where the manager opens (Settings › Appearance › Start page), plus the
 * "last page" memory it can reopen and the What's-new-after-an-update jump.
 *
 * Reads localStorage directly rather than the ui store: the redirect runs
 * inside the router before any component, and the store keys are the
 * contract (see `uiStore.ts`).
 */
import type { RouteLocationNormalized, Router } from "vue-router";

const START_PAGE_KEY = "wp-start-page";
const LAST_ROUTE_KEY = "wp-last-route";
const WHATS_NEW_KEY = "wp-whats-new-after-update";
const LAST_SEEN_VERSION_KEY = "wp-last-seen-version";

const PATHS: Record<string, string> = {
  dashboard: "/dashboard",
  all: "/all",
  wildcards: "/wildcards",
  test: "/test",
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable */
  }
}

/** A remembered path is only reused when it is one of ours and not a
 *  one-off (a 404, or an editor for a row that may since be gone is fine —
 *  the editor handles a missing id itself). */
function usableLastRoute(path: string | null): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  if (path === "/" || path.startsWith("/whats-new")) return null;
  return path;
}

/** The path the bare `/wp/` URL redirects to. */
export function startPagePath(): string {
  const page = read(START_PAGE_KEY) ?? "dashboard";
  if (page === "last") return usableLastRoute(read(LAST_ROUTE_KEY)) ?? PATHS.dashboard;
  return PATHS[page] ?? PATHS.dashboard;
}

/** Remember each page visited, for the "Last page" start option. */
export function rememberRoute(to: RouteLocationNormalized): void {
  if (to.name === "not-found") return;
  const path = usableLastRoute(to.fullPath);
  if (path) write(LAST_ROUTE_KEY, path);
}

/**
 * True once per version change when What's new should open.
 *
 * The very first run only records the version: a fresh install has nothing
 * "new" to announce. Always records the current version, so turning the
 * setting back on later does not replay an old update.
 */
export function shouldShowWhatsNew(currentVersion: string): boolean {
  const seen = read(LAST_SEEN_VERSION_KEY);
  write(LAST_SEEN_VERSION_KEY, currentVersion);
  if (seen === null || seen === currentVersion) return false;
  return read(WHATS_NEW_KEY) !== "0";
}

export function installStartPage(router: Router, currentVersion: string): void {
  router.afterEach((to) => rememberRoute(to));
  if (shouldShowWhatsNew(currentVersion)) {
    void router.isReady().then(() => {
      if (router.currentRoute.value.name !== "whats-new") void router.push({ name: "whats-new" });
    });
  }
}
