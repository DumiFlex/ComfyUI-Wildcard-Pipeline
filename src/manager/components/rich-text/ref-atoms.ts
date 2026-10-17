/**
 * Pure atom-stream helpers for `RichTextInput`: the 4-segment nested-ref view,
 * the padded-atoms invariant and the surface-aware parse. DOM-free.
 *
 * --- 4-segment nested-ref serialization (SP1, §3.2) ---
 *
 * The canonical ref form is `@{uuid[#name][:expr][!null]}` — a boolean
 * sub-category EXPRESSION after `:` (not a comma list) plus a trailing
 * `!null` exclude-null marker. The shared `atomicEditorModel` /
 * `richTokenize` layer still models a ref's `:`-segment as the legacy
 * `subCategories: string[]` (comma-split). Rather than fork that shared
 * layer, RichTextInput owns the 4-segment view locally:
 *
 *   - The atom STREAM (text/var/ref boundaries) still comes from
 *     `atomicEditorModel.parse` — the legacy regex's `:` group is
 *     `[^}]*`, so it still captures the full `expr!null` body and the
 *     token boundary (`}`) stays correct. Only the INTERPRETATION of
 *     that body changed.
 *   - `refFilterOf` reconstructs the raw `:`-body from `subCategories`
 *     (join on `,` is loss-free for the comma-OR shorthand) and peels a
 *     trailing `!null` into the `excludeNull` flag, yielding `{expr,
 *     excludeNull}`. A freshly-applied filter stashes those on the atom
 *     directly (extra fields survive `replaceAtom`'s shallow clone), so
 *     the live edit round-trips without going through the lossy
 *     comma-split.
 *   - `serialiseAtomsLocal` emits the 4-segment form, omitting each
 *     segment when empty. It replaces `atomicEditorModel.serialise`
 *     everywhere RichTextInput needs raw text (emit value + caret-length
 *     math) so `!null` + multi-word expressions survive round-trips.
 */
import { parse, serialiseVarAtom, type Atom, type RefAtom } from "../atomicEditorModel";
import { splitRefFilter } from "../../../widgets/richTokenize";

// Zero-width space rendered inside empty pad spans. Browsers can't reliably
// land the caret inside a span that has no child text node (the kind Vue
// emits for `{{ '' }}`) — clicking "after the last chip" then drops the
// caret BEFORE the chip and subsequent typing inserts on the wrong side.
// A single ZWSP gives the span a text node the caret can sit in, while
// staying visually invisible. The read-side paths strip it back out so it
// never reaches modelValue.
export const ZWSP = "​";
export const ZWSP_RE = /​/g;

/** A ref's filter, lifted out of the legacy `subCategories` list. */
export interface RefFilter {
  /** Boolean sub-category expression (the `:` segment). Empty = none. */
  expr: string;
  /** Exclude-null flag (the trailing `!null` segment). */
  excludeNull: boolean;
}

/** Ref atom augmented with the 4-segment filter view. The extra fields
 *  are optional so a plain `RefAtom` (e.g. fresh from `atomicEditorModel
 *  .parse`) is assignable; `refFilterOf` falls back to reconstructing
 *  them from `subCategories` when absent. */
export type RefAtomX = RefAtom & Partial<RefFilter>;

/** Peel a trailing `!null` marker off a raw `:`-segment body, returning
 *  the pure expression + the exclude-null flag. `@{uuid:warm!null}` →
 *  `{ expr: "warm", excludeNull: true }`. The `!null` must be the whole
 *  trailing segment (the name/expr captures exclude `!`, so a `!` can
 *  only introduce the null marker). */
export function splitColonBody(body: string): RefFilter {
  // Delegate to the single-source peel in richTokenize so the editor,
  // RefChip, and the canvas OptionRow can never drift on `!null` handling.
  return splitRefFilter(body);
}

/** The 4-segment filter for a ref atom. Prefers explicit `expr` /
 *  `excludeNull` (set by a live picker apply); otherwise reconstructs
 *  from the legacy `subCategories` body. */
export function refFilterOf(atom: RefAtomX): RefFilter {
  if (atom.expr !== undefined || atom.excludeNull !== undefined) {
    return { expr: atom.expr ?? "", excludeNull: atom.excludeNull ?? false };
  }
  if (atom.subCategories.length === 0) return { expr: "", excludeNull: false };
  return splitColonBody(atom.subCategories.join(","));
}

/** Serialize one ref atom to the canonical `@{uuid[#name][:expr][!null]}`
 *  form, omitting each absent segment. */
export function serialiseRefAtom(atom: RefAtomX): string {
  let out = "@{" + atom.uuid;
  if (atom.name && atom.name.length > 0) out += "#" + atom.name;
  const { expr, excludeNull } = refFilterOf(atom);
  if (expr.length > 0) out += ":" + expr;
  if (excludeNull) out += "!null";
  out += "}";
  return out;
}

/** Local replacement for `atomicEditorModel.serialise` that emits the
 *  4-segment ref form. Text / var atoms serialize identically. */
export function serialiseAtomsLocal(atoms: Atom[]): string {
  let out = "";
  for (const a of atoms) {
    if (a.kind === "text") out += a.text;
    else if (a.kind === "var") out += serialiseVarAtom(a);
    else out += serialiseRefAtom(a);
  }
  return out;
}

/** Template-safe filter accessor: returns the `{expr, excludeNull}` for
 *  a ref atom, or empty defaults for any other atom kind. Lets the
 *  RefChip binding stay terse without narrowing the union inline. */
export function chipFilterOf(atom: Atom): RefFilter {
  return atom.kind === "ref"
    ? refFilterOf(atom)
    : { expr: "", excludeNull: false };
}

/** Padded-atoms invariant.
 *
 *  The contenteditable host needs a `wp-rt__text` span at every position
 *  where the user might land their caret — otherwise browsers insert
 *  user-typed characters as raw text nodes directly under the host,
 *  bypassing Vue's render tracking. Without padding, Vue's v-for diff
 *  can't reconcile against the orphan text node and subsequent
 *  programmatic inserts fail to display.
 *
 *  Invariant after this normaliser:
 *    - list is never empty (minimum `[{text:""}]`)
 *    - first atom is a text atom
 *    - last atom is a text atom
 *    - no two adjacent chip atoms (text gaps in between)
 *
 *  `serialise` correctly drops empty text contributions, so the raw
 *  string round-trip is preserved.
 */
export function padAtoms(list: Atom[]): Atom[] {
  if (list.length === 0) return [{ kind: "text", text: "" }];
  const out: Atom[] = [];
  if (list[0].kind !== "text") out.push({ kind: "text", text: "" });
  for (let i = 0; i < list.length; i++) {
    out.push(list[i]);
    const next = list[i + 1];
    const cur = list[i];
    if (cur.kind !== "text" && (!next || next.kind !== "text")) {
      out.push({ kind: "text", text: "" });
    }
  }
  return out;
}

/** Lift a freshly-parsed ref atom into the 4-segment view (§3.2).
 *
 *  The shared tokenizer (`richTokenize`) still models the ref body as
 *  the legacy `subCategories` list and its name capture does not exclude
 *  `!`. So for the exclude-null-only form `@{uuid#name!null}` the `!null`
 *  leaks into `name` (no `:` to stop the name group), and for the
 *  `:expr!null` form the marker lands at the tail of the (comma-joined)
 *  body. Both are reconciled here: peel a trailing `!…` off whichever
 *  segment carries it, yielding a clean `name` + explicit `{expr,
 *  excludeNull}`. Storing the explicit fields means later `refFilterOf`
 *  reads them directly rather than re-deriving from the lossy body. */
export function chipRefAtom(atom: RefAtom): RefAtomX {
  let name = atom.name;
  // Body the legacy parser captured for the `:` segment (loss-free for
  // the comma-OR shorthand).
  const body = atom.subCategories.join(",");
  // Exclude-null marker leaked into the name (no `:expr` present).
  if (body.length === 0 && name && name.includes("!")) {
    const bang = name.indexOf("!");
    const tail = name.slice(bang + 1);
    name = name.slice(0, bang);
    const cleaned: RefAtomX = {
      kind: "ref",
      uuid: atom.uuid,
      subCategories: [],
      expr: "",
      excludeNull: tail === "null",
    };
    if (name.length > 0) cleaned.name = name;
    return cleaned;
  }
  const { expr, excludeNull } = splitColonBody(body);
  const cleaned: RefAtomX = {
    kind: "ref",
    uuid: atom.uuid,
    subCategories: [],
    expr,
    excludeNull,
  };
  if (name && name.length > 0) cleaned.name = name;
  return cleaned;
}

/** Parse with surface-aware atom filtering.
 *
 *  `$name` is always literal text in the atom stream; `@{uuid}` refs
 *  chipify only when `refsEnabled` (the `wildcard` surface, or a host
 *  that opted in via `allowNestedRefs`), otherwise they collapse back to
 *  literal text too.
 *
 *  Adjacent text atoms produced by the collapse are merged so the
 *  padAtoms invariant ("no adjacent text atoms") still holds. */
export function parseForSurface(text: string, refsEnabled: boolean): Atom[] {
  const atoms = parse(text);
  // `$name` is always literal text in the atom stream: coloured where the
  // surface reads vars (`flatVars`), plain where it produces them (wildcard,
  // fixed_values). An atomic chip in prose behaved like an object: one
  // Backspace deleted the whole token and the caret could not enter it.
  const collapseSet: Set<"var" | "ref"> = new Set(["var", "ref"]);
  // Action-value derivation inputs (allowNestedRefs) chipify `@{}` refs like
  // the wildcard surface does — drop `ref` from the collapse set so they
  // settle into chips instead of staying literal text.
  if (refsEnabled) collapseSet.delete("ref");
  const out: Atom[] = [];
  for (const a of atoms) {
    if ((a.kind === "var" || a.kind === "ref") && collapseSet.has(a.kind)) {
      // Re-serialise back to raw text and merge into adjacent text.
      // Refs use the 4-segment form so a collapsed-surface round-trip
      // keeps `:expr` + `!null` intact (legacy comma body reconstructs
      // loss-free via `refFilterOf`).
      const raw = a.kind === "var" ? serialiseVarAtom(a) : serialiseRefAtom(a);
      const last = out[out.length - 1];
      if (last && last.kind === "text") {
        // A collapsed arm folds into its surrounding run and inherits that
        // run's blockColor (SP2b: a brace-block arm stays block-coloured even
        // when the surface renders it as literal scaffolding text).
        out[out.length - 1] = last.blockColor
          ? { kind: "text", text: last.text + raw, blockColor: last.blockColor }
          : { kind: "text", text: last.text + raw };
      } else {
        out.push({ kind: "text", text: raw });
      }
      continue;
    }
    // Chipified ref → lift into the 4-segment `{expr, excludeNull}` view
    // so the filter survives the next round-trip without re-deriving
    // from the lossy legacy body.
    if (a.kind === "ref") {
      out.push(chipRefAtom(a));
      continue;
    }
    const last = out[out.length - 1];
    // Only merge text atoms that share a blockColor — fusing a block's
    // scaffolding ("multi"/"alt") with adjacent plain text (undefined) would
    // bleed the block colour onto prose between two blocks (`{a|b} x {c|d}`).
    if (a.kind === "text" && last && last.kind === "text" && last.blockColor === a.blockColor) {
      out[out.length - 1] = a.blockColor
        ? { kind: "text", text: last.text + a.text, blockColor: a.blockColor }
        : { kind: "text", text: last.text + a.text };
    } else {
      out.push(a);
    }
  }
  return out;
}
