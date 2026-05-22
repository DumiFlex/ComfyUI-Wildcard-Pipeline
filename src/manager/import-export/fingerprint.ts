/**
 * Per-entity-type content fingerprints. Mirrors the djb2 hash used
 * by `bundle-fingerprint.ts`. Pure functions — no DOM, no Vue.
 *
 * Fingerprint scope contract: cover the FIELDS A USER CAN EDIT for
 * the entity. UUID is identity, not content; excluded. Tags are
 * order-insensitive (set semantics). Options/children arrays are
 * order-sensitive (user-controlled order matters for execution).
 */

/** djb2 hash → 8 hex chars. Small, order-sensitive, collision rate
 *  acceptable for content fingerprinting. Not cryptographic; we only
 *  need inequality to surface a diff. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

interface WildcardFingerprintInput {
  name: string;
  options: Array<{ value: string; weight: number }>;
  tags: string[];
  var_binding?: string;
}

export function wildcardFingerprint(w: WildcardFingerprintInput): string {
  const parts = [
    w.name,
    w.var_binding ?? "",
    w.options.map((o) => `${o.value}:${o.weight}`).join("|"),
    [...w.tags].sort().join(","),
  ];
  return djb2(parts.join("\n"));
}

interface VariableFingerprintInput {
  name: string;
  value: string;
  tags: string[];
}

export function variableFingerprint(v: VariableFingerprintInput): string {
  const parts = [v.name, v.value, [...v.tags].sort().join(",")];
  return djb2(parts.join("\n"));
}

interface ConstraintFingerprintInput {
  source_uuid: string;
  target_uuid: string;
  op: string;
  value: string | number | boolean | null;
}

export function constraintFingerprint(c: ConstraintFingerprintInput): string {
  const parts = [c.source_uuid, c.target_uuid, c.op, JSON.stringify(c.value)];
  return djb2(parts.join("\n"));
}
