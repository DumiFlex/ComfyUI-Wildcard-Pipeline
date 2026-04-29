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

