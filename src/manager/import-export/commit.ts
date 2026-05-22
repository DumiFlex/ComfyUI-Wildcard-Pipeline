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
  | "category";

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
 * Failure envelope — kept exported for callers that prefer to switch on
 * a discriminated union rather than catch ``ApiError``. The default
 * code path uses exception-based error handling via the shared
 * ``request<T>`` helper in ``api/client.ts``, so ``CommitFail`` only
 * shows up on consumers that explicitly unwrap an ``ApiError``.
 */
export interface CommitFail {
  ok: false;
  error: string;
}

/**
 * Walk one bucket of resolved entities and append each row to the
 * matching slot in ``out``. The function is intentionally
 * type-flexible on the input ``list`` so the category bucket (with its
 * narrower ``ResolvedCategoryEntity`` rows) can flow through the same
 * partitioner — TypeScript still rejects replace/rename decisions for
 * categories at the call site because the union is narrowed there.
 *
 * Rename path: the partitioner clones ``entity`` and stamps
 * ``id = new_id`` and ``name = new_name`` onto the clone. This matches
 * what the server expects in ``rename.content`` — the row is inserted
 * under ``new_id`` regardless of whatever ``id`` lived in the original
 * payload, but the engine still reads ``content.name`` for the row's
 * display name so we have to overwrite both fields together.
 */
function partition(
  kind: EntityKind,
  list: ReadonlyArray<{ entity: Record<string, unknown> & { id: string }; decision: Decision }>,
  out: CommitPayload,
): void {
  for (const r of list) {
    switch (r.decision.kind) {
      case "add":
        out.adds.push({ kind, entity: r.entity });
        break;
      case "replace":
        out.replaces.push({ kind, id: r.entity.id, new_content: r.entity });
        break;
      case "rename": {
        const newContent = {
          ...r.entity,
          id: r.decision.new_id,
          name: r.decision.new_name,
        };
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
  // Categories: only "add" is valid (enforced by CategoryDecision). The
  // discriminant check keeps the production code honest if the type
  // narrowing is ever loosened.
  for (const r of selection.categories) {
    if (r.decision.kind === "add") {
      out.adds.push({ kind: "category", entity: r.entity });
    }
  }
  return out;
}
