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

export async function fetchCommunityPostDetail(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<CommunityPostDetail> {
  const r = await fetchFn(`${WPC_API_URL}/api/v1/posts/${slug}`);
  if (!r.ok) throw new Error(`community post ${slug}: HTTP ${r.status}`);
  const j = (await r.json()) as { data?: { slug?: string; latest_version_number?: number | null; dependencies?: CommunityDepEdge[] } };
  const d = j.data ?? {};
  return {
    slug: typeof d.slug === "string" ? d.slug : slug,
    latest_version_number: d.latest_version_number ?? null,
    dependencies: Array.isArray(d.dependencies) ? d.dependencies : [],
  };
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
