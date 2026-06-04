/**
 * External link registry.
 *
 * Single source of truth for every off-app URL the SPA links to —
 * GitHub repo, wiki, Discord invite, etc. When a destination moves
 * (repo rename, Discord re-invite, doc subdomain swap), update here
 * and every surface that imports from this module follows.
 *
 * Consumers: `AppSidebar.vue` (Documentation + View Source nav),
 * `Dashboard.vue` ("Open docs" button), `Settings.vue` (repo link),
 * `Community.vue` (Discord CTA on the offline fallback). New external
 * links should land here rather than be hard-coded at the call site.
 */

/**
 * Canonical GitHub repository slug. All derived URLs (wiki, branches,
 * issues, raw blobs) build off this so a future rename touches one
 * line.
 */
export const GITHUB_REPO = "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline";

/**
 * Wiki landing page. Branch-aware so a wiki-restructure that moves
 * the entry point updates here rather than at five call sites.
 */
export const GITHUB_WIKI = `${GITHUB_REPO}/wiki`;

/**
 * Build a GitHub branch tree URL. Used by the community-tab WIP
 * notice; kept generic so future "track branch X" links don't need
 * a new export.
 */
export function githubBranchUrl(branch: string): string {
  return `${GITHUB_REPO}/tree/${branch}`;
}

/**
 * Discord community server invite. Invite code rotates if the server
 * resets invite settings; keep the full URL stored so the swap is a
 * one-token change. Used by the Community tab's primary CTA while
 * the full discover/upload flow is being designed.
 */
export const DISCORD_INVITE = "https://discord.gg/BFYR9WQdVR";

/**
 * Wildcard Pipeline Community API + embed host.
 *
 * Both the sister web SPA (full https URL) and the in-extension
 * embed bundle (`/embed/wpc-embed.js`) live here. The community-tab
 * integration loads the embed bundle from this origin at runtime;
 * every downstream call (auth, REST, downloads) hits the same base.
 *
 * Set via Vite env (`VITE_WPC_API_URL`) so dev points at
 * `http://localhost:8765` and the published build hits the canonical
 * prod host. The fallback is the live host so a missing env at
 * runtime still surfaces the community rather than 404.
 */
export const WPC_API_URL: string =
  (import.meta.env.VITE_WPC_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "https://wp.dumiflex.dev";

/** Latest embed bundle (always points at the newest release). */
export const WPC_EMBED_URL = `${WPC_API_URL}/embed/wpc-embed.js`;

/** Embed manifest for version pinning. See
 *  https://github.com/DumiFlex/Wildcard-Pipeline-Community/blob/main/docs/extension-integration.md */
export const WPC_EMBED_MANIFEST_URL = `${WPC_API_URL}/api/v1/embed/version.json`;
