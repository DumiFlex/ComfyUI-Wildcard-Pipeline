/**
 * Loads the Wildcard Pipeline Community embed bundle at runtime.
 *
 * The bundle ships as an ESM module at
 * `${WPC_API_URL}/embed/wpc-embed.js`. We dynamic-import it the first
 * time someone visits the Community tab and cache the resulting
 * module so re-entry is instant. The bundle re-bundles Vue inside
 * itself (separate module scope from the host extension's Vue) so
 * there's no globalThis.Vue shim or import map ceremony.
 *
 * If the import fails (offline, CORS, host down), callers get a
 * typed `EmbedLoadError` they can render as an offline-screen.
 */

import { WPC_EMBED_URL } from "../config/links";

export class EmbedLoadError extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly url: string,
  ) {
    super(`Failed to load community embed from ${url}`);
    this.name = "EmbedLoadError";
  }
}

export interface EmbedNavigateTarget {
  view: "browse" | "detail" | "profile" | "auth";
  slug?: string;
  username?: string;
}

export interface EmbedMountOptions {
  containerEl: HTMLElement;
  view: "browse" | "detail" | "profile" | "auth";
  initialSlug?: string;
  initialUsername?: string;
  apiBaseUrl: string;
  tokenStore: {
    getAccessToken(): Promise<string | null>;
    getRefreshToken(): Promise<string | null>;
    setTokens(pair: { access: string; refresh: string; expiresAt: number }): Promise<void>;
    clear(): Promise<void>;
  };
  theme?: "auto" | "dark" | "light";
  onNavigate?: (target: EmbedNavigateTarget) => void;
  onClose?: () => void;
  onUnauthenticated?: () => void;
}

export interface EmbedHandle {
  unmount(): void;
  navigate(target: EmbedNavigateTarget): void;
}

interface EmbedModule {
  mount: (opts: EmbedMountOptions) => EmbedHandle;
}

let cached: Promise<EmbedModule> | null = null;

/**
 * Load (or return the cached) embed module. Throws `EmbedLoadError`
 * on import failure so the caller can offer a retry.
 */
export async function loadEmbed(): Promise<EmbedModule> {
  if (cached === null) {
    cached = (async () => {
      try {
        // The /* @vite-ignore */ comment tells Vite not to try to
        // bundle the dynamic specifier — it's a runtime URL pulled
        // from config, not a known import resolvable at build time.
        const mod = (await import(/* @vite-ignore */ WPC_EMBED_URL)) as EmbedModule;
        if (typeof mod.mount !== "function") {
          throw new Error("embed module is missing mount()");
        }
        return mod;
      } catch (err) {
        // Clear the cache so a retry actually retries instead of
        // returning the rejected promise forever.
        cached = null;
        throw new EmbedLoadError(err, WPC_EMBED_URL);
      }
    })();
  }
  return cached;
}
