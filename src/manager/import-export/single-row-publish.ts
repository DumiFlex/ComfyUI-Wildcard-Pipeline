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
import { CURRENT_SCHEMA_VERSION, SP2B_SCHEMA_VERSION } from "./migrations";
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
 * Choose the community catalog `schema_version` to stamp for a payload:
 * `SP2B_SCHEMA_VERSION` when the payload TEXT uses a range or the `~`
 * independent flag, else `CURRENT_SCHEMA_VERSION`. Scans the whole serialised
 * payload so the marker is found wherever text lives (wildcard option values,
 * combine templates, bundle children). Stamping the lower version for plain
 * payloads keeps pre-SP2b consumers able to install everything that doesn't
 * actually use the new grammar.
 */
export function schemaVersionForPayload(payload: Record<string, unknown>): number {
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
 * Build the engine-row payload for a module library row. Strips
 * server-stamped lifecycle fields + the local `history` sidecar —
 * community + the user's clipboard both want a fresh, history-free row
 * that they can re-stamp.
 */
export function buildModulePublishable(row: ModuleRow): PublishablePayload {
  const payload: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description,
    category_id: row.category_id,
    tags: row.tags,
    is_favorite: row.is_favorite,
    payload: stripHistory(row.payload as Record<string, unknown>),
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
 */
export function publishToCommunity(
  pub: PublishablePayload,
  router: Router,
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
