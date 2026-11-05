/**
 * Pure sub-category / tag-group logic for the wildcard editor: the group-box
 * model, axis colours, coverage counts and the `payload.tag_groups` /
 * `payload.tag_group_kinds` (de)serialisation. Every function takes the
 * current state and returns a new value; nothing here mutates its input.
 */
import { axisHueAt, UNGROUPED_HUE } from "../../../components/shared/axis-color";
import { NEG_ACCESSOR } from "../../../widgets/richTokenize";

export type TagGroups = Record<string, string[]>;
export type TagGroupKinds = Record<string, "accepts">;

/** The synthetic "ungrouped" box (tags in the registry but in no axis). */
export const OTHER_AXIS = "__ungrouped__";

/** An `accepts` group is addressable as `$var.NAME`, so its name has to
 *  survive the accessor grammar. A `classify` group keeps any name. */
export const AXIS_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The slice of a wildcard option these helpers read. */
export interface TaggedOption {
  sub_categories?: string[];
  is_null?: boolean;
  weight?: number | string;
}

export interface SubcatGroup {
  /** Axis name, or the OTHER_AXIS sentinel for the ungrouped box. */
  axis: string;
  /** Registry tags in this box (group members ∩ registry, in registry order). */
  tags: string[];
  /** True for the synthetic ungrouped box (no rename/move-target). */
  isOther: boolean;
}

/** Render the registry as group boxes: one per `tag_groups` axis (in
 *  insertion order) plus a trailing "ungrouped" box for registry tags not
 *  claimed by any axis. */
export function buildSubcatGroups(tagGroups: TagGroups, registry: string[]): SubcatGroup[] {
  const groups: SubcatGroup[] = [];
  const claimed = new Set<string>();
  for (const [axis, members] of Object.entries(tagGroups)) {
    // Keep registry order so a tag's position is stable across boxes.
    const tags = registry.filter(
      (t) => Array.isArray(members) && members.includes(t),
    );
    tags.forEach((t) => claimed.add(t));
    // Named axes always render (even when empty) so a freshly-created
    // "+ Group" box is visible and can receive its first tag.
    groups.push({ axis, tags, isOther: false });
  }
  const ungrouped = registry.filter((t) => !claimed.has(t));
  // The ungrouped box only appears when it has tags OR there are no named
  // axes at all (so a brand-new wildcard still shows one box to add into).
  if (ungrouped.length > 0 || groups.length === 0) {
    groups.push({ axis: OTHER_AXIS, tags: ungrouped, isOther: true });
  }
  return groups;
}

/** What the collapsed section reports, so shutting it doesn't hide whether the
 *  wildcard is tagged at all. */
export function subcatSummaryText(registry: string[], tagGroups: TagGroups): string {
  const tags = registry.length;
  if (tags === 0) return "No sub-categories yet.";
  const axes = Object.keys(tagGroups).length;
  const t = `${tags} tag${tags === 1 ? "" : "s"}`;
  return axes > 0 ? `${t} across ${axes} ax${axes === 1 ? "is" : "es"}` : t;
}

/** Index of the axis a tag belongs to (-1 when ungrouped) — drives the
 *  per-axis chip hue via the shared `axisHueAt` palette so a tag reads
 *  with the same colour across every surface. */
export function axisIndexOf(tagGroups: TagGroups, tag: string): number {
  const axes = Object.keys(tagGroups);
  for (let i = 0; i < axes.length; i++) {
    if (tagGroups[axes[i]]?.includes(tag)) return i;
  }
  return -1;
}

/** Inline style colouring a tag chip by its axis. */
export function tagChipStyle(tagGroups: TagGroups, tag: string): Record<string, string> {
  return { "--chip-hue": axisHueAt(axisIndexOf(tagGroups, tag)) };
}

/** Hue for a whole group box, keyed by axis NAME (vs `tagChipStyle`, keyed by
 *  a member tag). OTHER_AXIS stays neutral. */
export function axisHueFor(tagGroups: TagGroups, axis: string): string {
  if (axis === OTHER_AXIS) return UNGROUPED_HUE;
  return axisHueAt(Object.keys(tagGroups).indexOf(axis));
}

/** How many options carry this tag — the pill's `(count)` badge. */
export function tagUsageCount(options: readonly TaggedOption[], tag: string): number {
  return options.filter((o) => (o.sub_categories ?? []).includes(tag)).length;
}

/** Options carrying NO tag from an accepts axis — for those picks `$var.AXIS`
 *  resolves to empty. Advisory only (non-blocking): an under-covered axis is a
 *  valid design ("only some outfits specify shoes"). Excludes the null option,
 *  which deliberately produces nothing. */
export function axisUncoveredCount(
  options: readonly TaggedOption[],
  tagGroups: TagGroups,
  axis: string,
): number {
  const members = tagGroups[axis] ?? [];
  if (members.length === 0) return 0;
  const memberSet = new Set(members);
  return options.filter(
    (o) => !o.is_null
      && !(o.sub_categories ?? []).some((t) => memberSet.has(t)),
  ).length;
}

/** First free auto-incrementing default name for a new axis. */
export function nextGroupName(tagGroups: TagGroups): string {
  let n = Object.keys(tagGroups).length + 1;
  let candidate = `group ${n}`;
  while (tagGroups[candidate] !== undefined) {
    n += 1;
    candidate = `group ${n}`;
  }
  return candidate;
}

/** Why `name` cannot be an `accepts` axis: `"neg"` (reserved by `$var.neg`),
 *  `"ident"` (not an identifier the accessor grammar can parse), or null. */
export function acceptsNameProblem(name: string): "neg" | "ident" | null {
  if (name === NEG_ACCESSOR) return "neg";
  if (!AXIS_IDENT.test(name)) return "ident";
  return null;
}

/** A refusal to show as a warning toast. */
export interface Refusal {
  summary: string;
  detail: string;
}

/** Why `axis` cannot be promoted to `accepts` as named, or null when it can.
 *  Refused here in the editor, where the user can still fix it cheaply,
 *  rather than at save time. */
export function acceptsPromotionRefusal(axis: string): Refusal | null {
  const problem = acceptsNameProblem(axis);
  if (problem === "neg") {
    return {
      summary: `Rename "${axis}" first`,
      detail: `$var.${NEG_ACCESSOR} reads a variable's negatives, so an accepts group can't be called "${NEG_ACCESSOR}".`,
    };
  }
  if (problem === "ident") {
    return {
      summary: `Rename "${axis}" first`,
      detail: "An accepts group is read as $var.NAME, so its name must be "
        + "letters, digits and underscores, starting with a letter.",
    };
  }
  return null;
}

/** Why an `accepts` axis `oldAxis` cannot be renamed to `name`, or null when
 *  it can. Renaming it to something the `$var.NAME` grammar cannot parse used
 *  to demote it to classify without a word, which quietly broke every
 *  `$var.AXIS` read of it. */
export function acceptsRenameRefusal(oldAxis: string, name: string): Refusal | null {
  const problem = acceptsNameProblem(name);
  if (problem === "neg") {
    return {
      summary: `"${oldAxis}" keeps its name`,
      detail: `$var.${NEG_ACCESSOR} reads a variable's negatives, so an accepts group can't be called "${NEG_ACCESSOR}".`,
    };
  }
  if (problem === "ident") {
    return {
      summary: `"${oldAxis}" keeps its name`,
      detail: "An accepts group is read as $var.NAME, so its name must be "
        + "letters, digits and underscores, starting with a letter. "
        + "Switch it to classify first to use any name.",
    };
  }
  return null;
}

/** Rename an axis in place, preserving insertion order, members and kind. */
export function renameAxis(
  tagGroups: TagGroups,
  kinds: TagGroupKinds,
  oldAxis: string,
  nextAxis: string,
): { groups: TagGroups; kinds: TagGroupKinds } {
  const groups: TagGroups = {};
  for (const [axis, members] of Object.entries(tagGroups)) {
    groups[axis === oldAxis ? nextAxis : axis] = members;
  }
  if (kinds[oldAxis] === undefined) return { groups, kinds };
  const nextKinds = { ...kinds };
  delete nextKinds[oldAxis];
  nextKinds[nextAxis] = "accepts";
  return { groups, kinds: nextKinds };
}

/** Disband an axis — its tags fall back into the ungrouped box. The kind goes
 *  with the group; a kind naming no group is invalid payload. */
export function removeAxis(
  tagGroups: TagGroups,
  kinds: TagGroupKinds,
  axis: string,
): { groups: TagGroups; kinds: TagGroupKinds } {
  const groups = { ...tagGroups };
  delete groups[axis];
  if (kinds[axis] === undefined) return { groups, kinds };
  const nextKinds = { ...kinds };
  delete nextKinds[axis];
  return { groups, kinds: nextKinds };
}

/** Destinations the "Move to group…" submenu offers for a pill in
 *  `fromAxis`: every other named axis + an "ungrouped" entry, minus the
 *  axis the pill already lives in. */
export function moveTargetsFor(
  tagGroups: TagGroups,
  fromAxis: string,
): Array<{ axis: string; label: string }> {
  const out: Array<{ axis: string; label: string }> = [];
  for (const axis of Object.keys(tagGroups)) {
    if (axis === fromAxis) continue;
    out.push({ axis, label: axis });
  }
  if (fromAxis !== OTHER_AXIS) {
    out.push({ axis: OTHER_AXIS, label: "ungrouped" });
  }
  return out;
}

/** Move a tag from its current axis into `targetAxis` (OTHER_AXIS =
 *  ungroup it). A tag lives in at most one axis (§2.2). */
export function moveTagToAxis(tagGroups: TagGroups, tag: string, targetAxis: string): TagGroups {
  const next: TagGroups = {};
  for (const [axis, members] of Object.entries(tagGroups)) {
    next[axis] = members.filter((m) => m !== tag);
  }
  if (targetAxis !== OTHER_AXIS) {
    next[targetAxis] = [...(next[targetAxis] ?? []), tag];
  }
  return next;
}

/** An option's tags after toggling `tag`, in registry order so chips render
 *  in a stable sequence regardless of click order. */
export function toggledOptionTags(registry: string[], current: string[], tag: string): string[] {
  const set = new Set(current);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  return registry.filter((t) => set.has(t));
}

/** Sum of option weights, floored at 1 so an all-zero list divides safely. */
export function totalWeightOf(options: readonly TaggedOption[]): number {
  const sum = options.reduce((acc, o) => acc + (Number(o.weight) || 0), 0);
  return sum > 0 ? sum : 1;
}

/** Coerce a raw `payload.tag_groups` into the editor's reactive shape:
 *  drop non-array members, keep only tags that are in the registry, and
 *  preserve insertion order. A tag claimed by two axes (shouldn't happen
 *  per §2.2) is kept only in the first that lists it. */
export function normalizeTagGroups(raw: unknown, registry: string[]): TagGroups {
  if (typeof raw !== "object" || raw === null) return {};
  const reg = new Set(registry);
  const seen = new Set<string>();
  const out: TagGroups = {};
  for (const [axis, members] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(members)) { out[axis] = []; continue; }
    const kept: string[] = [];
    for (const m of members) {
      if (typeof m === "string" && reg.has(m) && !seen.has(m)) {
        kept.push(m);
        seen.add(m);
      }
    }
    out[axis] = kept;
  }
  return out;
}

/** Coerce a raw `payload.tag_group_kinds` into the editor's shape: keep only
 *  `accepts` entries naming a group that actually exists, since `classify` is
 *  the default and a kind for a vanished group is meaningless. */
export function normalizeTagGroupKinds(raw: unknown, groups: TagGroups): TagGroupKinds {
  if (!raw || typeof raw !== "object") return {};
  const out: TagGroupKinds = {};
  for (const [axis, kind] of Object.entries(raw as Record<string, unknown>)) {
    if (kind === "accepts" && axis in groups) out[axis] = "accepts";
  }
  return out;
}

/** Build the `payload.tag_groups` to persist: keep only members still in the
 *  registry, and return `null` when nothing is left so the payload omits the
 *  key entirely.
 *
 *  An axis that ends up empty is dropped unless the user has asked to keep
 *  empties — see `uiStore.keepEmptyTagGroups`. Dropping was unconditional,
 *  which meant a group created and not yet filled vanished on save; that is
 *  right for a box made by accident and wrong for one made on purpose, and
 *  only the user knows which it was. An empty axis persists as `{axis: []}`,
 *  a shape the engine's validator already accepts. */
export function serializeTagGroups(
  tagGroups: TagGroups,
  registry: string[],
  keepEmpty: boolean,
): TagGroups | null {
  const reg = new Set(registry);
  const out: TagGroups = {};
  for (const [axis, members] of Object.entries(tagGroups)) {
    const kept = members.filter((m) => reg.has(m));
    if (kept.length > 0 || keepEmpty) out[axis] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Build `payload.tag_group_kinds`, restricted to groups that survived
 *  serialisation. Returns null when nothing is promoted so the payload omits
 *  the key entirely — that omission is what keeps existing wildcards
 *  byte-identical. */
export function serializeTagGroupKinds(
  kinds: TagGroupKinds,
  serializedGroups: TagGroups | null,
): TagGroupKinds | null {
  const out: TagGroupKinds = {};
  for (const axis of Object.keys(kinds)) {
    // An axis dropped by `serializeTagGroups` (empty, not kept) must not leave
    // a kind behind — the engine rejects a kind naming a missing group.
    if (serializedGroups && axis in serializedGroups) out[axis] = "accepts";
  }
  return Object.keys(out).length > 0 ? out : null;
}
