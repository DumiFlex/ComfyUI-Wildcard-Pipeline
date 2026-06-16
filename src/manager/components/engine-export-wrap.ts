/**
 * Engine-export envelope wrapper — sister-side mirror of
 * `web/src/api/engine-export.ts` in the community repo.
 *
 * Used by CommunityUpdateDialog's "Install as new entry" path: the
 * community API ships each post as a single entity payload, but
 * installEnvelope expects the canonical multi-bucket envelope (the
 * shape the Export tab produces). We wrap the single payload into
 * the right bucket before handing it off.
 *
 * Why a separate copy instead of importing the community one: this
 * file ships in the sister extension's manager bundle and runs
 * without any network reach back to the community web build. Pinning
 * `schema_version` here means a sister vendored at a different
 * version still has a known schema target rather than picking up
 * whatever the live community deploys.
 */

export const ENGINE_SCHEMA_VERSION = 1;

type Bucket =
  | "bundles"
  | "wildcards"
  | "fixed_values"
  | "combines"
  | "derivations"
  | "constraints";

export interface EngineExportEnvelope {
  schema_version: number;
  exported_at: string;
  bundles: Array<Record<string, unknown>>;
  wildcards: Array<Record<string, unknown>>;
  fixed_values: Array<Record<string, unknown>>;
  combines: Array<Record<string, unknown>>;
  derivations: Array<Record<string, unknown>>;
  constraints: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
}

function bucketOf(kind: "module" | "bundle", subtype: string | null): Bucket {
  if (kind === "bundle") return "bundles";
  switch (subtype) {
    case "wildcard": return "wildcards";
    case "fixed_values": return "fixed_values";
    case "combine": return "combines";
    case "derivation": return "derivations";
    case "constraint": return "constraints";
    default: return "wildcards";
  }
}

/**
 * Wrap a single payload into a runtime-import-ready envelope.
 *
 * IMPORTANT note about `new Date()`: this is called only when the
 * user explicitly clicks "Install as new entry" — interactive flow,
 * fine to stamp with wall-clock time. The Workflow runner ban on
 * `new Date()` (it breaks resume) doesn't apply here.
 */
export function wrapAsEngineExport(args: {
  kind: "module" | "bundle";
  subtype: string | null;
  payload: Record<string, unknown>;
}): EngineExportEnvelope {
  const envelope: EngineExportEnvelope = {
    schema_version: ENGINE_SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
    templates: [],
  };
  envelope[bucketOf(args.kind, args.subtype)].push(args.payload);
  return envelope;
}
