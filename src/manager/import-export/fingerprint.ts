/**
 * Module content fingerprint. Mirrors the djb2 hash used by
 * `src/components/context/bundles/bundle-fingerprint.ts`.
 *
 * Single unified helper for all 5 module types (wildcard, fixed_values,
 * combine, derivation, constraint). Hashes `[type, name, description,
 * sorted_tags_csv, payload_hash]` joined by `\n`.
 *
 * Why this works for every type without knowing payload shape: the
 * payload_hash is server-computed SHA-256 of canonical JSON of the
 * type-specific payload (see engine/modules/snapshot.py:payload_hash).
 * Cross-language parity comes for free — both TS and Python hash the
 * same payload_hash string returned by the API.
 *
 * Bundle fingerprint stays separate (different concern — bundles walk
 * their children[] structurally; see bundle-fingerprint.ts).
 *
 * Pure function — no DOM, no Vue, no I/O.
 */

export interface ModuleRow {
  type: string;
  name: string;
  description: string;
  tags: string[];
  payload_hash: string;
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function moduleFingerprint(m: ModuleRow): string {
  const parts = [
    m.type,
    m.name,
    m.description,
    [...m.tags].sort().join(","),
    m.payload_hash,
  ];
  return djb2(parts.join("\n"));
}
