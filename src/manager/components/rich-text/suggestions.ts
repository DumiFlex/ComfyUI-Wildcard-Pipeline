/**
 * `$` / `@` autocomplete matching and the inline var styling for
 * `RichTextInput`. Pure: every input the component used to read off props
 * arrives as an argument.
 */
import type { Atom } from "../atomicEditorModel";
import { NEG_ACCESSOR, varAccessorParts } from "../../../widgets/richTokenize";
import { expandVarsWithAxes, type ProducerLike } from "../../utils/suggestion-rows";
import { varColorIndex } from "../../../components/shared/var-color";

/** `$var` → who writes it (only its declared `axes` are read here). */
export type AxisProducerMap = ReadonlyMap<string, ProducerLike>;

/** Row cap for the suggestion popover. Was 8 — with 100+ wildcards sharing
 *  near-identical display names, a query like `pose` silently truncated to
 *  the first 8 and the rest were UNREACHABLE: the popover's `max-height`
 *  never overflowed, so there was nothing to scroll and the feature read as
 *  "the scrollbar doesn't work". Raised so the list genuinely overflows and
 *  `overflow-y: auto` earns its keep; keyboard nav scrolls the active row
 *  into view. */
export const AC_MAX_ITEMS = 50;

/** Every `$` / `@` hit for `query`, uncapped.
 *
 *  For the `@` trigger, `refSuggestions` contains UUIDs (canonical stored
 *  form per syntax spec) and we filter on the human display name resolved
 *  through `uuidToName` so the user types `@col` and matches a wildcard
 *  named "color". The inserted token is still the UUID. Falling back to the
 *  raw UUID keeps filtering useful even before `uuidToName` is hydrated. */
export function matchSuggestions(
  trigger: "$" | "@",
  query: string,
  varSuggestions: readonly string[],
  refSuggestions: readonly string[],
  uuidToName: ReadonlyMap<string, string>,
  varProducers: AxisProducerMap | undefined,
): string[] {
  // Once the query carries an accessor the flat substring filter stops being
  // the right question: `outfit.0.` matches no entry, so the list emptied and
  // the popover vanished at exactly the point the user was reaching for an
  // axis. (`outfit.` only ever worked by luck — "outfit.shoes" happens to
  // contain it.) From the first dot on, offer that variable's AXES, keeping
  // any pick index the user already typed.
  if (trigger === "$" && query.includes(".")) {
    const base = query.slice(0, query.indexOf("."));
    const rest = query.slice(query.indexOf(".") + 1);
    // A leading numeric segment is a pick index; the axis fragment is whatever
    // follows it. `outfit.0.SH` -> index "0", fragment "sh".
    const m = rest.match(/^(\d+)\.?(.*)$/);
    const idx = m ? `.${m[1]}` : "";
    const frag = (m ? m[2] : rest).toLowerCase();
    const axes = varProducers?.get(base)?.axes ?? [];
    const out = axes
      .filter((a) => a.axis.toLowerCase().includes(frag))
      .map((a) => `${base}${idx}.${a.axis}`);
    // `.neg` reads the variable's negatives (send-to-negative). Every known
    // variable has it; it is offered last, after the variable's own axes.
    if (NEG_ACCESSOR.includes(frag) && (varSuggestions.includes(base) || axes.length)) {
      out.push(`${base}${idx}.${NEG_ACCESSOR}`);
    }
    return out;
  }
  // `$` pool carries each variable's `accepts` axes as `name.AXIS` entries,
  // directly after the variable they belong to. Query matching is unchanged:
  // "out" still finds `outfit`, and now finds `outfit.SHOES` with it.
  const pool = trigger === "@"
    ? refSuggestions
    : expandVarsWithAxes(varSuggestions, varProducers);
  const needle = query.toLowerCase();
  const labelOf = trigger === "@"
    ? (uuid: string) => (uuidToName.get(uuid) ?? uuid).toLowerCase()
    : (name: string) => name.toLowerCase();
  return pool.filter((id) => labelOf(id).includes(needle));
}

/**
 * `@name` for a module that does not exist yet: the query when it is a plain
 * identifier that no library entry is called, else null. Choosing it inserts
 * an unresolved ref the user can repoint later.
 */
export function placeholderNameFor(
  query: string,
  uuidToName: ReadonlyMap<string, string>,
): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(query)) return null;
  const lower = query.toLowerCase();
  for (const name of uuidToName.values()) {
    if (name.toLowerCase() === lower) return null;
  }
  return query;
}

/**
 * Inline colour for a row's icon box, keyed on the module kind.
 *
 * Inline rather than a class per kind because the kind set is open — the map
 * in `kind-icons.ts` already grew a `loop` and a `category` — and a missing
 * class would silently fall back to an uncoloured box. A missing TOKEN falls
 * back to the accent instead, which still looks deliberate.
 */
export function kindTint(kind: string): Record<string, string> {
  const token = `--wp-kind-${kind === "fixed_values" ? "fixed" : kind}`;
  const colour = `var(${token}, var(--wp-accent-text, #a5b4fc))`;
  return {
    color: colour,
    background: `color-mix(in oklab, ${colour} 16%, transparent)`,
  };
}

/**
 * Tint for a `$` row, taken from the variable's own name.
 *
 * The assembler's variable strip sits a few pixels under this popover and
 * colours every name through `varColorClass` — same hash, eight buckets. The
 * popover painted each row by MODULE KIND instead, so the same `$quality` was
 * one colour in the list and another in the strip, and you could not match a
 * row to a chip by looking. `$` rows now take the variable's colour; `@` rows
 * keep `kindTint`, where the kind IS the identity of the thing being picked.
 *
 * The glyph shape still carries the kind, exactly as it does in the strip.
 */
export function varTint(name: string): Record<string, string> {
  const colour = `var(--wp-var-${varColorIndex(name)})`;
  return {
    color: colour,
    background: `color-mix(in oklab, ${colour} 16%, transparent)`,
  };
}

/** Whether a chip's axis is one its producer declares.
 *
 *  `undefined` means UNKNOWABLE, and that is the important case: a canvas node
 *  carries its own payload SNAPSHOT of a module, so a wildcard added before its
 *  group was promoted has `tag_groups` but no `tag_group_kinds` at all. That is
 *  indistinguishable from "declares no axes", and marking either as an error
 *  put a red squiggle under a reference that resolves perfectly well once the
 *  node's snapshot is refreshed.
 *
 *  So the warning is only claimed when the producer declares SOME axes and this
 *  is not among them — the one case where we actually know the read is wrong.
 */
export function axisKnownFor(atom: Atom, varProducers: AxisProducerMap | undefined): boolean | undefined {
  if (atom.kind !== "var" || !atom.axis) return undefined;
  // `.neg` is not an axis: every variable has negatives to read.
  if (atom.axis === NEG_ACCESSOR) return true;
  const axes = varProducers?.get(atom.name)?.axes;
  if (!axes || axes.length === 0) return undefined;
  return axes.some((a) => a.axis === atom.axis);
}

/**
 * Inline attributes for one `$name` run on the prompt-template surface.
 *
 * Colour comes from the same djb2 hash the assembler's variable strip uses, so
 * a name reads identically in the template, in the strip and in the `$`
 * popover. Inline rather than a class because `.wp-rt .wp-rt-var` already sets
 * a colour at higher specificity than the global `.var-N` palette.
 *
 * A name nothing upstream writes gets the danger colour and a wavy underline
 * instead. Losing the chip lost the one cue that separated a typo from a
 * working variable, and colour alone cannot carry it — every run is coloured.
 * Only claimed where the host actually walked a graph: in the SPA every var is
 * out of scope because there is no graph to be in.
 */
export function varSpanAttrsFor(
  name: string,
  graphAware: boolean,
  varSuggestions: readonly string[],
  varProducers: AxisProducerMap | undefined,
): string {
  // `name` arrives with any accessor attached (`outfit.SHOES`). Scope is a
  // property of the BASE variable, so checking the whole string flagged every
  // valid axis read as an unknown variable — a correct reference wearing the
  // error styling.
  // Parse through the ONE grammar. The old hand-rolled slice only stripped a
  // TRAILING index, so `outfit.0.SHOES` produced axis "0.SHOES" — no such axis
  // declared, so a perfectly valid index-first reference got the unknown-axis
  // warning. That is the wavy underline the assembler template showed.
  const { base, axis = "" } = varAccessorParts(name);
  if (graphAware && axis && axis !== NEG_ACCESSOR) {
    // The base resolves but the axis does not: the engine renders that as an
    // empty string, so without a mark the only symptom is a missing word.
    // Only claimed when the producer declares SOME axes — see `axisKnownFor`
    // for why an empty list has to stay silent.
    const known = varProducers?.get(base)?.axes;
    const declared = (known ?? []).some((a) => a.axis === axis);
    if (known && known.length > 0 && varSuggestions.includes(base) && !declared) {
      return ' style="color:var(--wp-warn,#f59e0b);'
        + "text-decoration:underline wavy color-mix(in srgb,var(--wp-warn,#f59e0b) 70%,transparent);"
        + 'text-underline-offset:3px;text-decoration-thickness:1px"';
    }
  }
  if (graphAware && !varSuggestions.includes(base)) {
    return ' style="color:var(--wp-danger,#ef4444);'
      + "text-decoration:underline wavy color-mix(in srgb,var(--wp-danger,#ef4444) 70%,transparent);"
      + 'text-underline-offset:3px;text-decoration-thickness:1px"';
  }
  return ` style="color:var(--wp-var-${varColorIndex(base)})"`;
}
