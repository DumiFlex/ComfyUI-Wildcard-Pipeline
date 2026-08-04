/**
 * Release check - GitHub Releases lookup for "update available".
 *
 * Hits `https://api.github.com/repos/<owner>/<repo>/releases/latest`
 * anonymously. Cadence is launch-throttled + manual: on mount we paint any
 * cached result immediately, then refresh IF the user opted into launch
 * checks (`uiStore.checkOnLaunch`) AND the cache has gone stale.
 * `checkNow()` is the on-demand escape hatch and ignores the throttle.
 *
 * WHY THE CACHE THROTTLES RATHER THAN JUST PAINTING
 *
 * The in-memory `sessionFetched` guard only covers one page lifetime — it is
 * a module-level binding, so a browser reload starts over. That made the real
 * cadence "once per page load", and anonymous GitHub allows 60 requests per
 * hour per IP. Sixty reloads while working on the SPA is an afternoon, and
 * once the quota is gone every OTHER anonymous GitHub call from that IP dies
 * too. So freshness is now judged from the persisted `checked_at`, which does
 * survive reloads; the in-memory guard remains as the cheap first gate.
 *
 * A release check is not time-critical — it exists to eventually notice a new
 * version, and being up to `LAUNCH_TTL_MS` behind costs nothing.
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
/** Separate key: the history is a different shape and a different cadence. */
const HISTORY_KEY = "wp.releaseHistory";

/**
 * How many past releases the What's new page offers.
 *
 * Three, because the gap being covered is small but real: a user who updates
 * infrequently — or who was on 2.12.0 for the hour before 2.13.0 replaced it —
 * would otherwise never see the notes for the release they actually skipped
 * past. More than three and the page becomes a changelog, which the compare
 * link already does better.
 */
export const HISTORY_COUNT = 3;

/**
 * How stale the cache must be before a launch check goes back to the network.
 *
 * Six hours: long enough that a day of reloads costs ~4 requests instead of
 * one per reload, short enough that a release published this morning is
 * noticed today.
 */
export const LAUNCH_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedRelease {
  /** ISO timestamp of when the check ran. */
  checked_at: string;
  /** GitHub release `tag_name` minus a leading `v`. */
  latest_version: string;
  body?: string | null;
  url?: string | null;
  /**
   * Epoch ms until which GitHub has said the quota is spent, from the
   * `X-RateLimit-Reset` header. Persisted because the whole point is to
   * survive the reloads that caused the exhaustion.
   */
  rate_limited_until?: number | null;
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
/** Epoch ms until which GitHub has refused us, or null when we are clear. */
const rateLimitedUntil = ref<number | null>(null);
/** Recent releases, newest first. Empty until `loadHistory` resolves. */
const history = ref<ReleaseSummary[]>([]);

export interface ReleaseSummary {
  version: string;
  body: string;
  url: string | null;
  publishedAt: string | null;
}

/** Guard so the once-per-session launch fetch fires at most once across all
 *  consumers. `checkNow` ignores it. */
let sessionFetched = false;

/**
 * The request currently in flight, shared by every caller.
 *
 * Consumers mount in the same tick (topbar pill, Dashboard, Settings) and each
 * used to read `sessionFetched` as false — which is only set once a response
 * lands — so a single page load fired one request PER CONSUMER. Coalescing
 * here makes concurrent callers await the same response.
 */
let inflight: Promise<void> | null = null;

/** Test-only: reset the shared state + session guard between mounts. */
export function resetReleaseCheckSession(): void {
  sessionFetched = false;
  inflight = null;
  latestVersion.value = null;
  hasUpdate.value = false;
  severity.value = null;
  releaseBody.value = null;
  releaseUrl.value = null;
  lastChecked.value = null;
  checking.value = false;
  rateLimitedUntil.value = null;
  history.value = [];
  historyFetched = false;
}

/** Once per page: the history does not change while someone reads it. */
let historyFetched = false;

function readHistoryCache(): { at: string; items: ReleaseSummary[] } | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(HISTORY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { at: string; items: ReleaseSummary[] };
  } catch {
    return null;
  }
}

/**
 * Fetch the last few releases for the What's new page.
 *
 * Subject to the same throttle and the same rate-limit lockout as the update
 * check — this is a second GitHub call on a shared 60/hr anonymous quota, and
 * the whole point of the caching work was that a page someone opens repeatedly
 * must not spend a request each time.
 */
async function loadHistory(): Promise<void> {
  const cached = readHistoryCache();
  if (cached?.items?.length) history.value = cached.items;

  const fresh = cached ? Date.now() - Date.parse(cached.at) < LAUNCH_TTL_MS : false;
  if (historyFetched || fresh || isRateLimited()) return;
  historyFetched = true;

  const slug = repoSlug();
  if (!slug) return;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${slug}/releases?per_page=${HISTORY_COUNT}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        const reset = Number.parseInt(res.headers?.get?.("X-RateLimit-Reset") ?? "", 10);
        writeRateLimit(Number.isFinite(reset) ? reset * 1000 : Date.now() + 60 * 60 * 1000);
      }
      return;
    }
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return;
    const items: ReleaseSummary[] = rows
      .filter((r) => r.draft !== true && r.prerelease !== true)
      .map((r) => ({
        version: normalizeTag(String(r.tag_name ?? "")),
        body: typeof r.body === "string" ? r.body : "",
        url: typeof r.html_url === "string" ? r.html_url : null,
        publishedAt: typeof r.published_at === "string" ? r.published_at : null,
      }))
      .filter((r) => r.version.length > 0);
    if (!items.length) return;
    history.value = items;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ at: new Date().toISOString(), items }));
    } catch {
      // Storage denied — the in-memory list still serves this page view.
    }
  } catch {
    // Offline. The cached list, if any, is already painted.
  }
}

/** Is the persisted check recent enough to skip the network? */
function isFresh(cached: CachedRelease | null, now = Date.now()): boolean {
  if (!cached?.checked_at) return false;
  const at = Date.parse(cached.checked_at);
  if (Number.isNaN(at)) return false;
  return now - at < LAUNCH_TTL_MS;
}

/** Are we inside a window GitHub told us to wait out? */
function isRateLimited(now = Date.now()): boolean {
  return rateLimitedUntil.value !== null && rateLimitedUntil.value > now;
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
 *  fetch + `checkNow`. No-op while GitHub has us locked out — retrying inside
 *  the penalty window only deepens it. */
async function refresh(): Promise<void> {
  if (isRateLimited()) return;
  // Join a request already on the wire rather than opening a second one.
  if (inflight) return inflight;
  checking.value = true;
  inflight = (async () => {
    try {
      const fresh = await fetchLatestRelease();
      if (fresh) {
        writeCache(fresh);
        releaseBody.value = fresh.body;
        releaseUrl.value = fresh.url;
        lastChecked.value = new Date().toISOString();
        applyLatest(fresh.version);
      }
    } finally {
      checking.value = false;
      inflight = null;
    }
  })();
  return inflight;
}

/** Manual check — refetches even when the cache is fresh, because the user
 *  asked. Because the refs are shared, this lights the topbar pill +
 *  Settings simultaneously. */
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
    rate_limited_until: rateLimitedUntil.value,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / disabled storage - ignore.
  }
}

/**
 * Persist a rate-limit lockout without disturbing the cached release.
 *
 * Written separately from `writeCache` because a 403 carries no release to
 * cache — and the previous good answer must survive, or the UI would forget
 * the version it already knows every time the quota runs out.
 */
function writeRateLimit(until: number | null): void {
  rateLimitedUntil.value = until;
  if (typeof localStorage === "undefined") return;
  const prev = readCache();
  if (!prev) return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...prev, rate_limited_until: until } satisfies CachedRelease),
    );
  } catch {
    // Quota / disabled storage - the in-memory ref still guards this session.
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
    if (!res.ok) {
      // 403 (classic) / 429 (secondary limits) with no quota left means every
      // further request until the reset is refused anyway. Honour the reset
      // GitHub hands back rather than guessing a backoff.
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers?.get?.("X-RateLimit-Remaining");
        const reset = Number.parseInt(res.headers?.get?.("X-RateLimit-Reset") ?? "", 10);
        if (remaining === "0" || Number.isFinite(reset)) {
          // Header is epoch SECONDS. Fall back to an hour when it is absent
          // or nonsense, which is the standard window length.
          const until = Number.isFinite(reset) ? reset * 1000 : Date.now() + 60 * 60 * 1000;
          writeRateLimit(until);
        }
      }
      return null;
    }
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
  rateLimitedUntil: ReturnType<typeof ref<number | null>>;
  history: ReturnType<typeof ref<ReleaseSummary[]>>;
  loadHistory: () => Promise<void>;
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
      // Restore a lockout recorded before the last reload. Without this the
      // reload that follows a 403 immediately spends another request.
      if (typeof cached.rate_limited_until === "number") {
        rateLimitedUntil.value = cached.rate_limited_until;
      }
    }
    // Then refresh, subject to three gates: the user opted into launch
    // checks, nothing has fetched yet this page, and the persisted answer has
    // actually aged out. The last one is what keeps a reload-heavy session
    // from burning the 60/hr anonymous quota.
    if (ui.checkOnLaunch && !sessionFetched && !isFresh(cached)) {
      // Marked on ATTEMPT, not on success. Setting it after the response
      // landed left a window in which every other consumer mounting this tick
      // also saw `false` and opened its own request. A failed attempt not
      // retrying until the next page is fine — the whole check is best-effort.
      sessionFetched = true;
      void refresh();
    }
  });

  return {
    current, latestVersion, hasUpdate, severity,
    releaseBody, releaseUrl, lastChecked, checking, rateLimitedUntil,
    history, loadHistory, checkNow,
  };
}
