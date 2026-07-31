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
    [...(m.tags ?? [])].sort().join(","),
    m.payload_hash,
  ];
  return djb2(parts.join("\n"));
}

/**
 * Content fingerprint computed from a module's PAYLOAD, with no server hash
 * involved.
 *
 * `moduleFingerprint` above takes `payload_hash` as an INPUT, so it cannot say
 * anything about a row that is missing one — which is exactly the row we need
 * to identify. A workflow module can arrive hash-less for several ordinary
 * reasons: it was authored in the widget and never pushed, it came in a shared
 * workflow, or its stored hash was lost. In the last two cases the module very
 * likely corresponds to a library entry, and the re-link picker should be able
 * to find it.
 *
 * Crucially this does NOT need to match the engine's `payload_hash` algorithm:
 * both sides of the comparison are computed here, from live payloads, so the
 * only requirement is self-consistency. That sidesteps the cross-language
 * canonicalisation problem entirely.
 *
 * Key order is normalised recursively so two structurally equal payloads that
 * serialise with different key order still agree — JSON object order is not
 * meaningful, and payloads routinely round-trip through APIs that reorder keys.
 *
 * Pure function — no DOM, no Vue, no I/O.
 */
export function localPayloadFingerprint(payload: unknown): string {
  return djb2(canonicalise(payload));
}

/** Stable stringify: objects emit their keys sorted, arrays keep order (array
 *  order IS meaningful — wildcard options, derivation rules). */
function canonicalise(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalise).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalise(obj[k])}`).join(",")}}`;
}

/**
 * Template content fingerprint. Templates carry NO server-computed
 * `payload_hash` / `snapshot_fingerprint` (they're the simplest entity —
 * a `template_string` plus library metadata), so collision detection
 * computes this fingerprint on BOTH the incoming and live rows.
 *
 * Hashes `[name, description, sorted_tags_csv, template_string,
 * category_id ?? ""]` joined by `\n`. Mirrors the Python side computed in
 * the engine importer's template collision path — same field order, same
 * djb2, so cross-language parity is free.
 *
 * Pure function — no DOM, no Vue, no I/O.
 */
export interface TemplateRow {
  name: string;
  description: string;
  tags: string[];
  template_string: string;
  category_id?: string | null;
}

export function templateFingerprint(t: TemplateRow): string {
  const parts = [
    t.name,
    t.description,
    [...(t.tags ?? [])].sort().join(","),
    t.template_string,
    t.category_id ?? "",
  ];
  return djb2(parts.join("\n"));
}
