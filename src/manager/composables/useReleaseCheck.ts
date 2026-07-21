/**
 * Release check - GitHub Releases lookup for "update available".
 *
 * Hits `https://api.github.com/repos/<owner>/<repo>/releases/latest`
 * anonymously (unauthenticated requests get 60/hr per IP, plenty for a
 * single-user dev tool). Cadence is launch-once + manual: on mount we
 * paint any cached result immediately, then refresh once per app session
 * IF the user opted into launch checks (`uiStore.checkOnLaunch`). There is
 * no timed re-poll; `checkNow()` triggers an on-demand refresh. The
 * localStorage cache exists only to paint instantly before the network
 * call resolves — it is not a re-check suppressor.
 *
 * The composable returns reactive `hasUpdate` / `latestVersion` /
 * `severity` so AppTopbar can paint an accent pill, plus the release
 * `body` / `html_url` / `lastChecked` for the Update dialog + Settings.
 * Network failure (offline, rate limit, 404 on private repo) fails
 * silently - `hasUpdate` stays false; we never block the UI.
 */
import { onMounted, ref } from "vue";

import { GITHUB_REPO } from "../config/links";
import { useUiStore } from "../stores/uiStore";

const STORAGE_KEY = "wp.releaseCheck";

interface CachedRelease {
  /** ISO timestamp of when the check ran. */
  checked_at: string;
  /** GitHub release `tag_name` minus a leading `v`. */
  latest_version: string;
  body?: string | null;
  url?: string | null;
}

/** Module-level singleton state so EVERY consumer (topbar pill + Settings
 *  card) shares ONE reactive source. Without this, each `useReleaseCheck()`
 *  call got its own refs — so a manual "Check now" in Settings updated only
 *  Settings' copy and the topbar pill stayed dark until a page reload. */
const latestVersion = ref<string | null>(null);
const hasUpdate = ref<boolean>(false);
const severity = ref<UpdateSeverity | null>(null);
const releaseBody = ref<string | null>(null);
const releaseUrl = ref<string | null>(null);
const lastChecked = ref<string | null>(null);
const checking = ref<boolean>(false);

/** Guard so the once-per-session launch fetch fires at most once across all
 *  consumers. `checkNow` ignores it. */
let sessionFetched = false;

/** Test-only: reset the shared state + session guard between mounts. */
export function resetReleaseCheckSession(): void {
  sessionFetched = false;
  latestVersion.value = null;
  hasUpdate.value = false;
  severity.value = null;
  releaseBody.value = null;
  releaseUrl.value = null;
  lastChecked.value = null;
  checking.value = false;
}

/** Apply a candidate latest version to the shared refs. Reads
 *  `__APP_VERSION__` lazily (not a cached const) so tests that assign it
 *  after import see the right value. Guards a missing/malformed version so a
 *  bad cache degrades to "no update" instead of throwing in semverCompare. */
function applyLatest(v: string | null): void {
  const current = __APP_VERSION__;
  const valid = typeof v === "string" && v.length > 0 && typeof current === "string";
  latestVersion.value = valid ? v : null;
  const newer = valid && semverCompare(v as string, current) > 0;
  hasUpdate.value = newer;
  severity.value = newer ? classifyBump(current, v as string) : null;
}

/** Fetch fresh, persist, apply to the shared refs. Shared by the launch
 *  fetch + `checkNow`. */
async function refresh(): Promise<void> {
  checking.value = true;
  try {
    const fresh = await fetchLatestRelease();
    if (fresh) {
      sessionFetched = true;
      writeCache(fresh);
      releaseBody.value = fresh.body;
      releaseUrl.value = fresh.url;
      lastChecked.value = new Date().toISOString();
      applyLatest(fresh.version);
    }
  } finally {
    checking.value = false;
  }
}

/** Manual check — always refetches, ignores the session guard. Because the
 *  refs are shared, this lights the topbar pill + Settings simultaneously. */
async function checkNow(): Promise<void> {
  await refresh();
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

/** Update severity ranked by which semver segment changed. Drives the
 *  topbar pill tone — major = amber warn, minor/patch = purple accent. */
export type UpdateSeverity = "major" | "minor" | "patch";

/**
 * Classify the gap between two semver versions. Reads which position
 * differs first — major bump beats minor beats patch. Prerelease tags
 * collapse to patch (a `1.7.0-rc.2` over `1.7.0-rc.1` is not breaking).
 *
 * Returns null when versions are equal or `latest` isn't strictly newer
 * (callers gate on `hasUpdate` first, so this is defensive).
 */
function classifyBump(current: string, latest: string): UpdateSeverity | null {
  if (semverCompare(latest, current) <= 0) return null;
  const [curBase] = current.split("-");
  const [latBase] = latest.split("-");
  const cur = curBase.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const lat = latBase.split(".").map((n) => Number.parseInt(n, 10) || 0);
  if ((lat[0] ?? 0) > (cur[0] ?? 0)) return "major";
  if ((lat[1] ?? 0) > (cur[1] ?? 0)) return "minor";
  return "patch";
}

/**
 * Parse the cached blob. Returns null on cache miss or parse failure.
 * There is no TTL expiry — the cache is paint-first, never a re-check
 * suppressor.
 */
function readCache(): CachedRelease | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedRelease;
  } catch {
    return null;
  }
}

function writeCache(rel: { version: string; body: string | null; url: string | null }): void {
  if (typeof localStorage === "undefined") return;
  const payload: CachedRelease = {
    checked_at: new Date().toISOString(),
    latest_version: rel.version,
    body: rel.body,
    url: rel.url,
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

async function fetchLatestRelease(): Promise<{ version: string; body: string | null; url: string | null } | null> {
  const slug = repoSlug();
  if (!slug) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown; body?: unknown; html_url?: unknown };
    if (typeof body.tag_name !== "string") return null;
    return {
      version: normalizeTag(body.tag_name),
      body: typeof body.body === "string" ? body.body : null,
      url: typeof body.html_url === "string" ? body.html_url : null,
    };
  } catch {
    return null;
  }
}

/**
 * Vue composable. Call from a setup() block — the underlying GitHub fetch
 * runs once on mount (when `checkOnLaunch` is on and no other consumer has
 * fetched this session). The returned refs stay reactive across the
 * lifetime of the consumer. Requires an active Pinia (reads uiStore).
 */
export function useReleaseCheck(): {
  current: string;
  latestVersion: ReturnType<typeof ref<string | null>>;
  hasUpdate: ReturnType<typeof ref<boolean>>;
  severity: ReturnType<typeof ref<UpdateSeverity | null>>;
  releaseBody: ReturnType<typeof ref<string | null>>;
  releaseUrl: ReturnType<typeof ref<string | null>>;
  lastChecked: ReturnType<typeof ref<string | null>>;
  checking: ReturnType<typeof ref<boolean>>;
  checkNow: () => Promise<void>;
} {
  const current = __APP_VERSION__;
  const ui = useUiStore();

  onMounted(() => {
    // Paint the cached result immediately (if any) so the pill/dialog
    // aren't blank while the network call is in flight.
    const cached = readCache();
    if (cached) {
      releaseBody.value = cached.body ?? null;
      releaseUrl.value = cached.url ?? null;
      lastChecked.value = cached.checked_at ?? null;
      applyLatest(cached.latest_version);
    }
    // Then refresh once per session, only when the user opted into launch
    // checks. Fire-and-forget; failures are swallowed in refresh.
    if (ui.checkOnLaunch && !sessionFetched) {
      void refresh();
    }
  });

  return {
    current, latestVersion, hasUpdate, severity,
    releaseBody, releaseUrl, lastChecked, checking, checkNow,
  };
}
