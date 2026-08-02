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
}

export interface SuggestionRow {
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
export function varRows(
  names: readonly string[],
  producers: ReadonlyMap<string, ProducerLike> | undefined,
  graphAware: boolean,
): SuggestionRow[] {
  return names.map((name) => {
    const p = producers?.get(name);
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
