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

import type { BundleRow, ModuleRow } from "../api/types";
import { WPC_API_URL } from "../config/links";

export interface PublishablePayload {
  /** Engine-row shape ready to ship: `{id, type?, name, payload|children, …}` */
  payload: Record<string, unknown>;
  /** Display name (used for the URL hash + clipboard toast). */
  name: string;
  /** Optional human description (prefilled on the community publish form). */
  description: string;
}

/**
 * Build the engine-row payload for a module library row. Strips
 * server-stamped lifecycle fields — community + the user's clipboard
 * both want a fresh row that they can re-stamp.
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
    payload: row.payload,
  };
  return { payload, name: row.name, description: row.description };
}

/**
 * Build the engine-row payload for a bundle library row. Children
 * keep their full module-row shape (deep snapshots) — the community
 * importer expects to recurse on those at install time.
 */
export function buildBundlePublishable(row: BundleRow): PublishablePayload {
  const payload: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    category_id: row.category_id,
    tags: row.tags,
    is_favorite: row.is_favorite,
    children: row.children,
  };
  return { payload, name: row.name, description: row.description };
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
 * Open the community web's /upload page with the payload pre-filled
 * via the URL hash. Hash (not query) keeps the payload off the
 * request log and sidesteps Edge's ~2KB address-bar limit on bundle
 * exports.
 *
 * Window.open uses `noopener` so the new tab can't reach back into
 * our document via `window.opener`.
 */
export function publishToCommunity(pub: PublishablePayload): void {
  const b64 = textToB64(JSON.stringify(pub.payload));
  const url = new URL(`${WPC_API_URL}/upload`);
  url.searchParams.set("from", "spa");
  const hash = new URLSearchParams();
  hash.set("payload", b64);
  if (pub.name) hash.set("name", pub.name);
  if (pub.description) hash.set("description", pub.description);
  const full = `${url.toString()}#${hash.toString()}`;
  window.open(full, "_blank", "noopener");
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
