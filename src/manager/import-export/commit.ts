/**
 * Build a commit payload from picker resolution state.
 *
 * The picker classifies every entity in the imported payload into one of
 * three decisions: ``add`` (no live-DB row at this id), ``replace``
 * (overwrite the live-DB row at this id with new content), or ``rename``
 * (insert under a fresh id, leaving the live-DB row untouched). This
 * module is the pure-function partitioner: it walks the seven entity
 * buckets and emits the three-bucket ``CommitPayload`` shape the server
 * accepts at ``POST /wp/api/import/commit``.
 *
 * Field naming mirrors the Python engine exactly: rows are keyed by
 * ``id`` (not ``uuid``), and renames carry ``old_id`` + ``new_id``. The
 * source ``entity`` records may also carry ``uuid`` in the wild — the
 * partitioner does not touch fields it doesn't recognise; the server
 * insert path reads ``id`` regardless.
 *
 * Categories only ever appear in ``adds``. The server merges by name
 * (case-insensitive); there's no concept of replacing or renaming a
 * category through this pipeline, so the type system encodes that
 * constraint at the picker boundary — see ``CategoryDecision``.
 */

/**
 * Entity bucket discriminator. Exactly mirrors the seven server-side
 * kind strings recognised by ``engine.importer.commit_import``. The
 * first five route to the ``modules`` table (discriminated further by
 * the row's ``type`` column); ``bundle`` routes to ``bundles``;
 * ``category`` routes to ``module_categories``.
 */
export type EntityKind =
  | "bundle"
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint"
  | "category"
  | "template";

/**
 * Picker decision per entity. ``rename`` carries the freshly-allocated
 * id and the user-edited name so the partitioner can stamp them onto
 * the outgoing ``content`` blob. The name field is mandatory because
 * the rename flow is always paired with a "(imported)" suffix or other
 * user-visible rename — sending the original name through a rename
 * would be a UX bug.
 */
export type Decision =
  | { kind: "add" }
  | { kind: "replace" }
  | { kind: "rename"; new_id: string; new_name: string };

/**
 * Category decisions are a strict subset of ``Decision``: only ``add``
 * is valid. The server treats categories as a name-merge bucket — there
 * is no "replace this category row" or "rename this category to a new
 * id" semantic, because the SPA dedup logic happens upstream by name.
 *
 * Encoding this at the type level means a picker that wires the wrong
 * decision into a category will fail at compile time, not at the 400
 * the server would otherwise emit.
 */
export type CategoryDecision = { kind: "add" };

/**
 * Picker output row for the five module kinds + bundles. ``entity`` is
 * the full row payload (matching the corresponding server insert shape
 * from ``engine/importer.py``); ``decision`` is the user-chosen action.
 */
export interface ResolvedEntity {
  entity: Record<string, unknown> & { id: string };
  decision: Decision;
}

/**
 * Category-restricted variant of ``ResolvedEntity``. The ``decision``
 * union here is narrowed to ``CategoryDecision`` so attempting to
 * partition a category as replace/rename fails at the type level.
 */
export interface ResolvedCategoryEntity {
  entity: Record<string, unknown> & { id: string };
  decision: CategoryDecision;
}

/**
 * Aggregate picker output. Every bucket maps 1:1 to a server bucket;
 * an empty array means "user chose nothing of this kind". The category
 * bucket uses the stricter row type so the discriminated-union
 * constraint flows through to ``buildCommitPayload``.
 */
export interface ResolvedSelection {
  bundles: ResolvedEntity[];
  wildcards: ResolvedEntity[];
  fixed_values: ResolvedEntity[];
  combines: ResolvedEntity[];
  derivations: ResolvedEntity[];
  constraints: ResolvedEntity[];
  categories: ResolvedCategoryEntity[];
  templates: ResolvedEntity[];
}

/**
 * Server-facing commit payload. The shape is byte-for-byte the body
 * accepted by ``POST /wp/api/import/commit``:
 *
 *   - ``adds[i].entity`` carries ``id`` plus the full row dict.
 *   - ``replaces[i]`` carries the live-DB ``id`` to overwrite plus the
 *     ``new_content`` to overwrite with.
 *   - ``renames[i]`` carries ``old_id`` (original id from the imported
 *     payload, retained for telemetry / undo), ``new_id`` (freshly
 *     allocated id to insert under), and ``content`` (the full row dict
 *     with ``id`` already rewritten to ``new_id``).
 */
export interface CommitPayload {
  adds: Array<{ kind: EntityKind; entity: Record<string, unknown> }>;
  replaces: Array<{ kind: EntityKind; id: string; new_content: Record<string, unknown> }>;
  renames: Array<{
    kind: EntityKind;
    old_id: string;
    new_id: string;
    content: Record<string, unknown>;
  }>;
}

/**
 * Success envelope from the commit endpoint. ``undo_entry_id`` is the
 * 16-hex token the SPA stashes on the manager undo stack so a user can
 * reverse the commit via ``POST /wp/api/import/undo``.
 */
export interface CommitOk {
  ok: true;
  undo_entry_id: string;
  summary?: Record<string, number>;
}

/**
 * Walk one bucket of resolved entities and append each row to the
 * matching slot in ``out``. The function is intentionally
 * type-flexible on the input ``list`` so the category bucket (with its
 * narrower ``ResolvedCategoryEntity`` rows) can flow through the same
 * partitioner — TypeScript still rejects replace/rename decisions for
 * categories at the call site because the union is narrowed there.
 *
 * Rename path: the partitioner clones ``entity``, stamps
 * ``id = new_id`` and ``name = new_name`` onto the clone, and strips
 * the server-stamped lifecycle fields (``created_at``, ``updated_at``,
 * ``version``, ``snapshot_fingerprint``, ``payload_hash``). The server's
 * insert paths (``_insert_module`` / ``_insert_bundle`` in
 * ``engine/importer.py``) treat missing fields as "default to now() /
 * recompute" but copy client-supplied values verbatim — so leaving the
 * source-DB values in would land an imported row with a stale
 * ``created_at`` (breaking newest-first sort) and a stale fingerprint
 * keyed against the wrong id. The ``replace`` branch is unaffected:
 * ``_update_module`` always bumps ``version`` and stamps
 * ``updated_at = now()`` regardless of client input. The ``add`` branch
 * preserves identity by design — the user explicitly opted to insert
 * under the original id.
 */
/**
 * Server-stamped lifecycle fields. Stripping them makes the engine importer's
 * insert paths (`_insert_module` / `_insert_bundle`) fall back to `now()` for
 * the dates and recompute the fingerprint, instead of copying the SOURCE
 * library's values verbatim (`entity.get("created_at", now)` etc.). The
 * server recomputes the fingerprint on insert regardless, so stripping those
 * is a no-op there — but stripping the dates is what makes an imported row
 * read as freshly added.
 */
const LIFECYCLE_FIELDS = [
  "created_at",
  "updated_at",
  "version",
  "snapshot_fingerprint",
  "payload_hash",
  "template_fingerprint",
] as const;

function stripLifecycle(
  entity: Record<string, unknown> & { id: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...entity };
  for (const f of LIFECYCLE_FIELDS) delete out[f];
  return out;
}

function partition(
  kind: EntityKind,
  list: ReadonlyArray<{ entity: Record<string, unknown> & { id: string }; decision: Decision }>,
  out: CommitPayload,
): void {
  for (const r of list) {
    switch (r.decision.kind) {
      case "add":
        // Strip lifecycle fields so the server stamps a fresh created_at:
        // an imported entity must read as "just added to your library", not
        // carry the exporter's original date (which made imports sort as
        // weeks-old — bug #12). Identity (`id`) is preserved by design.
        out.adds.push({ kind, entity: stripLifecycle(r.entity) });
        break;
      case "replace":
        // Replace overwrites an EXISTING library row; the server's
        // `_update_module` never touches `created_at` and always stamps
        // `updated_at = now()`, so the live row keeps its own dates.
        out.replaces.push({ kind, id: r.entity.id, new_content: r.entity });
        break;
      case "rename": {
        const newContent = stripLifecycle(r.entity);
        newContent.id = r.decision.new_id;
        newContent.name = r.decision.new_name;
        out.renames.push({
          kind,
          old_id: r.entity.id,
          new_id: r.decision.new_id,
          content: newContent,
        });
        break;
      }
    }
  }
}

/**
 * Partition a ``ResolvedSelection`` into the three-bucket ``CommitPayload``
 * shape the server accepts.
 *
 * The category bucket is processed last and only emits to ``adds`` —
 * the ``CategoryDecision`` constraint guarantees no replace/rename
 * decisions can reach this code path. As defense-in-depth, we still
 * dispatch on ``decision.kind`` so a future broadening of the type
 * does not silently break the contract.
 */
export function buildCommitPayload(selection: ResolvedSelection): CommitPayload {
  const out: CommitPayload = { adds: [], replaces: [], renames: [] };
  partition("bundle", selection.bundles, out);
  partition("wildcard", selection.wildcards, out);
  partition("fixed_values", selection.fixed_values, out);
  partition("combine", selection.combines, out);
  partition("derivation", selection.derivations, out);
  partition("constraint", selection.constraints, out);
  // Templates support all three decisions (add / replace / rename), same
  // as the five module kinds — the server's `template` kind handler in
  // engine/importer.py mirrors the module insert/update/rename paths.
  partition("template", selection.templates, out);
  // Categories: only "add" is valid (enforced by CategoryDecision).
  // Fail loudly if a non-add decision is smuggled past the type system —
  // silently dropping it would mask a real bug at the picker boundary
  // and the user would see "I clicked replace/rename and nothing
  // happened" with no diagnostic trail.
  for (const r of selection.categories) {
    if (r.decision.kind !== "add") {
      throw new Error(
        `category bucket received non-add decision: ${r.decision.kind} ` +
          `(programmer error — CategoryDecision is narrowed to "add" only)`,
      );
    }
    out.adds.push({ kind: "category", entity: r.entity });
  }
  return out;
}
