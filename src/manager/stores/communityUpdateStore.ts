/**
 * Community update-availability tracker.
 *
 * After every library refresh, walk all module + bundle rows that
 * carry a `community_post_slug` (engine migration 013), batch-fetch
 * the corresponding community posts, and surface any row whose
 * locally-stored `community_version_number` is below the post's
 * current `latest_version_number` as an "update available" entry.
 *
 * The Community tab's embed badge + per-row indicator both read from
 * this store; the actual upgrade action is "click the row → opens
 * the community post detail page in the embed → user clicks Install
 * again", at which point the collision resolver from v1.8 P2 lets
 * them pick Replace (in-place update) or Rename (parallel install).
 *
 * Polling cadence: we only refresh on explicit `check()` calls — the
 * caller (AppLayout / Dashboard mount) decides when. No background
 * timer; the ComfyUI tab might be open for hours in the background
 * and we don't want to hammer the community API for users who never
 * look at it.
 *
 * Bundle posts: when a bundle's latest_version_number drifts, only
 * the bundle row itself is marked — the underlying module rows in
 * the bundle's children list are tracked separately (each child
 * stamps its own community_post_slug at install time, derived from
 * the bundle post's children versions). Future refinement: surface
 * "bundle has updates" as a single rollup instead of N separate
 * child indicators.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { WPC_API_URL } from "../config/links";

/** localStorage key for user-dismissed (slug → version) pairs.
 *  Synced with CommunityUpdateDialog.onDismiss — keep in lockstep. */
const DISMISS_KEY = "wpc.community-update-dismissed";

/**
 * One pending update entry. Keyed by entity id internally so the
 * per-row badge lookup is O(1); the post slug field carries the
 * source-of-truth pointer back to the community post detail.
 */
export interface UpdateEntry {
  entity_id: string;
  entity_kind: "module" | "bundle";
  post_slug: string;
  installed_version: number;
  latest_version: number;
}

interface CommunityPostMeta {
  data: {
    slug: string;
    latest_version_number?: number | null;
  };
}

export const useCommunityUpdateStore = defineStore("communityUpdates", () => {
  /** Updates keyed by entity id. Re-built on every `check()` so a
   *  user upgrading via the collision-resolver Replace path clears
   *  itself on the next refresh. */
  const updatesByEntityId = ref<Map<string, UpdateEntry>>(new Map());
  const checking = ref(false);
  const lastCheckedAt = ref<number | null>(null);

  /**
   * Walk a fresh library snapshot, batch-fetch the unique post
   * slugs, and re-populate `updatesByEntityId`. Modules and bundles
   * both pass through the same flow; callers don't need to dedup the
   * slug set themselves.
   *
   * Network failures (offline, CORS, server down) are swallowed — a
   * broken community origin shouldn't make the SPA unusable. We
   * still clear stale entries so the badge state matches "we could
   * not verify, assume no updates".
   */
  async function check(input: {
    modules: Array<{ id: string; community_post_slug?: string | null; community_version_number?: number | null }>;
    bundles: Array<{ id: string; community_post_slug?: string | null; community_version_number?: number | null }>;
  }): Promise<void> {
    checking.value = true;
    try {
      const candidates: Array<{
        entity_id: string;
        entity_kind: "module" | "bundle";
        post_slug: string;
        installed_version: number;
      }> = [];
      for (const row of input.modules) {
        if (row.community_post_slug && typeof row.community_version_number === "number") {
          candidates.push({
            entity_id: row.id,
            entity_kind: "module",
            post_slug: row.community_post_slug,
            installed_version: row.community_version_number,
          });
        }
      }
      for (const row of input.bundles) {
        if (row.community_post_slug && typeof row.community_version_number === "number") {
          candidates.push({
            entity_id: row.id,
            entity_kind: "bundle",
            post_slug: row.community_post_slug,
            installed_version: row.community_version_number,
          });
        }
      }

      if (candidates.length === 0) {
        updatesByEntityId.value = new Map();
        return;
      }

      // Dedup post slugs — the same post can back multiple entities
      // (a bundle child install stamps each module row with the
      // bundle's slug; sharing the fetched latest_version across
      // rows avoids re-hitting the endpoint).
      const uniqueSlugs = Array.from(new Set(candidates.map((c) => c.post_slug)));
      const latestBySlug = new Map<string, number>();
      // Per-slug fetch — the community has no batch-by-slug endpoint
      // today; using GET /api/v1/posts/{slug} keeps us on the public
      // surface. Cap parallelism by chunk so a 50-entity library
      // doesn't open 50 sockets at once.
      const CHUNK = 8;
      for (let i = 0; i < uniqueSlugs.length; i += CHUNK) {
        const slice = uniqueSlugs.slice(i, i + CHUNK);
        const results = await Promise.allSettled(
          slice.map((slug) =>
            fetch(`${WPC_API_URL}/api/v1/posts/${slug}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((j: CommunityPostMeta | null) => ({ slug, latest: j?.data?.latest_version_number ?? null })),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value && typeof r.value.latest === "number") {
            latestBySlug.set(r.value.slug, r.value.latest);
          }
        }
      }

      // User-dismissed (slug, version) pairs — see
      // CommunityUpdateDialog's onDismiss. Survives reloads; we read
      // it fresh per check so a dismissal in one tab affects the
      // next check in another.
      let dismissedMap: Record<string, number> = {};
      try {
        const raw = window.localStorage.getItem(DISMISS_KEY);
        if (raw) dismissedMap = JSON.parse(raw) as Record<string, number>;
      } catch {
        // localStorage denied / malformed — treat as empty.
      }

      const next = new Map<string, UpdateEntry>();
      for (const c of candidates) {
        const latest = latestBySlug.get(c.post_slug);
        if (typeof latest !== "number" || latest <= c.installed_version) continue;
        // Skip if the user already dismissed this exact post version.
        // A newer version drops past the dismissal (we compare against
        // the dismissed number, not the slug alone).
        if ((dismissedMap[c.post_slug] ?? 0) >= latest) continue;
        next.set(c.entity_id, {
          entity_id: c.entity_id,
          entity_kind: c.entity_kind,
          post_slug: c.post_slug,
          installed_version: c.installed_version,
          latest_version: latest,
        });
      }
      updatesByEntityId.value = next;
      lastCheckedAt.value = Date.now();
    } catch {
      // Defensive: any unexpected error path clears stale entries so
      // we don't render a misleading "v2 available" pill against a
      // post that's been deleted / unreachable.
      updatesByEntityId.value = new Map();
    } finally {
      checking.value = false;
    }
  }

  /** Update entry for a specific entity id, or null when none. */
  function entryFor(entityId: string): UpdateEntry | null {
    return updatesByEntityId.value.get(entityId) ?? null;
  }

  const totalCount = computed<number>(() => updatesByEntityId.value.size);

  return {
    updatesByEntityId,
    checking,
    lastCheckedAt,
    totalCount,
    check,
    entryFor,
  };
});
