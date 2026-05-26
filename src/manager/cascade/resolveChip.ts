/**
 * Shared chip resolver for `@{uuid}` text refs + per-option stable ids.
 *
 * Both resolvers return a discriminated union - callers branch on `missing`
 * to decide whether to render a normal chip or a warn-tone "missing" chip.
 * Broken-ref-tolerant rendering means cascade fixers never need to strip
 * dangling refs from option text or constraint exceptions; the UI surfaces
 * the broken state and the user resolves manually.
 */
import type { LibraryFixture } from "./reverse-dep-index";

export type ChipResolution =
  | { name: string; missing: false }
  | { raw: string; missing: true };

export type RefToken =
  | { type: "text"; value: string }
  | { type: "ref"; uuid: string; subcat: string | undefined };

// Groups: 1=uuid, 2=cached display name (display-only — consumers
// ignore it), 3=optional subcat list.
const REF_PATTERN = /@\{([0-9a-f]{8})(?:#([^#:}@{]*))?(?::([^}]*))?\}/g;

export function resolveWildcardChip(uuid: string, lib: LibraryFixture): ChipResolution {
  const wc = lib.wildcards.find((w) => w.id === uuid);
  if (!wc) return { raw: uuid, missing: true };
  return { name: wc.name, missing: false };
}

export function resolveOptionChip(
  wildcardId: string,
  optionId: string,
  lib: LibraryFixture,
): ChipResolution {
  const wc = lib.wildcards.find((w) => w.id === wildcardId);
  if (!wc) return { raw: optionId, missing: true };
  const opts = (wc.payload?.options ?? []) as Array<{ id?: string; value?: string }>;
  const opt = opts.find((o) => o?.id === optionId);
  if (!opt || typeof opt.value !== "string") return { raw: optionId, missing: true };
  return { name: opt.value, missing: false };
}

export function tokenizeRefString(s: string): RefToken[] {
  const out: RefToken[] = [];
  if (!s) return out;
  let cursor = 0;
  REF_PATTERN.lastIndex = 0;
  for (
    let m = REF_PATTERN.exec(s);
    m !== null;
    m = REF_PATTERN.exec(s)
  ) {
    if (m.index > cursor) {
      out.push({ type: "text", value: s.slice(cursor, m.index) });
    }
    out.push({ type: "ref", uuid: m[1], subcat: m[3] });
    cursor = m.index + m[0].length;
  }
  if (cursor < s.length) out.push({ type: "text", value: s.slice(cursor) });
  return out;
}
