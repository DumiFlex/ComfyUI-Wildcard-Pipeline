/**
 * Release check - once-per-day GitHub Releases poll for "update available".
 *
 * Hits `https://api.github.com/repos/<owner>/<repo>/releases/latest`
 * anonymously (unauthenticated requests get 60/hr per IP, plenty for a
 * single-user dev tool). The result + a timestamp are cached in
 * localStorage; subsequent calls return the cached value until the TTL
 * expires, so a topbar re-mount doesn't burn a request per page nav.
 *
 * The composable returns a reactive `hasUpdate` flag + `latestVersion`
 * so AppTopbar can paint an accent dot without owning the polling
 * machinery. Network failure (offline, rate limit, 404 on private repo)
 * fails silently - `hasUpdate` stays false; we never block the UI.
 */
import { onMounted, ref } from "vue";

import { GITHUB_REPO } from "../config/links";

const STORAGE_KEY = "wp.releaseCheck";
const TTL_MS = 24 * 60 * 60 * 1000;

interface CachedRelease {
  /** ISO timestamp of when the check ran. */
  checked_at: string;
  /** GitHub release `tag_name` minus a leading `v`. */
  latest_version: string;
}

/**
 * Strip a single leading `v` from a tag name so `v1.7.0` and `1.7.0`
 * both normalise to `1.7.0`. Semver comparison treats them identically;
 * the normalised form is what we cache and compare against the bundled
 * `__APP_VERSION__` string.
 */
function normalizeTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Compare two semver strings - returns positive when `a > b`. Handles
 * `1.7.0`-style strings; prerelease tags (`1.7.0-dev`, `1.7.0-rc.1`)
 * are treated as older than their bare counterpart so a build labeled
 * `1.7.0-dev` won't mask an actual `1.7.0` release. Non-numeric
 * segments compare lexically. Good enough for "is the latest tag
 * newer than what we're running" without pulling in a semver lib.
 */
function semverCompare(a: string, b: string): number {
  const [aBase, aPre = ""] = a.split("-");
  const [bBase, bPre = ""] = b.split("-");
  const aParts = aBase.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bParts = bBase.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  if (aPre === bPre) return 0;
  return aPre < bPre ? -1 : 1;
}

/**
 * Parse the cached blob if it's still fresh. Returns null on cache
 * miss, parse failure, or TTL expiry - caller refetches on null.
 */
function readCache(): CachedRelease | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedRelease;
    const age = Date.now() - new Date(parsed.checked_at).getTime();
    if (Number.isNaN(age) || age > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(latestVersion: string): void {
  if (typeof localStorage === "undefined") return;
  const payload: CachedRelease = {
    checked_at: new Date().toISOString(),
    latest_version: latestVersion,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / disabled storage - ignore.
  }
}

/**
 * Derive `owner/repo` from the configured GITHUB_REPO URL. Centralized
 * so a repo rename touches only `manager/config/links.ts`.
 */
function repoSlug(): string | null {
  const match = GITHUB_REPO.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

async function fetchLatestRelease(): Promise<string | null> {
  const slug = repoSlug();
  if (!slug) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown };
    if (typeof body.tag_name !== "string") return null;
    return normalizeTag(body.tag_name);
  } catch {
    return null;
  }
}

/**
 * Vue composable. Call from a setup() block - the underlying GitHub
 * fetch runs on mount, once per 24h. The returned `current` /
 * `latestVersion` / `hasUpdate` refs stay reactive across the lifetime
 * of the consumer.
 */
export function useReleaseCheck(): {
  current: string;
  latestVersion: ReturnType<typeof ref<string | null>>;
  hasUpdate: ReturnType<typeof ref<boolean>>;
} {
  const current = __APP_VERSION__;
  const latestVersion = ref<string | null>(null);
  const hasUpdate = ref<boolean>(false);

  function applyLatest(v: string | null): void {
    latestVersion.value = v;
    hasUpdate.value = v !== null && semverCompare(v, current) > 0;
  }

  onMounted(async () => {
    const cached = readCache();
    if (cached) {
      applyLatest(cached.latest_version);
      return;
    }
    const fresh = await fetchLatestRelease();
    if (fresh) {
      writeCache(fresh);
      applyLatest(fresh);
    }
  });

  return { current, latestVersion, hasUpdate };
}
