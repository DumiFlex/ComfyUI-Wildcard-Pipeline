/**
 * What a constraint does, as numbers: for each source option, the chance of
 * each target option once the matrix and exceptions apply. Built on the same
 * `combineConstraintFactor` the engine mirrors, so the preview and a real run
 * agree. One constraint at a time, with the target's own weights; filters,
 * toggles and other constraints are left out.
 */
import type { AiConstraintCellDraft, AiConstraintExceptionDraft, ConstraintException, ConstraintMatrix } from "../api/types";
import { EXCLUDE, combineConstraintFactor } from "./constraint-math";

export interface PreviewOption {
  value: string;
  weight?: number;
  sub_categories?: string[];
  is_null?: boolean;
  fallback?: boolean;
}
export interface PreviewWildcard {
  options?: PreviewOption[];
  tag_groups?: Record<string, string[]>;
  tag_group_kinds?: Record<string, string>;
}
export interface PreviewRow {
  source: string;
  /** Chance of each target option, 0..1, in the target's option order. */
  chances: number[];
  /** Nothing was left; the fallback option (if any) stands in. */
  fallbackUsed: boolean;
  /** Nothing was left and there is no fallback. */
  empty: boolean;
}
export interface PreviewTable { targets: string[]; rows: PreviewRow[] }

function acceptsAxes(wc: PreviewWildcard): Record<string, string[]> {
  const kinds = wc.tag_group_kinds ?? {};
  const out: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(wc.tag_groups ?? {})) {
    if (kinds[axis] === "accepts") out[axis] = members ?? [];
  }
  return out;
}

export function previewConstraint(
  source: PreviewWildcard,
  target: PreviewWildcard,
  matrix: ConstraintMatrix,
  exceptions: ConstraintException[],
): PreviewTable {
  const srcAxes = acceptsAxes(source);
  const tgtAxes = acceptsAxes(target);
  const kinds = source.tag_group_kinds ?? {};
  const targets = target.options ?? [];
  const rows: PreviewRow[] = (source.options ?? []).map((s) => {
    const tags = s.sub_categories ?? [];
    const axes: Record<string, string[]> = {};
    for (const [axis, members] of Object.entries(srcAxes)) {
      const mine = tags.filter((t) => members.includes(t));
      if (mine.length) axes[axis] = mine;
    }
    const pick = { value: s.value ?? "", tags, axes };
    const weights = targets.map((t) => {
      const f = combineConstraintFactor(
        [pick], { value: t.value ?? "", tags: t.sub_categories ?? [] },
        matrix, exceptions as unknown as Array<Record<string, unknown>>, kinds, tgtAxes,
      );
      const w = Math.max(0, Number(t.weight ?? 1)) || 0;
      return f === EXCLUDE ? 0 : w * f;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total > 0) {
      return { source: s.value ?? "", chances: weights.map((w) => w / total), fallbackUsed: false, empty: false };
    }
    const fb = targets.findIndex((t) => t.fallback === true && !t.is_null);
    return {
      source: s.value ?? "",
      chances: targets.map((_, i) => (i === fb ? 1 : 0)),
      fallbackUsed: fb >= 0,
      empty: fb < 0,
    };
  });
  return { targets: targets.map((t) => t.value ?? ""), rows };
}

/** The constraint's matrix and exceptions with AI rules written in: a tag
 *  pair sets its cell, an option pair replaces the exception that pair had
 *  (the engine keeps one per pair) or is appended. Pure. */
export function mergeAiRules(
  matrix: ConstraintMatrix,
  exceptions: ConstraintException[],
  cells: AiConstraintCellDraft[],
  excs: AiConstraintExceptionDraft[],
): { matrix: ConstraintMatrix; exceptions: ConstraintException[] } {
  const nextMatrix: ConstraintMatrix = { ...matrix };
  for (const c of cells) {
    nextMatrix[c.source_tag] = { ...(nextMatrix[c.source_tag] ?? {}), [c.target_tag]: { ...c.cell } };
  }
  const nextExc = [...exceptions];
  for (const { exception } of excs) {
    const at = nextExc.findIndex((e) => e.source === exception.source && e.target === exception.target);
    if (at >= 0) nextExc.splice(at, 1, { ...exception });
    else nextExc.push({ ...exception });
  }
  return { matrix: nextMatrix, exceptions: nextExc };
}
