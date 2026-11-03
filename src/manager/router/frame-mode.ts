/**
 * Frame mode: the manager opened inside the canvas's node help dialog
 * (`/wp/docs/<page>?frame=help`, `components/shared/NodeHelpDialog.vue`).
 *
 * Read once from the address the page loaded with, so it holds for every
 * docs page the reader moves to inside the frame (router navigation never
 * reloads). In frame mode the router mounts `FrameLayout` (the docs alone,
 * no topbar, sidebar, AI chat or library boot work) and any link that leaves
 * the docs opens the full manager in a new tab instead.
 */
export function isFrameUrl(search: string): boolean {
  return new URLSearchParams(search).get("frame") === "help";
}

export const FRAMED = typeof window !== "undefined" && isFrameUrl(window.location.search);

/** True when `path` stays inside the docs, the only pages the frame shows. */
export function staysInFrame(path: string): boolean {
  return path === "/docs" || path.startsWith("/docs/") || path.startsWith("/docs#");
}
