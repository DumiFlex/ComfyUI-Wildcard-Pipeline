/**
 * Single-row community publish + copy helpers.
 *
 * Pulled out of ExportTab.vue so per-row action buttons (ModuleListView,
 * each editor's footer toolbar) can reuse the exact same engine-row
 * shape + deeplink format without duplicating logic. The Export tab
 * still owns the multi-row export pipeline; this is just the
 * single-entity path that community publishing needs.
 *
 * Engine-row shape contract (matches the canonical engine output —
 * see `engine/db/repositories.py:_row_to_module` /
 * `_row_to_bundle`): module rows carry top-level `id`/`type`/`name`
 * with type-specific content nested under `payload`. Bundles drop
 * `type` + replace `payload` with `children`, an array of full
 * module-row snapshots. Server-stamped fields (`payload_hash`,
 * `version`, timestamps, `snapshot_fingerprint`) are stripped — the
 * receiving end (community web, or the user's own clipboard) assigns
 * its own.
 */

import type { Router } from "vue-router";
import type { BundleRow, ModuleRow } from "../api/types";
import {
  bundleChildBundleRefs,
  bundleChildExternalRefs,
  listReferencedUuids,
  resolveDependencies,
  type ReferencingModule,
} from "./dependencies";
import {
  CURRENT_SCHEMA_VERSION,
  SP2B_SCHEMA_VERSION,
  SP3_REACH_SCHEMA_VERSION,
} from "./migrations";
import { getValidator, type ModuleSubtype } from "@/validators";
import { version as ENGINE_VERSION } from "../../../package.json";

export interface PublishablePayload {
  /** Engine-row shape ready to ship: `{id, type?, name, payload|children, …}` */
  payload: Record<string, unknown>;
  /** Display name (used for the URL hash + clipboard toast). */
  name: string;
  /** Optional human description (prefilled on the community publish form). */
  description: string;
  /** Engine-side content_rating (migration 015). Mapped to community's
   *  `'sfw' | 'nsfw'` at the embed seam -- engine 'safe' → embed 'sfw'. */
  content_rating: "safe" | "nsfw";
  /** Tags carried into the publish-form prefill. */
  tags: string[];
  /** Existing community origin slug if this row was installed from
   *  community. Lets the embed publish form detect re-publish (own
   *  post = version bump; foreign post = fork prompt). */
  community_post_slug: string | null;
}

export interface PublishBody {
  name: string;
  description: string;
  payload: Record<string, unknown>;
  schema_version: number;
  producer_engine_version: string;
  changelog?: string;
}

/**
 * SP2b nested-multi-pick marker: a `{N$$…}` multi-pick whose count is a RANGE
 * (`N-M`) or that carries the `~` independent flag. A plain fixed-count
 * `{N$$…}` is NOT SP2b (it predates this — SP2a). Mirror of the community
 * publish-side scan (Alembic 0012): both ends key off the same text shape.
 */
const SP2B_MARKER_RE = /\{\d+(?:-\d+~?|~)\$\$/;

/**
 * Is `sel` a NON-DEFAULT constraint reach selector? The engine default for an
 * absent or `{mode:"all"}` selector covers every downstream target instance —
 * byte-identical in EFFECT to a pre-SP3 constraint, so it must NOT bump the
 * catalog version. A selector counts as non-default (SP3 reach actually in
 * use) when it narrows reach: `mode !== "all"` OR it carries a numeric `count`
 * OR a non-empty `picks` array. Mirrors `reachCovers` in
 * `extension/constraint-pairs.ts` (same `{mode, count?, picks?}` shape) and
 * the engine's coverage test. Note `{mode:"pick", picks:[]}` still bumps —
 * `mode !== "all"` is the deciding clause and a pre-SP3 consumer can't parse
 * the `pick`/`first`/`next` modes at all. The lone default that does NOT bump
 * is an absent selector or an explicit `{mode:"all"}` (with no count/picks).
 */
function isNonDefaultTargetSelect(sel: unknown): boolean {
  if (!sel || typeof sel !== "object") return false;
  const s = sel as { mode?: unknown; count?: unknown; picks?: unknown };
  if (typeof s.mode === "string" && s.mode !== "all") return true;
  if (typeof s.count === "number") return true;
  if (Array.isArray(s.picks) && s.picks.length > 0) return true;
  return false;
}

/**
 * Walk `node` (object/array, any depth) looking for ANY `target_select`
 * property whose value is a non-default reach selector. Mirrors the SP2b
 * whole-payload scan: a constraint's `target_select` can sit at
 * `payload.target_select` (library default) OR `instance.target_select`
 * (per-instance override), and constraints can be nested inside a bundle's
 * `children`. A structural walk (vs. the SP2b text regex) is required because
 * "non-default" depends on the selector's VALUE, not just its presence.
 */
export function usesTargetSelectReach(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => usesTargetSelectReach(child));
  }
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;
  if (isNonDefaultTargetSelect(obj.target_select)) return true;
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && usesTargetSelectReach(value)) return true;
  }
  return false;
}

/**
 * Choose the community catalog `schema_version` to stamp for a payload — the
 * MAX version any feature in the payload requires:
 *   - `SP3_REACH_SCHEMA_VERSION` (4) when ANY constraint carries a non-default
 *     `target_select` reach selector (`usesTargetSelectReach`).
 *   - `SP2B_SCHEMA_VERSION` (3) when the payload TEXT uses a range count or the
 *     `~` independent flag.
 *   - `CURRENT_SCHEMA_VERSION` (2) baseline otherwise.
 * A payload using BOTH range syntax and non-default reach stamps 4 (the max).
 * Both scan the WHOLE serialised payload / structure so the marker is found
 * wherever it lives (wildcard option values, combine templates, constraint
 * selectors, bundle children, instance overrides). Stamping the LOWEST
 * sufficient version keeps older consumers able to install everything that
 * doesn't actually use a newer feature.
 */
export function schemaVersionForPayload(payload: Record<string, unknown>): number {
  if (usesTargetSelectReach(payload)) return SP3_REACH_SCHEMA_VERSION;
  return SP2B_MARKER_RE.test(JSON.stringify(payload))
    ? SP2B_SCHEMA_VERSION
    : CURRENT_SCHEMA_VERSION;
}

/**
 * Build the publish body shape with stamped schema_version +
 * producer_engine_version, after structurally validating the payload
 * against sister's CURRENT validator.
 *
 * Per spec §5f, the same validator code runs at install-time strict
 * validation on any consumer at the same CURRENT — a bug has to exist
 * in BOTH producer + consumer simultaneously to slip past, which makes
 * it a generic validator bug, not a vendor-drift one.
 *
 * Throws if the payload fails strict validation at CURRENT (per spec
 * §2 #1's authoritative-on-sister rule).
 */
export function buildPublishBody(input: {
  payload: Record<string, unknown>;
  name: string;
  description: string;
  changelog?: string;
}): PublishBody {
  const kind = typeof input.payload.children !== "undefined" ? "bundle" : "module";
  const subtype = kind === "module" ? (input.payload.type as ModuleSubtype) : undefined;

  const validator = getValidator(
    kind === "module"
      ? { kind: "module", subtype: subtype!, version: CURRENT_SCHEMA_VERSION, mode: "strict" }
      : { kind: "bundle", version: CURRENT_SCHEMA_VERSION, mode: "strict" },
  );
  const result = validator.safeParse(input.payload);
  if (!result.success) {
    throw new Error(`structural validation failed: ${result.error.message}`);
  }

  return {
    name: input.name,
    description: input.description,
    payload: input.payload,
    schema_version: schemaVersionForPayload(input.payload),
    producer_engine_version: ENGINE_VERSION,
    changelog: input.changelog ?? "",
  };
}

/**
 * Strip the local-only `history` sidecar from a module payload.
 *
 * `payload.history` is a per-module edit-history list (max 3 entries,
 * see utils/history.ts) kept for the local undo affordance. It is NOT
 * part of the published shape -- the strict v1 validators reject it as
 * an unrecognized key, and shipping a module's edit history to the
 * community would leak prior values + bloat the payload. Both publish
 * AND copy-to-clipboard go through buildModulePublishable, so stripping
 * here covers both.
 */
function stripHistory(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const copy = { ...payload };
  delete copy.history;
  return copy;
}

/**
 * Backfill a CONSTRAINT payload's cached axis names from the live module
 * catalog. A constraint built by the starter recipe — or any constraint never
 * opened in the ConstraintEditor (the only place that stamps these on save,
 * see `ConstraintEditor.vue` save()) — carries `source_wildcard_id` /
 * `target_wildcard_id` but no `*_wildcard_name`, so the community renders the
 * axis as a raw uuid. Resolving id→name here (same `catalog.find(m => m.id ===
 * id)?.name` lookup the editor uses) makes EVERY published constraint
 * self-describe its axes, regardless of how it was authored.
 *
 * Non-mutating: returns a new payload object. Only fills a name that's ABSENT
 * (never overwrites an editor-cached value) and only when the id resolves in
 * the catalog (a dangling ref leaves its name absent → banner falls back to
 * uuid-only, same as a legacy constraint). A no-op for non-constraint rows and
 * when `catalog` is empty.
 */
function backfillConstraintNames(
  type: string,
  payload: Record<string, unknown>,
  catalog: ModuleRow[],
): Record<string, unknown> {
  if (type !== "constraint" || catalog.length === 0) return payload;
  const nameById = (id: unknown): string | undefined =>
    typeof id === "string" ? catalog.find((m) => m.id === id)?.name : undefined;
  const out = { ...payload };
  if (typeof out.source_wildcard_name !== "string") {
    const name = nameById(out.source_wildcard_id);
    if (name) out.source_wildcard_name = name;
  }
  if (typeof out.target_wildcard_name !== "string") {
    const name = nameById(out.target_wildcard_id);
    if (name) out.target_wildcard_name = name;
  }
  return out;
}

/**
 * Build the engine-row payload for a module library row. Strips
 * server-stamped lifecycle fields + the local `history` sidecar —
 * community + the user's clipboard both want a fresh, history-free row
 * that they can re-stamp.
 *
 * `catalog` (the unfiltered `useModuleStore().catalog`, passed by the `.vue`
 * callers to keep this helper framework-free) is used ONLY to backfill a
 * constraint's missing axis names (`backfillConstraintNames`). Defaults to
 * `[]` so callers that don't need the backfill simply omit it.
 */
export function buildModulePublishable(
  row: ModuleRow,
  catalog: ModuleRow[] = [],
): PublishablePayload {
  const inner = backfillConstraintNames(
    row.type,
    stripHistory(row.payload as Record<string, unknown>),
    catalog,
  );
  const payload: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    category_id: row.category_id,
    tags: row.tags,
    is_favorite: row.is_favorite,
    payload: inner,
  };
  return {
    payload,
    name: row.name,
    description: row.description,
    content_rating: row.content_rating ?? "safe",
    tags: row.tags ?? [],
    community_post_slug: row.community_post_slug ?? null,
  };
}

/**
 * Normalize ONE stored bundle child for publish.
 *
 * Bundle children are the engine's frozen WIDGET snapshots
 * (`{id, type, meta:{name,...}, payload, instance, enabled, collapsed}`)
 * -- NOT standalone module rows. They ship verbatim so the community
 * carries them losslessly and an installed bundle round-trips back to a
 * working sister bundle (name lives under `meta`; flattening it away
 * was what produced "(unnamed)" children). The only transform is
 * stripping the local `history` sidecar from the child's payload.
 */
export function normalizeBundleChild(
  child: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...child };
  if (out.payload && typeof out.payload === "object") {
    out.payload = stripHistory(out.payload as Record<string, unknown>);
  }
  return out;
}

/**
 * Build the engine-row payload for a bundle library row. Children are
 * carried verbatim as widget snapshots (history stripped) -- the
 * community treats them opaquely + the importer stores them so the
 * round-trip is lossless.
 */
export function buildBundlePublishable(row: BundleRow): PublishablePayload {
  const children = (row.children ?? []).map((c) =>
    normalizeBundleChild(c as Record<string, unknown>),
  );
  const payload: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    category_id: row.category_id,
    tags: row.tags,
    is_favorite: row.is_favorite,
    children,
  };
  return {
    payload,
    name: row.name,
    description: row.description,
    content_rating: row.content_rating ?? "safe",
    tags: row.tags ?? [],
    community_post_slug: row.community_post_slug ?? null,
  };
}

/**
 * utf8-safe base64 — `btoa()` only handles latin-1, so we walk the
 * UTF-8 bytes manually. Mirror of `b64ToText` on the community web
 * side (`web/src/views/PublishView.vue:b64ToText`).
 */
function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Keep the first occurrence of each `key(item)`. Used to collapse dependency
 *  / unmet entries that more than one dep source resolves to the same slug or
 *  name — `resolveDependencies` already dedupes WITHIN a source, this dedupes
 *  ACROSS the merged sources. Insertion order preserved. */
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Navigate the extension to the Community tab's publish view with the
 * payload pre-filled via the URL hash. The community embed's
 * EmbedPublish reads `window.location.hash` on mount + hydrates the
 * form — same b64 contract the community web's PublishView already
 * understood. Hash (not query) keeps the payload off the request log
 * and sidesteps Edge's ~2KB address-bar limit on bundle exports.
 *
 * Replaces the prior `window.open(WPC_API_URL/upload)` flow: opening
 * the browser threw away the in-extension bearer token (different
 * origin storage) and forced a fresh device-flow login. Routing
 * inside the SPA keeps auth alive + the user inside ComfyUI.
 *
 * Dependency-aware (B2b + BR-A2): the published payload's dependencies are
 * auto-detected and resolved into the hash as two params the embed hydrates
 * from (`dependencies` prefills published deps, `unmet_deps` warns about the
 * rest); see the hash-building block below. Two disjoint sources:
 *   - a MODULE's referenced wildcards (`listReferencedUuids`) resolved against
 *     `catalog` (the unfiltered `useModuleStore().catalog`).
 *   - a BUNDLE's inner-bundle children (`bundleChildBundleRefs`) resolved
 *     against `bundleCatalog` (the unfiltered `useBundleStore().catalog`) — an
 *     inner bundle that's already on the community becomes a recorded dep edge.
 * Both catalogs default to `[]` so callers that don't need them just omit them;
 * this helper stays framework-free, the `.vue` callers wire the stores.
 */
export function publishToCommunity(
  pub: PublishablePayload,
  router: Router,
  catalog: ModuleRow[] = [],
  bundleCatalog: BundleRow[] = [],
): void {
  // Validate before navigation — same validator that consumers run at
  // install-time strict validation (spec §5f). Throws if invalid.
  buildPublishBody({
    payload: pub.payload,
    name: pub.name,
    description: pub.description,
  });
  // (We discard the body since the actual POST happens in EmbedPublish
  // after the user fills the form. The validation side-effect is the
  // point — fail fast at click time, not after navigation.)

  const b64 = textToB64(JSON.stringify(pub.payload));
  const hash = new URLSearchParams();
  hash.set("payload", b64);
  // The embed reads this and forwards it to the publish POST so the server
  // stamps the real content-derived version instead of grace-defaulting to 1
  // (a v2+ payload, e.g. wildcard sub_categories, is rejected at v1).
  hash.set("schema_version", String(schemaVersionForPayload(pub.payload)));
  if (pub.name) hash.set("name", pub.name);
  if (pub.description) hash.set("description", pub.description);
  // Engine stores 'safe'/'nsfw'; community publish form takes 'sfw'/'nsfw'.
  // Map at the seam so the radio button selects correctly on hydrate.
  hash.set("content_rating", pub.content_rating === "nsfw" ? "nsfw" : "sfw");
  if (pub.tags.length > 0) hash.set("tags", pub.tags.join(","));
  // Re-publish detection: embed reads this + the current user's
  // username to decide between "create new post", "update version",
  // and "fork foreign post" flows.
  if (pub.community_post_slug) {
    hash.set("origin_slug", pub.community_post_slug);
  }
  // Dependency auto-detect (B2b + BR-A2). Two disjoint sources resolved into
  // the same dependencies/unmet split (published refs → `dependencies` the
  // embed prefills; the rest → `unmet_deps` it warns about). Same b64 encoding
  // as `payload=` (textToB64); appended ONLY when non-empty so the
  // no-dependency case leaves the hash unchanged.
  const inner = pub.payload as {
    id?: unknown;
    type?: unknown;
    payload?: Record<string, unknown>;
    children?: unknown;
  };
  // MODULE refs: the engine-row carries `id`/`type` at top level + the
  // type-specific content nested under `payload.payload` — exactly the
  // `{id, type, payload}` shape `listReferencedUuids` reads. A bundle has no
  // `type`, so this resolves to `[]`.
  const referencing: ReferencingModule = {
    id: typeof inner.id === "string" ? inner.id : "",
    type: inner.type as ReferencingModule["type"],
    payload: inner.payload ?? {},
  };
  const moduleDeps = resolveDependencies(listReferencedUuids(referencing), catalog);
  // BUNDLE inner-bundle refs: a bundle carries `children`; its `type:"bundle"`
  // children resolve against the bundle catalog. A module has no `children`, so
  // this resolves to `[]`. The two sources never overlap (a payload is either a
  // module or a bundle), so concatenation can't double-count.
  const innerBundleRefs = Array.isArray(inner.children)
    ? bundleChildBundleRefs(inner.children as Array<{ id?: unknown; type?: unknown }>)
    : [];
  const bundleDeps = resolveDependencies(innerBundleRefs, bundleCatalog);
  // BUNDLE child EXTERNAL module refs: a child constraint's source/target or a
  // wildcard/derivation child's nested `@{}` pointing OUTSIDE the bundle's
  // closure (not a direct module child, not inside an inner bundle) is an
  // external module dependency a downloader must reattach. Resolved against the
  // MODULE catalog (these are module uuids, like a module's own refs). A module
  // has no `children`, so this resolves to `[]`.
  const bundleChildExtRefs = Array.isArray(inner.children)
    ? bundleChildExternalRefs(inner.children as Array<Record<string, unknown>>, bundleCatalog)
    : [];
  const bundleChildDeps = resolveDependencies(bundleChildExtRefs, catalog);
  // Merge all three sources, de-duping consistently with `resolveDependencies`'
  // own split (dependencies by slug, unmet by name) — a slug/name surfaced by
  // more than one source collapses to a single entry.
  const dependencies = dedupeBy(
    [...moduleDeps.dependencies, ...bundleDeps.dependencies, ...bundleChildDeps.dependencies],
    (d) => d.slug,
  );
  const unmet = dedupeBy(
    [...moduleDeps.unmet, ...bundleDeps.unmet, ...bundleChildDeps.unmet],
    (u) => u.name,
  );
  if (dependencies.length > 0) {
    hash.set("dependencies", textToB64(JSON.stringify(dependencies)));
  }
  if (unmet.length > 0) {
    hash.set("unmet_deps", textToB64(JSON.stringify(unmet.map((u) => u.name))));
  }
  // Navigate via the router first, then set the hash directly via
  // window.location.hash. Passing the hash through router.push lets
  // vue-router 4 percent-encode any `%` in the value (including the
  // `%2C` that URLSearchParams.toString() emits for commas, or the
  // `%2B` for `+` in base64). Reading back, URLSearchParams decodes
  // only once -- consumers ended up with literal `%2C` in tags and
  // broken b64 in payload. Setting `window.location.hash` directly
  // bypasses the second encode pass; EmbedPublish picks up the
  // change via its `hashchange` listener.
  router
    .push({ path: "/community/publish" })
    .then(() => {
      window.location.hash = hash.toString();
    });
}

/**
 * Copy the pretty-printed engine-row JSON to the clipboard. Resolves
 * to true on success, false on failure (clipboard denied / no API).
 * Callers should surface a toast for either case.
 */
export async function copyPayloadToClipboard(
  pub: PublishablePayload,
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(JSON.stringify(pub.payload, null, 2));
    return true;
  } catch {
    return false;
  }
}
