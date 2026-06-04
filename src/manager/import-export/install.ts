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
  type Decision,
  type EntityKind,
  type ResolvedCategoryEntity,
  type ResolvedEntity,
  type ResolvedSelection,
} from "./commit";
import { newShortId } from "../utils/ids";

/**
 * Library snapshot used by the install collision pre-check. Modules
 * and bundles are looked up by `id`; the lookup payload is small
 * (just `name`) so the caller can construct the maps cheaply from
 * Pinia stores. Missing entries are taken as "no collision".
 */
export interface LibrarySnapshot {
  modules: Map<string, { id: string; name: string }>;
  bundles: Map<string, { id: string; name: string }>;
}

/**
 * A row in the live library that an incoming entity collides with.
 * Passed to `resolveCollisions` so the UI can render "X already
 * exists" with both names side-by-side.
 */
export interface InstallCollision {
  kind: EntityKind;
  id: string;
  incomingName: string;
  existingName: string;
}

/**
 * Per-entity decision returned from `resolveCollisions`:
 *   - `skip` drops the entity from the commit entirely.
 *   - `replace` overwrites the existing live-DB row with the
 *     incoming payload.
 *   - `rename` mints a fresh id + user-supplied name; the original
 *     library row is untouched and the incoming entity lands beside it.
 */
export type CollisionDecision =
  | { kind: "skip" }
  | { kind: "replace" }
  | { kind: "rename"; new_name: string };

/**
 * Tags every entity inserted in this install with the community post
 * + version it originated from. Stamped onto the row at insert time
 * (engine columns added in migration 013) so the SPA can later show
 * "installed from @author/pack" badges and surface "v2 available"
 * notifications when the post's latest_version_number drifts above
 * the locally-stored version_number.
 */
export interface InstallOrigin {
  post_slug: string;
  version_number: number;
}

export interface InstallOptions {
  /** Used to POST the assembled commit. Defaults to the shared
   *  manager `api` const; tests inject a fake. */
  importExport: ImportExportApi;
  /** Tag every inserted entity with this community origin. Omitted
   *  for non-community installs (Import-tab file pick, starter set,
   *  etc.) so those rows stay NULL on the new columns. */
  origin?: InstallOrigin;
  /**
   * Snapshot of the live library at install time. Provided by the
   * host bridge so installEnvelope can detect collisions client-side
   * before the commit roundtrip. Optional for back-compat — when
   * absent, the function falls through to the original "everything
   * as add" behaviour and the server surfaces conflicts as 4xx.
   */
  library?: LibrarySnapshot;
  /**
   * Resolver callback invoked when client-side collision detection
   * finds duplicates. Receives one row per conflict; returns a map
   * keyed by id with the user's per-row decision. Returning `null`
   * (or an empty map) cancels the install. Required for the conflict
   * UX to fire; when absent we skip the pre-check entirely and let
   * the server reject as before.
   */
  resolveCollisions?: (
    rows: InstallCollision[],
  ) => Promise<Record<string, CollisionDecision> | null>;
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
 * Stamp every entity in a `RawPayload` bucket with a ``decision: "add"``
 * wrapper so it can flow through ``buildCommitPayload``.
 *
 * Community uploads are engine-row shaped (top-level ``name`` /
 * ``type``, type-specific fields nested under ``payload``) — the same
 * format the runtime's exporter produces. The community web side is
 * the transport layer, not the schema authority; if a payload lands
 * here without ``name`` it's the engine importer's job to reject,
 * not ours to silently patch. Lifting ``meta.name`` here used to
 * mask shape drift, which papered over the seed bug rather than
 * forcing the seed to mirror reality.
 */
function wrapAdds(
  rows: Array<Record<string, unknown>>,
): ResolvedEntity[] {
  return rows
    .filter((r): r is Record<string, unknown> & { id: string } =>
      typeof r === "object" && r !== null && typeof (r as { id?: unknown }).id === "string",
    )
    .map((entity) => ({ entity, decision: { kind: "add" as const } }));
}

function wrapCategoryAdds(
  rows: Array<Record<string, unknown>>,
): ResolvedCategoryEntity[] {
  return rows
    .filter((r): r is Record<string, unknown> & { id: string } =>
      typeof r === "object" && r !== null && typeof (r as { id?: unknown }).id === "string",
    )
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
 * The five module subtypes share one table on the server, so an id
 * collision is detected against a single map. Bundles use their own
 * map. Categories merge by name server-side — no client-side collision
 * concept — so they never appear here.
 */
const MODULE_BUCKETS: Array<keyof Omit<ResolvedSelection, "categories" | "bundles" | "templates">> = [
  "wildcards",
  "fixed_values",
  "combines",
  "derivations",
  "constraints",
];

const BUCKET_TO_KIND: Record<string, EntityKind> = {
  bundles: "bundle",
  wildcards: "wildcard",
  fixed_values: "fixed_values",
  combines: "combine",
  derivations: "derivation",
  constraints: "constraint",
  templates: "template",
};

/**
 * Walk the resolved selection and surface every id that already
 * exists in the live library. Modules + bundles only; categories and
 * templates have their own merge semantics handled elsewhere. The
 * incoming `name` is the raw payload field, falling back to the id
 * if a row arrived nameless (which the engine validator would reject
 * anyway — but defensively we don't want the modal to render
 * "undefined").
 */
function detectInstallCollisions(
  selection: ResolvedSelection,
  library: LibrarySnapshot,
): InstallCollision[] {
  const out: InstallCollision[] = [];
  for (const bucket of MODULE_BUCKETS) {
    for (const row of selection[bucket]) {
      const existing = library.modules.get(row.entity.id);
      if (existing) {
        out.push({
          kind: BUCKET_TO_KIND[bucket as string]!,
          id: row.entity.id,
          incomingName: String(row.entity.name ?? row.entity.id),
          existingName: existing.name,
        });
      }
    }
  }
  for (const row of selection.bundles) {
    const existing = library.bundles.get(row.entity.id);
    if (existing) {
      out.push({
        kind: "bundle",
        id: row.entity.id,
        incomingName: String(row.entity.name ?? row.entity.id),
        existingName: existing.name,
      });
    }
  }
  return out;
}

/**
 * Mutate `selection` in place, applying the user's per-id decision
 * to every matching entity row. Skip → drop the row. Replace →
 * change the decision wrapper. Rename → mint a fresh id, swap the
 * entity's id field, set the rename decision carrying the new id +
 * user-supplied new name.
 */
function applyCollisionDecisions(
  selection: ResolvedSelection,
  decisions: Record<string, CollisionDecision>,
): void {
  const buckets: Array<keyof Omit<ResolvedSelection, "categories">> = [
    "bundles",
    ...MODULE_BUCKETS,
    "templates",
  ];
  for (const bucket of buckets) {
    const rows = selection[bucket];
    const next: ResolvedEntity[] = [];
    for (const row of rows) {
      const d = decisions[row.entity.id];
      if (!d) {
        // No decision recorded — entity wasn't a collision, keep as `add`.
        next.push(row);
        continue;
      }
      if (d.kind === "skip") {
        continue;
      }
      if (d.kind === "replace") {
        next.push({ entity: row.entity, decision: { kind: "replace" } as Decision });
        continue;
      }
      // Rename: mint a new id, rewrite the entity's id field, and
      // emit a `rename` decision carrying old_id + new_id + new_name.
      const newId = newShortId();
      const renamedEntity: Record<string, unknown> & { id: string } = {
        ...row.entity,
        id: newId,
      };
      next.push({
        entity: renamedEntity,
        decision: { kind: "rename" as const, new_id: newId, new_name: d.new_name },
      });
    }
    // Re-assign to preserve the typed shape (the buckets above all
    // resolve to ResolvedEntity[] in their declared types). The
    // ResolvedSelection's `categories` field is a different row type
    // but the `buckets` array above excludes it, so the cast is sound.
    (selection as unknown as Record<string, ResolvedEntity[]>)[bucket] = next;
  }
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

  // Stamp community origin onto every module + bundle entity going
  // in. The engine's _insert_module / _insert_bundle paths pick these
  // fields off the entity dict and write them to the new
  // community_post_slug / community_version_number columns (migration
  // 013). Origin-less installs (Import tab, starter set) leave the
  // columns NULL.
  if (opts.origin) {
    for (const bucket of [...MODULE_BUCKETS, "bundles"] as const) {
      for (const row of selection[bucket]) {
        row.entity.community_post_slug = opts.origin.post_slug;
        row.entity.community_version_number = opts.origin.version_number;
      }
    }
  }

  // Client-side collision pre-check. Only fires when both a library
  // snapshot and a resolveCollisions callback are wired — otherwise
  // we fall through and let the server's commit endpoint surface the
  // conflict as a 4xx, preserving the original behaviour for callers
  // that haven't opted in to the new UX.
  if (opts.library && opts.resolveCollisions) {
    const collisions = detectInstallCollisions(selection, opts.library);
    if (collisions.length > 0) {
      const decisions = await opts.resolveCollisions(collisions);
      if (!decisions || Object.keys(decisions).length === 0) {
        return {
          ok: false,
          installed: { ...EMPTY_COUNTS },
          warnings: parsed.integrityWarnings,
          migratedEntityCount: parsed.migratedEntityCount,
          error: { code: "cancelled", message: "Install cancelled by user." },
        };
      }
      applyCollisionDecisions(selection, decisions);
    }
  }

  const commitPayload = buildCommitPayload(selection);

  // Pre-compute counts off the commit payload so the caller sees
  // exactly what the server is about to write. `installed` covers
  // adds + renames + replaces — every entity that actually lands.
  const installed = countBucket([
    ...commitPayload.adds,
    ...commitPayload.renames.map((r) => ({ kind: r.kind })),
    ...commitPayload.replaces.map((r) => ({ kind: r.kind })),
  ]);

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
