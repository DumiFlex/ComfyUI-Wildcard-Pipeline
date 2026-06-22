/**
 * Constraint-matrix axis grouping — the pure logic shared by both matrix
 * surfaces (the SPA `ConstraintMatrix.vue` library editor and the canvas
 * `MatrixSection.vue` instance modal). Keeping it here means the two grids
 * order, group, label and colour their axes identically; only their template
 * + CSS differ.
 *
 * A wildcard's `tag_groups` (axis name → member sub-categories) drives the
 * layout: tags are ordered by axis, each axis becomes a coloured band
 * (columns) or pinned header chip (rows), and the leftover run of tags with
 * no axis becomes the labelled "uncategorized" bucket instead of a blank.
 */
import { axisHueAt } from "./axis-color";

/** One tag stamped with its axis + whether it opens a new group. Cell lookups
 *  stay keyed by tag name, so reordering for display is safe. */
export interface TagMeta {
  tag: string;
  axisIndex: number; // -1 = ungrouped
  axisName: string;
  groupStart: boolean; // first tag of its axis
}

/** A contiguous run of tags belonging to one axis (or the trailing ungrouped
 *  run). Columns render one band per group; row groups with >1 tag get a
 *  header chip, solo named groups fold the name into the tag. */
export interface AxisGroup {
  axisIndex: number; // -1 = ungrouped
  axisName: string;
  tags: string[];
  grouped: boolean;
}

/** Order `tags` by axis (grouped first, in axis order; ungrouped last) and
 *  stamp each with its axis index + whether it opens a new group. */
export function orderByGroups(tags: string[], groups: Record<string, string[]>): TagMeta[] {
  const out: TagMeta[] = [];
  const seen = new Set<string>();
  Object.keys(groups).forEach((axis, ai) => {
    let first = true;
    for (const t of groups[axis] ?? []) {
      if (seen.has(t) || !tags.includes(t)) continue;
      seen.add(t);
      out.push({ tag: t, axisIndex: ai, axisName: axis, groupStart: first });
      first = false;
    }
  });
  let firstUngrouped = true;
  for (const t of tags) {
    if (seen.has(t)) continue;
    out.push({ tag: t, axisIndex: -1, axisName: "", groupStart: firstUngrouped });
    firstUngrouped = false;
  }
  return out;
}

/** Collapse an ordered `TagMeta[]` into contiguous axis groups. */
export function toGroups(ordered: TagMeta[]): AxisGroup[] {
  const groups: AxisGroup[] = [];
  for (const m of ordered) {
    if (m.groupStart || groups.length === 0) {
      groups.push({ axisIndex: m.axisIndex, axisName: m.axisName, tags: [], grouped: m.axisIndex >= 0 });
    }
    groups[groups.length - 1].tags.push(m.tag);
  }
  return groups;
}

/** A "bucket" is the catch-all uncategorized run: no axis, or a blank axis
 *  name. Buckets are labelled "uncategorized" + tinted neutral rather than
 *  rendered blank. */
export function isBucket(grp: AxisGroup): boolean {
  return !grp.grouped || grp.axisName.trim().length === 0;
}

/** Display label for a group's band / chip. */
export function groupLabel(grp: AxisGroup): string {
  return isBucket(grp) ? "uncategorized" : grp.axisName;
}

/** Neutral grey for the uncategorized bucket — distinct from the per-axis
 *  palette so it doesn't read as a real named axis. */
export const UNGROUPED_HUE = "var(--wp-text-muted, #8a8a9a)";

/** Hue for a group's chips / band / tags. Named axes take the shared palette;
 *  the uncategorized bucket goes neutral grey when it's labelled (mixed
 *  layout), else keeps the legacy source/target tint (fully-flat matrix). */
export function groupHue(grp: AxisGroup, role: "source" | "target", labeled: boolean): string {
  if (!isBucket(grp)) return axisHueAt(grp.axisIndex);
  return labeled ? UNGROUPED_HUE : `var(--wp-constraint-${role})`;
}
