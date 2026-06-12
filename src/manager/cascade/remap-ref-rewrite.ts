/**
 * #3 broken-nested-chip rewriter. Rewrites every `@{oldUuid…}` token in
 * `text` to a NEW ref, REBUILDING the `#name` + `:expr` + `!null` segments
 * from `next` (the user-picked replacement wildcard + reconciled filter).
 * Other-uuid refs pass through verbatim.
 *
 * Distinct from `uuid-remap.ts:walkRemap`, which preserves segments
 * verbatim for a 1:1 uuid swap (#4 / import). Here the replacement is a
 * DIFFERENT wildcard, so the old `#name` is discarded and the old
 * `:subcat` is replaced by the caller's reconciled expression.
 *
 * Grammar matches the canonical 4-segment form emitted by
 * RichTextInput.serialiseRefAtom. Hex-only uuid group keeps it aligned
 * with REF_PATTERN (resolveChip.ts) and REF_RE (uuid-remap.ts).
 */

// 1=uuid, 2=cached #name (discarded), 3=:subcat body incl any !null (discarded).
const REF_RE = /@\{([0-9a-f]{6,16})(?:#([^#:}@{]*))?(?::([^}]*))?\}/gi;

export interface RemapTarget {
  uuid: string;
  name: string;
  subcatExpr: string;
  excludeNull: boolean;
}

/** Build the canonical `@{uuid#name:expr!null}` form, omitting empty
 *  segments — mirrors RichTextInput.serialiseRefAtom. */
function buildRef(next: RemapTarget): string {
  let out = "@{" + next.uuid;
  if (next.name.length > 0) out += "#" + next.name;
  if (next.subcatExpr.length > 0) out += ":" + next.subcatExpr;
  if (next.excludeNull) out += "!null";
  out += "}";
  return out;
}

export function rewriteBrokenRef(
  text: string,
  oldUuid: string,
  next: RemapTarget,
): string {
  if (!text) return text;
  const replacement = buildRef(next);
  return text.replace(REF_RE, (whole, uuid: string) =>
    uuid.toLowerCase() === oldUuid.toLowerCase() ? replacement : whole,
  );
}
