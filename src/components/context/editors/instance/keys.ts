/**
 * Composite-key contract for instance disable lists.
 *
 * Spec invariant: composite keys are JSON-encoded string arrays, no
 * whitespace, unicode literal (not escaped), array order preserved as
 * caller-given. Python `engine.modules._keys.encode_key` MUST output
 * identical bytes for identical input. Cross-language fitness test in
 * `tests/test_engine_keys.py` enforces this.
 *
 * See: docs/superpowers/specs/2026-05-07-instance-overrides-modal-design.md §4.5
 */

export function encodeKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

export function decodeKey(key: string): string[] {
  try {
    const parsed = JSON.parse(key);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
