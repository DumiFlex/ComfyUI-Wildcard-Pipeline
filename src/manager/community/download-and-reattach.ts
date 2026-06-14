/**
 * Feature 2 orchestrator: download a constraint's missing dependency (and its
 * transitive closure) from the community, then install each.
 *
 * Reattach falls out of local resolution: `installEnvelope` preserves
 * publisher ids, so a downloaded dep lands at exactly the uuid the dangling
 * constraint references — once it's local, the reference resolves. (A
 * collision-rename tail is handled by the UI caller re-checking + applying the
 * manual reattach remap.) Each dep is installed WITH its own dependency edges
 * so Feature 1 auto-reattaches the dep's internal refs too.
 *
 * Fetch + install are injected (no direct network/DB imports) so this is
 * unit-testable; the UI caller passes the real `fetchCommunityPostDetail`,
 * `downloadCommunityVersion`, and an install closure over `installEnvelope`.
 */
import { collectTransitiveDeps } from "./transitive-deps";
import type { CommunityDepEdge, CommunityPostDetail, CommunityDownload } from "./community-posts";
import type { InstallDependencyEdge } from "../import-export/reattach";

export interface DownloadDepsArgs {
  /** The dangling wildcard uuid the constraint references. */
  danglingUuid: string;
  /** The constraint's OWN post dependency edges (module_id + slug). */
  constraintDeps: CommunityDepEdge[];
  fetchDetail: (slug: string) => Promise<CommunityPostDetail>;
  download: (slug: string) => Promise<CommunityDownload>;
  /** Install ONE downloaded post. Wraps the UI's installEnvelope closure. */
  install: (envelope: unknown, deps: InstallDependencyEdge[]) => Promise<{ ok: boolean; error?: { message: string } }>;
  maxPosts?: number;
}

export interface DownloadDepsResult {
  ok: boolean;
  /** The dep post slug that provides the dangling uuid, or null if none does. */
  providerSlug: string | null;
  /** Slugs actually downloaded + installed, in closure order. */
  pulled: string[];
  capped: boolean;
  error?: string;
}

/** Group ONE engine-row module payload into the install envelope shape
 *  (mirror of Feature 4's buildExtractEnvelope / install.test.ts RawPayload). */
function envelopeFor(payload: Record<string, unknown>): unknown {
  const type = typeof payload.type === "string" ? payload.type : "";
  const bucket: Record<string, string> = {
    wildcard: "wildcards", fixed_values: "fixed_values", combine: "combines",
    derivation: "derivations", constraint: "constraints",
  };
  const buckets: Record<string, unknown[]> = {
    bundles: [], wildcards: [], fixed_values: [], combines: [],
    derivations: [], constraints: [], categories: [], templates: [],
  };
  const key = bucket[type];
  if (key) buckets[key].push(payload);
  else if (typeof payload.children !== "undefined") buckets.bundles.push(payload);
  return { schema_version: 4, ...buckets };
}

export async function downloadDepsForDangling(
  args: DownloadDepsArgs,
): Promise<DownloadDepsResult> {
  const provider = args.constraintDeps.find(
    (d) => d.module_id === args.danglingUuid && typeof d.slug === "string" && d.slug,
  );
  if (!provider) {
    return { ok: false, providerSlug: null, pulled: [], capped: false };
  }

  const { slugs, capped } = await collectTransitiveDeps(
    [provider.slug],
    async (slug) => (await args.fetchDetail(slug)).dependencies.map((e) => e.slug).filter(Boolean),
    { maxPosts: args.maxPosts },
  );

  const pulled: string[] = [];
  for (const slug of slugs) {
    let dl: CommunityDownload;
    let detail: CommunityPostDetail;
    try {
      [dl, detail] = await Promise.all([args.download(slug), args.fetchDetail(slug)]);
    } catch (err) {
      return { ok: false, providerSlug: provider.slug, pulled, capped,
        error: err instanceof Error ? err.message : String(err) };
    }
    const deps: InstallDependencyEdge[] = detail.dependencies
      .filter((e) => typeof e.module_id === "string" && e.module_id)
      .map((e) => ({ module_id: e.module_id, slug: e.slug }));
    const res = await args.install(envelopeFor(dl.payload), deps);
    if (!res.ok) {
      return { ok: false, providerSlug: provider.slug, pulled, capped,
        error: res.error?.message ?? `install failed for ${slug}` };
    }
    pulled.push(slug);
  }

  return { ok: true, providerSlug: provider.slug, pulled, capped };
}
