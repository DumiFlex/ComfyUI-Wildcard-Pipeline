/**
 * Canonical name validators — the SINGLE surface every UI site imports so
 * that "add", "rename", and any other name-entry point enforce identical
 * rules and cannot drift apart. (This module exists because sub-category
 * *add* validated with `validateSubcatName` while *rename* hand-rolled a
 * weaker check that missed spaces — issue #7. Centralizing removes the
 * class of bug, not just the instance.)
 *
 * Each validator returns a human-readable error message, or `null` when the
 * name is valid. There are three grammar surfaces (see the engine's
 * `engine/syntax` + `docs`):
 *
 *  - **Sub-category tags** → `validateSubcatName` (whitespace / reserved
 *    word / disallowed char). The rule lives in `parsing/subcatFilter.ts`
 *    because it is parity-tested against the engine's shared fixtures; we
 *    re-export it here so callers still import from one place.
 *  - **Produced-variable / `$identifier` names** → `validateVariableName`
 *    (or the boolean `isValidVariableName` for terse per-row surfaces).
 *  - **Display names embeddable in an `@{uuid#name:subcat}` ref** →
 *    `validateRefGrammarName` (rejects the structural + comma chars).
 */
import { validateSubcatName } from "../parsing/subcatFilter";
import { VALID_IDENTIFIER_RE } from "../utils/slug";

export { validateSubcatName };

/** Reserved characters for names that flow into the `@{uuid#name:subcat}`
 *  ref grammar (structural braces/colon/hash/at + the comma that separates
 *  sub-categories). Mirrors `wp_api/_validators.py`. */
const REF_GRAMMAR_FORBIDDEN_RE = /[{}:#@,]/;

/** Validate a display name that may be embedded in an `@{uuid#name:subcat}`
 *  ref. Returns an error message or `null`. Whitespace is allowed here —
 *  wildcard/module display names legitimately contain spaces; only the
 *  structural characters are forbidden. */
export function validateRefGrammarName(name: string): string | null {
  const bad = name.match(REF_GRAMMAR_FORBIDDEN_RE);
  if (bad) {
    return `Cannot contain "${bad[0]}" (reserved by the @{uuid#name:subcat} ref grammar)`;
  }
  return null;
}

/** True when `name` is a valid produced-variable identifier (letter or
 *  underscore first, then letters/digits/underscores; no spaces). Use this
 *  for terse per-row surfaces that supply their own message. */
export function isValidVariableName(name: string): boolean {
  return VALID_IDENTIFIER_RE.test(name);
}

/** Validate a produced-variable / `$identifier` name. Returns an error
 *  message or `null`. Empty is treated as invalid — callers that allow an
 *  empty value (e.g. "use the library default") gate that before calling. */
export function validateVariableName(name: string): string | null {
  if (isValidVariableName(name)) return null;
  return "Use letters, digits, underscores; must not start with a digit.";
}
