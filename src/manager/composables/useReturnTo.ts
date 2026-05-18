import { useRoute } from "vue-router";

/**
 * Whitelist of known SPA list/landing paths. resolveReturnTo only honors a
 * returnTo query whose base path is in this set — defeats open-redirect
 * vectors via crafted ?returnTo=//evil.example.com URLs.
 */
export const KNOWN_LIST_PATHS = new Set<string>([
  "/wildcards",
  "/fixed-values",
  "/combines",
  "/derivations",
  "/constraints",
  "/bundles",
  "/all",
  "/categories",
  "/dashboard",
  "/import-export",
  "/test",
]);

/**
 * Validate and decode a returnTo query parameter; fall back to `fallback`
 * when missing, malformed, or not in the allowlist.
 */
export function useReturnTo() {
  const route = useRoute();

  function resolveReturnTo(fallback: string): string {
    const raw = route.query.returnTo;
    if (typeof raw !== "string") return fallback;
    try {
      const decoded = decodeURIComponent(raw);
      if (!decoded.startsWith("/") || decoded.startsWith("//")) return fallback;
      const basePath = decoded.split("?")[0];
      if (!KNOWN_LIST_PATHS.has(basePath)) return fallback;
      return decoded;
    } catch {
      return fallback;
    }
  }

  return { resolveReturnTo };
}
