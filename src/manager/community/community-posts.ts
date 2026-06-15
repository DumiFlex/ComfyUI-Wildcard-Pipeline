/**
 * Manager-side reads of the PUBLIC community post API (Feature 2 download).
 *
 * The community detail + download endpoints are unauthenticated (same ones
 * `CommunityUpdateDialog` already hits), so these are plain `fetch` calls —
 * `fetch` is injected so tests run without network. Used by the
 * download-and-reattach orchestrator to learn a constraint's dependency
 * edges + pull a dep's payload.
 */
import { WPC_API_URL } from "../config/links";

export interface CommunityDepEdge {
  slug: string;
  module_id?: string;
  name?: string;
}
export interface CommunityPostDetail {
  slug: string;
  latest_version_number: number | null;
  dependencies: CommunityDepEdge[];
}
export interface CommunityDownload {
  payload: Record<string, unknown>;
  version_number: number;
}

/** An `Error` that also carries the HTTP status that produced it, so callers
 *  (e.g. `communityPostExists`) can distinguish a definite not-found (404/410)
 *  from a transient failure (5xx) without re-parsing the message string. */
export interface HttpError extends Error {
  status: number;
}

export async function fetchCommunityPostDetail(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<CommunityPostDetail> {
  const r = await fetchFn(`${WPC_API_URL}/api/v1/posts/${slug}`);
  if (!r.ok) {
    const err = new Error(`community post ${slug}: HTTP ${r.status}`) as HttpError;
    err.status = r.status;
    throw err;
  }
  const j = (await r.json()) as { data?: { slug?: string; latest_version_number?: number | null; dependencies?: CommunityDepEdge[] } };
  const d = j.data ?? {};
  return {
    slug: typeof d.slug === "string" ? d.slug : slug,
    latest_version_number: d.latest_version_number ?? null,
    dependencies: Array.isArray(d.dependencies) ? d.dependencies : [],
  };
}

/**
 * Does the community post `slug` still exist? Used by the guided-publish gate
 * to re-verify an auto-detected "published" dependency before treating it as
 * met: a dep whose community post was DELETED still carries a local
 * `community_post_slug`, so without this check it would slip past the gate and
 * dead-end at the publish form ("not found, can't publish").
 *
 * Returns:
 *   - `true`  on a 200 (the post exists).
 *   - `false` ONLY on a DEFINITE not-found — HTTP 404 (never existed / hard
 *     deleted) or 410 (gone / soft-deleted-then-purged). These are the two
 *     statuses that justify reclassifying a "published" dep as unmet.
 *   - `true`  on ANY OTHER failure (5xx, network error, timeout). A transient
 *     blip must NOT reclassify a real, still-published dependency — that would
 *     wrongly force the user to re-publish a dep that's actually fine. We err
 *     toward "exists" so the gate stays conservative: it only ever DOWNGRADES a
 *     met dep to unmet when the community definitively says the post is gone.
 *
 * `fetchFn` is injected (default global `fetch`) so tests run without network,
 * mirroring `fetchCommunityPostDetail`.
 */
export async function communityPostExists(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    await fetchCommunityPostDetail(slug, fetchFn);
    return true;
  } catch (e) {
    const status = (e as Partial<HttpError>)?.status;
    if (status === 404 || status === 410) return false;
    // Transient (5xx) or a thrown fetch with no status → treat as still-present.
    return true;
  }
}

export async function downloadCommunityVersion(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<CommunityDownload> {
  const r = await fetchFn(`${WPC_API_URL}/api/v1/posts/${slug}/download`);
  if (!r.ok) throw new Error(`community download ${slug}: HTTP ${r.status}`);
  const j = (await r.json()) as { data?: { payload_json?: Record<string, unknown>; version_number?: number } };
  const d = j.data ?? {};
  return {
    payload: (d.payload_json ?? {}) as Record<string, unknown>,
    version_number: typeof d.version_number === "number" ? d.version_number : 0,
  };
}
