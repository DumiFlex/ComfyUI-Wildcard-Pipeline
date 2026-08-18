/**
 * Row models for the `@` and `$` autocomplete popovers.
 *
 * The popover used to render one line of text per hit: a name, plus for `@` a
 * trailing "12 opts · a1b2c3d4". That is enough to pick between two names that
 * differ, and nothing at all when they don't — which is the case that actually
 * sends people to the popover. A wildcard's useful identity is its option
 * count, how many axes it is organised by, and how many tags it declares; a
 * variable's is *who writes it* and whether anything else binds the same name.
 *
 * Both hosts render from these same models. The canvas and the SPA differ in
 * one substantive way, not in styling: the canvas walked a real graph, so it
 * can say a write overrides earlier ones, while the library has no execution
 * order and can only say other modules bind the same name. That difference
 * arrives as `siblingLabel` and is resolved here, once, so the popover and
 * RefChip's hover card cannot drift into telling different stories about the
 * same variable.
 *
 * Pure data-to-data, deliberately outside the 2.8k-line editor that hosts it.
 */
import { kindIcon } from "../../components/shared/kind-icons";

/** The producer shape threaded from `collectUpstreamProducers`. Structural so
 *  callers can pass `VarProducerLike` without importing it from an SFC. */
export interface ProducerLike {
  kind: string;
  nodeLabel?: string;
  moduleName?: string;
  moduleId?: string;
  internal?: boolean;
  shadowed: number;
  siblingLabel?: string;
  /** `accepts` axes the producing wildcard declares, for `$var.AXIS` rows. */
  axes?: { axis: string; tags: string[]; hueIndex: number }[];
}

export interface SuggestionRow {
  /** True for a `name.AXIS` entry, so the popover can indent it under the
   *  variable it belongs to instead of listing it as a peer. */
  isAxis?: boolean;
  /** What gets inserted — a uuid for `@`, a bare name for `$`. */
  token: string;
  /** What the user reads. */
  label: string;
  /** PrimeIcons class, e.g. `pi pi-sparkles`. */
  icon: string;
  /** Module kind behind the row, so the icon can take that kind's colour. A
   *  `$var` can be written by a fixed_values or a combine just as easily as by
   *  a wildcard, and colouring every row accent-violet throws that away. */
  kind: string;
  /** `@` only: the uuid, rendered small beneath the name. Two wildcards can
   *  share every other fact, so this is the last resort tiebreaker. */
  uuid?: string;
  /** Short factual chips — "132 options", "5 axes", "30 tags". Ordered
   *  most- to least-distinguishing. */
  facts: string[];
  /** `$` only: who writes it, in parts rather than one sentence — the module
   *  name is the identifying half and gets highlighted, so it cannot be
   *  pre-joined into a string. */
  producer?: ProducerParts;
  /** `$` only: the override / sibling count, which is a warning-ish fact and
   *  so is rendered as a badge rather than folded into `producer`. */
  badge?: string;
  /** `$` only: the var resolves but the assembler strips it from the prompt. */
  internal?: boolean;
  /** `@` only: the wildcard declares sub-categories, so a filter can be
   *  applied. Drives the funnel affordance on the row. */
  filterable?: boolean;
  /** `@` only: this Context node carries its own snapshot of the wildcard, so
   *  the ref will resolve against that rather than the library row of the same
   *  uuid — and the two can hold different options. Marked on the row so the
   *  fact is visible while CHOOSING, not only after inserting. */
  fromNode?: boolean;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Maps threaded through as props. Every one is optional because the surfaces
 *  differ in what they know — a derivation editor has no tag groups. */
export interface ProducerParts {
  /** "written by" on a graph-aware host, "bound by" otherwise. */
  verb: string;
  /** The module that writes the value. Highlighted where it appears. */
  moduleName?: string;
  /** The node (canvas) or the module kind (library) — context for the name. */
  tail?: string;
}

export interface RefRowSources {
  uuidToName?: ReadonlyMap<string, string>;
  /** Uuids this Context node supplies a pool for. Absent in the SPA, which
   *  only ever reads the library. */
  nodePoolUuids?: ReadonlySet<string>;
  uuidToOptionsCount?: ReadonlyMap<string, number>;
  uuidToSubCategories?: ReadonlyMap<string, string[]>;
  uuidToTagGroups?: ReadonlyMap<string, Record<string, string[]>>;
}

/**
 * One row per `@` hit.
 *
 * Facts are omitted rather than zeroed: a wildcard with no axes says nothing
 * about axes instead of claiming "0 axes", because absent and empty read
 * differently and only one of them is worth the width.
 */
export function refRows(uuids: readonly string[], src: RefRowSources): SuggestionRow[] {
  return uuids.map((uuid) => {
    const facts: string[] = [];
    const count = src.uuidToOptionsCount?.get(uuid);
    if (typeof count === "number") facts.push(plural(count, "option"));
    const groups = src.uuidToTagGroups?.get(uuid);
    const axes = groups ? Object.keys(groups).length : 0;
    // "axis" is irregular, so it does not go through `plural`.
    if (axes > 0) facts.push(axes === 1 ? "1 axis" : `${axes} axes`);
    const tags = src.uuidToSubCategories?.get(uuid)?.length ?? 0;
    if (tags > 0) facts.push(plural(tags, "tag"));
    return {
      token: uuid,
      label: src.uuidToName?.get(uuid) ?? uuid,
      icon: kindIcon("wildcard"),
      kind: "wildcard",
      uuid,
      facts,
      filterable: tags > 0,
      fromNode: src.nodePoolUuids?.has(uuid) === true,
    };
  });
}

/**
 * The compact producer line — the popover's one-line form of what RefChip's
 * hover card says at length.
 *
 * Canvas rows read "written by Style FX · ember-marten": the module, then the
 * node it sits in. The SPA has no node, so its rows read "bound by Style FX ·
 * wildcard", falling back to the kind for the second half. `graphAware` is
 * passed rather than inferred from `siblingLabel` being absent — the host
 * already knows whether it walked a graph, and inferring it would silently
 * change the verb the day a canvas producer legitimately carries no siblings. Producers with
 * neither a module nor a node (injector rows, loop iteration vars) degrade to
 * the kind alone rather than emitting a dangling "written by".
 */
export function producerParts(p: ProducerLike, graphAware: boolean): ProducerParts | undefined {
  const verb = graphAware ? "written by" : "bound by";
  const tail = graphAware ? p.nodeLabel : p.kind;
  if (p.moduleName) return { verb, moduleName: p.moduleName, tail: tail || undefined };
  // No module: the node (canvas) is the only writer worth naming, and it takes
  // the highlight since it is the identifying half here.
  if (p.nodeLabel) return { verb, moduleName: p.nodeLabel };
  // Nothing but a kind — reported plainly rather than as a dangling verb.
  return p.kind ? { verb: "", tail: p.kind } : undefined;
}

/**
 * The override / sibling badge.
 *
 * Same count, two different truths. The canvas resolves last-write-wins, so N
 * earlier writes were genuinely overridden. The library has no order, so the
 * only honest statement is that N other modules bind the name — which is a
 * thing to look at, not a thing that happened.
 */
export function producerBadge(p: ProducerLike): string | undefined {
  if (p.shadowed <= 0) return undefined;
  return p.siblingLabel ? `${p.shadowed} others bind this` : `overrides ${p.shadowed}`;
}

/** One row per `$` hit. */
/** How many `accepts` axes one variable may contribute to the list.
 *
 *  Axes are naturally few — a wildcard with more than a handful of them is
 *  unusual — but the cap means a single pathological variable can never bury
 *  every other match. Anything beyond it stays typeable and is offered by the
 *  dot-triggered popover, which lists that one variable's axes in full. */
const MAX_AXIS_ROWS_PER_VAR = 6;

/** Expand a bare variable list so each variable is followed by its `accepts`
 *  axes as `name.AXIS` entries.
 *
 *  Flattened into the same list rather than hidden behind a second step: the
 *  axes are then visible while the user is still choosing, which is both one
 *  keystroke cheaper and the only advertisement the feature gets. A pick INDEX
 *  is deliberately absent — `pick_min`/`pick_max` are per-instance, so a
 *  library-authored template has no range to offer and any number shown would
 *  be true for one use and wrong for the next. */
export function expandVarsWithAxes(
  names: readonly string[],
  producers: ReadonlyMap<string, ProducerLike> | undefined,
): string[] {
  const out: string[] = [];
  for (const name of names) {
    out.push(name);
    const axes = producers?.get(name)?.axes ?? [];
    for (const a of axes.slice(0, MAX_AXIS_ROWS_PER_VAR)) {
      if (a.axis) out.push(`${name}.${a.axis}`);
    }
  }
  return out;
}

export function varRows(
  names: readonly string[],
  producers: ReadonlyMap<string, ProducerLike> | undefined,
  graphAware: boolean,
): SuggestionRow[] {
  return names.map((name) => {
    // An axis entry is `base.AXIS`; it borrows its base's producer, since the
    // axis is a property of that same module.
    const dot = name.indexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const axisName = dot > 0 ? name.slice(dot + 1) : "";
    const p = producers?.get(base);
    if (axisName) {
      const axis = (p?.axes ?? []).find((a) => a.axis === axisName);
      return {
        token: name,
        label: name,
        icon: "pi pi-tag",
        kind: "axis",
        // The member tags ARE the disambiguator — SHOES and EXPOSES are
        // otherwise two words with no way to tell which is which.
        facts: axis ? axis.tags.slice(0, 4) : [],
        producer: undefined,
        badge: undefined,
        internal: p?.internal === true,
        isAxis: true,
      };
    }
    return {
      token: name,
      label: name,
      // Unknown producer still gets a glyph, so the column never goes ragged.
      icon: kindIcon(p?.kind ?? ""),
      kind: p?.kind ?? "",
      facts: [],
      producer: p ? producerParts(p, graphAware) : undefined,
      badge: p ? producerBadge(p) : undefined,
      internal: p?.internal === true,
    };
  });
}
