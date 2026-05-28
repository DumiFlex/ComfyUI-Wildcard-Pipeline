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

/** Module kind set used by the kind-aware chip resolver. Mirrors
 *  `IncomingRef.from_kind` plus `wildcard` (which lives outside the
 *  incoming-ref index because the index walks FROM wildcards). */
export type ModuleKind =
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

export type ModuleChipResolution =
  | { name: string; kind: ModuleKind; resolved: true }
  | { resolved: false };

/**
 * Kind-aware chip resolver — search EVERY library collection for a uuid
 * match and report back the matched module's display name + kind. Used
 * by RichTextPreview / DebugViewer so a `@{uuid}` token that points at
 * a non-wildcard module (e.g. the constraint id embedded in the
 * `constraint_never_applied` warning, where the engine wraps both the
 * CONSTRAINT id AND the target wildcard id as `@{uuid}` refs) renders
 * as a colored chip matching its kind instead of falling through as an
 * unresolved wildcard.
 *
 * Search order: wildcards → fixed_values → combines → derivations →
 * constraints → bundles. First match wins. Order matters only as a
 * tiebreaker for the (in practice impossible) collision across kinds —
 * uuids are 8-hex-char short ids minted via Python `secrets.token_hex(4)`,
 * collision-free within a library at write time.
 */
export function resolveModuleChip(uuid: string, lib: LibraryFixture): ModuleChipResolution {
  const wc = lib.wildcards.find((w) => w.id === uuid);
  if (wc) return { name: wc.name, kind: "wildcard", resolved: true };
  const fv = lib.fixed_values.find((m) => m.id === uuid);
  if (fv) return { name: fv.name, kind: "fixed_values", resolved: true };
  const cb = lib.combines.find((m) => m.id === uuid);
  if (cb) return { name: cb.name, kind: "combine", resolved: true };
  const dv = lib.derivations.find((m) => m.id === uuid);
  if (dv) return { name: dv.name, kind: "derivation", resolved: true };
  const ct = lib.constraints.find((m) => m.id === uuid);
  if (ct) return { name: ct.name, kind: "constraint", resolved: true };
  const bd = lib.bundles.find((m) => m.id === uuid);
  if (bd) return { name: bd.name, kind: "bundle", resolved: true };
  return { resolved: false };
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
