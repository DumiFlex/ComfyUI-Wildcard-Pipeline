/**
 * Decoding utilities for constraint matrix/exception cell keys.
 * Used for marshalling JSON-stringified cell references in disabled sets.
 */

export function decodeKey(key: string): [string, string] {
  return JSON.parse(key);
}
