/**
 * Frontend id minting — matches the engine's `secrets.token_hex(4)`
 * shape from `engine/db/repositories.py:_gen_id`.
 *
 * The picker rename flow (Task 20 importer/exporter v2) needs to mint a
 * fresh 8-hex-char id when the user picks "Import as new" on a UUID
 * collision. We can't round-trip to the server for this — the user is
 * mid-modal — so the SPA mints client-side using the Web Crypto API.
 *
 * Why a dedicated module rather than re-using `newModuleId()` from
 * `src/widgets/_shared.ts`: that file is the lazy-chunk shared bundle
 * for the extension widgets and pulls in Vue runtime + plugin-vue
 * helpers. The manager SPA's tree-shaker would haul that whole graph
 * across just to access the four-line helper. A standalone utility
 * keeps both worlds slim.
 *
 * Collision probability: 4 bytes = 2^32 ≈ 4.3 B distinct ids. Per-import
 * batches are small (≤ low hundreds), so birthday-paradox collisions
 * within a single rename batch are statistically negligible (~1 in 4 B
 * per pairwise comparison). The server's `_insert_module` /
 * `_insert_bundle` paths also reject duplicate ids, so even a one-in-
 * billions collision surfaces as a clean 400 rather than silent
 * corruption.
 */

/**
 * Mint a fresh 8-hex-char id matching the engine's `secrets.token_hex(4)`
 * shape. Uses `crypto.getRandomValues` (CSPRNG) — NOT `Math.random()`,
 * because the project ban on `Math.random` for id generation is
 * load-bearing (workflow file determinism + multi-window concurrent
 * editing both depend on cryptographic non-collision).
 */
export function newShortId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
