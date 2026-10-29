/**
 * External link registry.
 *
 * Single source of truth for every off-app URL the SPA links to —
 * GitHub repo, wiki, Discord invite, etc. When a destination moves
 * (repo rename, Discord re-invite, doc subdomain swap), update here
 * and every surface that imports from this module follows.
 *
 * Consumers: `AppSidebar.vue` (Documentation, Wiki, View Source, Report an
 * issue + Discord nav), `Dashboard.vue` ("Open docs" button),
 * `Settings.vue` (repo link), `Community.vue` (Discord CTA on the offline
 * fallback). New external links should land here rather than be hard-coded
 * at the call site.
 */

/**
 * Canonical GitHub repository slug. All derived URLs (wiki, branches,
 * issues, raw blobs) build off this so a future rename touches one
 * line.
 */
export const GITHUB_REPO = "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline";

/** The shared component kit's repo and its showcase site (every piece, live). */
export const KIT_REPO = "https://github.com/DumiFlex/wp-kit";
export const KIT_SITE = "https://dumiflex.github.io/wp-kit/";

/**
 * How the About card names the kit version: a release tag with its commit
 * ("v0.1.0 · f3841a3"), or the commit alone when src/kit/ was pulled from a
 * branch or a commit. The link opens that commit's files.
 */
export function kitVersion(v: { ref: string; sha: string }): { label: string; href: string } {
  const short = v.sha.slice(0, 7);
  const tagged = /^v\d+\.\d+\.\d+/.test(v.ref);
  return { label: tagged ? `${v.ref} · ${short}` : short, href: tagged ? `${KIT_REPO}/releases/tag/${v.ref}` : `${KIT_REPO}/tree/${v.sha}` };
}

/**
 * ComfyUI Registry node id for this pack — the `id` passed to ComfyUI
 * Manager's `/manager/queue/install` to update-in-place. Must match
 * `pyproject.toml` `name` (publisher `dumiflex`). A wrong id silently
 * no-ops the install.
 */
export const COMFY_REGISTRY_ID = "comfyui-wildcard-pipeline";

/**
 * Wiki landing page. Branch-aware so a wiki-restructure that moves
 * the entry point updates here rather than at five call sites.
 */
export const GITHUB_WIKI = `${GITHUB_REPO}/wiki`;

/**
 * New-issue page. Lands on the chooser rather than a prefilled template so
 * the user picks bug vs feature themselves — a wrong prefill is more friction
 * than none.
 */
export const GITHUB_NEW_ISSUE = `${GITHUB_REPO}/issues/new/choose`;

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
 * Both the sister web SPA (full https URL) and the page the Community
 * tab frames (`/embed-frame.html`) live here; every downstream call
 * (auth, REST, downloads) hits the same base.
 *
 * Set via Vite env (`VITE_WPC_API_URL`) so dev points at
 * `http://localhost:8765` and the published build hits the canonical
 * prod host. The fallback is the live host so a missing env at
 * runtime still surfaces the community rather than 404.
 */
export const WPC_API_URL: string =
  (import.meta.env.VITE_WPC_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "https://wp.dumiflex.dev";

/** The Community tab's page, framed in a sandboxed iframe (Community.vue). */
export const WPC_EMBED_FRAME_URL = `${WPC_API_URL}/embed-frame.html`;

/**
 * Ways to support the project, shown on Settings › About. One list so the
 * About page and any later "support" surface stay in step.
 */
export const SUPPORT_LINKS = [
  {
    id: "github",
    label: "Sponsor on GitHub",
    detail: "Monthly or one-time, through GitHub Sponsors.",
    icon: "pi-heart",
    href: "https://github.com/sponsors/DumiFlex",
  },
  {
    id: "coffee",
    label: "Buy me a coffee",
    detail: "A one-off thank you, no account needed.",
    icon: "pi-gift",
    href: "https://buymeacoffee.com/dumiflex",
  },
  {
    id: "paypal",
    label: "PayPal",
    detail: "Send any amount through PayPal.me.",
    icon: "pi-paypal",
    href: "https://paypal.me/DumiFlex",
  },
] as const;
