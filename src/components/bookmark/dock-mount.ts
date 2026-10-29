/**
 * Mounts the Bookmarks dock on demand. Loaded through `loadBookmarkDock` in
 * `boot.ts`, so a session without bookmarks never downloads it.
 */
import { createApp, type App } from "vue";
import BookmarkDock from "./BookmarkDock.vue";
import { readDockPrefs, writeDockPrefs } from "../../widgets/bookmark";

let app: App | null = null;
let root: HTMLElement | null = null;

export function isDockOpen(): boolean {
  return app !== null;
}

export function showDock(): void {
  if (app) return;
  root = document.createElement("div");
  root.id = "wp-bookmark-dock-root";
  document.body.appendChild(root);
  app = createApp(BookmarkDock, { onClose: hideDock });
  app.mount(root);
}

export function hideDock(): void {
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
}

/** The top-bar button and the toggle command: open stays open across
 *  reloads, closed stays closed until opened again. */
export function toggleDock(): void {
  const open = !isDockOpen();
  writeDockPrefs({ ...readDockPrefs(), open });
  if (open) showDock();
  else hideDock();
}
