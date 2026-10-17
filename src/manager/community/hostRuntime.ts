/**
 * What the Community tab lets the community embed do in this library:
 * install a pack and link a just-published row back to its post. Served to
 * the framed embed over postMessage by `frameBridge.ts`; never put on
 * `window` (any script in the ComfyUI page could call it there).
 *
 * `abi` is a coarse version on this contract (add = no bump; remove or
 * rename = bump). `schemaVersion` advertises MAX_KNOWN (the highest shape
 * this runtime reads + writes), not the migration-chain head; see
 * `migrations.ts` for the CURRENT vs MAX_KNOWN fork.
 */
import { api as managerApi } from "../api/client";
import {
  MAX_KNOWN_SCHEMA_VERSION,
  installEnvelope,
  type CollisionDecision,
  type InstallCollision,
  type InstallOrigin,
  type InstallResult,
  type LibrarySnapshot,
} from "../import-export/install";
import { useBundleStore } from "../stores/bundleStore";
import { useModuleStore } from "../stores/moduleStore";

export interface HostInstallOpts {
  /** Shows the embed's collision modal; null cancels the install. */
  resolveCollisions?: (rows: InstallCollision[]) => Promise<Record<string, CollisionDecision> | null>;
  /** Community post + version stamped on every inserted row. */
  origin?: InstallOrigin;
  /** The post's dependency edges, for install-time reference reattachment. */
  dependencies?: Array<{ module_id?: string; slug: string }>;
}

export interface HostRuntime {
  abi: number;
  schemaVersion: number;
  install(envelope: unknown, opts?: HostInstallOpts): Promise<InstallResult>;
  /** Resolves false (never throws) when the row is gone or the API fails:
   *  the post published fine, only the local link is missing. */
  markPublished(
    localId: string,
    kind: "module" | "bundle",
    postSlug: string,
    versionNumber: number,
  ): Promise<boolean>;
}

/** Fresh per install so a long-lived embed sees library changes in between. */
function snapshotLibrary(): LibrarySnapshot {
  const modules = new Map<string, { id: string; name: string; type?: string; community_post_slug?: string }>();
  for (const m of useModuleStore().catalog) {
    modules.set(m.id, { id: m.id, name: m.name, type: m.type, community_post_slug: m.community_post_slug ?? undefined });
  }
  const bundles = new Map<string, { id: string; name: string; community_post_slug?: string }>();
  for (const b of useBundleStore().catalog) {
    bundles.set(b.id, { id: b.id, name: b.name, community_post_slug: b.community_post_slug ?? undefined });
  }
  return { modules, bundles };
}

export function createHostRuntime(): HostRuntime {
  return {
    abi: 1,
    schemaVersion: MAX_KNOWN_SCHEMA_VERSION,
    install: (envelope, opts) => installEnvelope(
      { envelope },
      {
        importExport: managerApi.importExport,
        library: snapshotLibrary(),
        ...(opts?.resolveCollisions ? { resolveCollisions: opts.resolveCollisions } : {}),
        ...(opts?.origin ? { origin: opts.origin } : {}),
        ...(opts?.dependencies ? { dependencies: opts.dependencies } : {}),
      },
    ),
    async markPublished(localId, kind, postSlug, versionNumber) {
      try {
        const origin = { post_slug: postSlug, version_number: versionNumber };
        if (kind === "bundle") await managerApi.bundles.setCommunityOrigin(localId, origin);
        else await managerApi.modules.setCommunityOrigin(localId, origin);
        // Refresh so the row shows its community pill without a reload.
        await useModuleStore().fetchCatalog();
        await useBundleStore().fetchCatalog();
        return true;
      } catch {
        return false;
      }
    },
  };
}
