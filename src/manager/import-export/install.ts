/**
 * One-shot install pipeline for community-side payloads.
 *
 * The full Import tab walks: file pick → parsePayload (JSON shape +
 * migrations + integrity verify) → ImportPicker (per-entity decisions +
 * collision detection) → buildCommitPayload → POST /import/commit.
 *
 * The community embed needs the same guarantees (schema migration,
 * integrity warnings, atomic write) but skips the picker — the user
 * already saw the post detail page and clicked Install. Everything in
 * the envelope goes in as `add`. The server collision detector will
 * surface duplicates as a 4xx with a structured error; a future
 * iteration can prompt for replace/rename via the same dialog the
 * Import tab uses today, but v1 fails loudly so users see the conflict
 * instead of silently overwriting their own work.
 *
 * Exposed globally as `window.__wpcRuntime.install` (see manager
 * bootstrap) so the community embed bundle — loaded into the same
 * document via dynamic import — can call into this pipeline directly
 * without re-implementing migrations or duplicating the commit shape.
 */

import { api } from "../api/client";

/** Pull the importExport bucket off the live `api` const — there's no
 *  exported ApiClient type, so we widen via `typeof` and pluck the
 *  one bucket we need. Tests inject a fake of this shape. */
type ImportExportApi = (typeof api)["importExport"];
import { CURRENT_SCHEMA_VERSION, type RawPayload } from "./migrations";
import { parsePayload, type IntegrityWarning } from "./parse";
import {
  buildCommitPayload,
  type CommitOk,
  type EntityKind,
  type ResolvedCategoryEntity,
  type ResolvedEntity,
  type ResolvedSelection,
} from "./commit";

export interface InstallOptions {
  /** Used to POST the assembled commit. Defaults to the shared
   *  manager `api` const; tests inject a fake. */
  importExport: ImportExportApi;
}

export interface InstallResult {
  ok: boolean;
  /** Per-bucket counts of entities that landed in `adds`. Mirrors the
   *  shape the picker would have produced if the user had clicked
   *  Add on everything. */
  installed: Record<EntityKind, number>;
  /** Integrity warnings surfaced by ``parsePayload``. Display these
   *  alongside the success state — they aren't blocking but they
   *  signal authoring drift (missing var refs, orphan branches, etc.). */
  warnings: IntegrityWarning[];
  /** Number of entities that got walked through a migration step on
   *  the way to ``CURRENT_SCHEMA_VERSION``. > 0 means the pack was
   *  authored against an older schema and got migrated on parse. */
  migratedEntityCount: number;
  /** Set when the server's commit succeeded. Undo + summary live here. */
  commit?: CommitOk;
  /** Set when something failed (parse, schema mismatch, server). One
   *  of ``commit`` / ``error`` is always populated. */
  error?: { code: string; message: string };
}

const EMPTY_COUNTS: Record<EntityKind, number> = {
  bundle: 0,
  wildcard: 0,
  fixed_values: 0,
  combine: 0,
  derivation: 0,
  constraint: 0,
  category: 0,
  template: 0,
};

function countBucket(rows: Array<{ kind: EntityKind }>): Record<EntityKind, number> {
  const out: Record<EntityKind, number> = { ...EMPTY_COUNTS };
  for (const row of rows) out[row.kind] += 1;
  return out;
}

/**
 * Engine importer commits expect every entity to carry top-level
 * `name`. Engine EXPORTS (and therefore community uploads round-
 * tripped through the export envelope) park the name on `meta.name`
 * instead — the on-disk wire shape and the importer's required-fields
 * shape differ by one nesting level. Lift `meta.name` to the top so
 * the commit doesn't fail with "missing required field(s): ['name']".
 *
 * Idempotent: if `entity.name` is already a string, leave it. If both
 * are missing, fall back to the entity's short id so the commit gets
 * a non-empty value — the user can rename inside the runtime after.
 */
function normalizeEntity(
  raw: Record<string, unknown>,
): Record<string, unknown> & { id: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string") return null;

  const out = { ...raw } as Record<string, unknown> & { id: string };
  if (typeof out.name !== "string" || !out.name.length) {
    const meta = (raw as { meta?: unknown }).meta;
    const metaName =
      meta && typeof meta === "object"
        ? (meta as Record<string, unknown>).name
        : undefined;
    out.name =
      typeof metaName === "string" && metaName.length
        ? metaName
        : id.slice(0, 8);
  }
  return out;
}

/**
 * Stamp every entity in a `RawPayload` bucket with a ``decision: "add"``
 * wrapper so it can flow through ``buildCommitPayload``. The runtime
 * id stays untouched — collision detection happens server-side, and
 * the embed lets the user choose how to resolve via a future picker
 * prompt rather than silently renaming here.
 */
function wrapAdds(
  rows: Array<Record<string, unknown>>,
): ResolvedEntity[] {
  return rows
    .map(normalizeEntity)
    .filter((r): r is Record<string, unknown> & { id: string } => r !== null)
    .map((entity) => ({ entity, decision: { kind: "add" as const } }));
}

function wrapCategoryAdds(
  rows: Array<Record<string, unknown>>,
): ResolvedCategoryEntity[] {
  return rows
    .map(normalizeEntity)
    .filter((r): r is Record<string, unknown> & { id: string } => r !== null)
    .map((entity) => ({ entity, decision: { kind: "add" as const } }));
}

function buildSelection(payload: RawPayload): ResolvedSelection {
  return {
    bundles:      wrapAdds(payload.bundles),
    wildcards:    wrapAdds(payload.wildcards),
    fixed_values: wrapAdds(payload.fixed_values),
    combines:     wrapAdds(payload.combines),
    derivations:  wrapAdds(payload.derivations),
    constraints:  wrapAdds(payload.constraints),
    categories:   wrapCategoryAdds(payload.categories),
    templates:    wrapAdds(payload.templates ?? []),
  };
}

/**
 * Install a fully-validated community payload into the live library.
 *
 * Pipeline:
 *   1. ``parsePayload`` re-runs schema validation + migration chain +
 *      integrity check. Same guard the Import tab uses.
 *   2. Convert every entity into an ``add`` decision (no picker;
 *      server collision detection surfaces dupes).
 *   3. ``buildCommitPayload`` → POST ``/import/commit``.
 *   4. Aggregate counts + warnings into a single ``InstallResult``
 *      the caller can render.
 *
 * Accepts either a JSON string (`raw`) or an already-parsed envelope
 * shape (`envelope`). The embed passes the in-memory envelope
 * directly to skip a JSON.stringify → parse round-trip; the Import
 * tab passes raw text. ``parsePayload`` always takes a string, so
 * envelope input gets re-stringified at the boundary.
 */
export async function installEnvelope(
  input: { raw: string } | { envelope: unknown },
  opts: InstallOptions,
): Promise<InstallResult> {
  const raw = "raw" in input ? input.raw : JSON.stringify(input.envelope);
  const parsed = parsePayload(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      installed: { ...EMPTY_COUNTS },
      warnings: [],
      migratedEntityCount: 0,
      error: { code: "parse_failed", message: parsed.reason },
    };
  }

  const selection = buildSelection(parsed.payload);
  const commitPayload = buildCommitPayload(selection);

  // Pre-compute counts off the commit payload so the caller sees
  // exactly what the server is about to write.
  const installed = countBucket(commitPayload.adds);

  try {
    const result = await opts.importExport.commit(commitPayload);
    return {
      ok: true,
      installed,
      warnings: parsed.integrityWarnings,
      migratedEntityCount: parsed.migratedEntityCount,
      commit: result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      installed: { ...EMPTY_COUNTS },
      warnings: parsed.integrityWarnings,
      migratedEntityCount: parsed.migratedEntityCount,
      error: { code: "commit_failed", message },
    };
  }
}

/** Re-exported so the host-bridge global can advertise the runtime's
 *  current schema number alongside the install function. */
export { CURRENT_SCHEMA_VERSION };
