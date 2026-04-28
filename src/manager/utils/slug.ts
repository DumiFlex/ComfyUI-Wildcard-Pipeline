/**
 * Identifier coercion helpers shared by editor forms.
 *
 * The pipeline expression syntax binds resolved values to `$varname` symbols.
 * `varname` must satisfy `^[a-zA-Z_][a-zA-Z0-9_]*$` — otherwise the engine's
 * tokenizer won't recognise it as a reference and downstream modules can't
 * read the value back. UI fields auto-derive these identifiers from human
 * names, so we centralise the slug rules here.
 */

/** Coerce a string to a valid `$varname` identifier — `[a-zA-Z_][a-zA-Z0-9_]*`. */
export function toIdentifier(input: string): string {
  const cleaned = (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return /^[a-z]/.test(cleaned) ? cleaned : `wc_${cleaned || "x"}`;
}

export const VALID_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Extract the canonical 8-hex wildcard UUID from a full module DB id.
 *
 * `ModuleRepository._gen_id` builds ids as `<prefix>_<slug>_<token_hex(4)>`,
 * e.g. `wc_test2_ea67b173`. The syntax spec (§2.4 in 2026-04-28 design doc)
 * locks the wildcard ref form to `@{8hex}` — the trailing 8 hex chars are
 * the UUID. SPA editors that surface refs in autocomplete must extract this
 * suffix instead of inserting the whole DB id verbatim, otherwise the
 * tokenizer regex (matching `@\{[0-9a-f]{8}\}`) rejects the token and the
 * user sees raw `@{wc_test2_ea67b173}` text in the textarea with no chip.
 *
 * Returns null when the id does not end in `_<8hex>` (legacy/fixture data,
 * imported bundles with non-standard ids, etc.) so callers can decide
 * whether to skip or fall back.
 */
export function extractModuleUuid(id: string): string | null {
  const m = id.match(/_([0-9a-f]{8})$/);
  return m ? m[1] : null;
}
