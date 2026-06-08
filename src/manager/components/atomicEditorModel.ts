import { tokenizeRich } from "../../widgets/richTokenize";

export interface TextAtom { kind: "text"; text: string }
/** RefAtom — `@{uuid[#name][:subcat,subcat...]}` token.
 *
 * `name` is the cached display label captured at chip-insert time
 * (or parsed from an existing token's `#name` segment). Resolver
 * matches on uuid only; the field is preserved so a broken ref still
 * tells the user what the wildcard was last called. Empty/missing
 * means the token round-trips as bare-uuid form. */
export interface RefAtom {
  kind: "ref";
  uuid: string;
  subCategories: string[];
  name?: string;
}
export interface VarAtom {
  kind: "var";
  name: string;
  /** SP2a list accessor: `$name.K` -> 0-based index K (omitted when absent). */
  index?: number;
}
export type Atom = TextAtom | RefAtom | VarAtom;

export function parse(text: string): Atom[] {
  if (!text) return [];
  const tokens = tokenizeRich(text);
  const out: Atom[] = [];
  let textBuf = "";
  const flush = () => {
    if (textBuf.length > 0) {
      out.push({ kind: "text", text: textBuf });
      textBuf = "";
    }
  };
  for (const tok of tokens) {
    if (tok.kind === "ref") {
      flush();
      const meta = tok.meta as { uuid?: string; name?: string; sub_categories?: string[] } | undefined;
      const uuid = meta?.uuid ?? "";
      const subRaw = meta?.sub_categories;
      const refAtom: RefAtom = {
        kind: "ref",
        uuid,
        subCategories: Array.isArray(subRaw) ? subRaw : [],
      };
      if (typeof meta?.name === "string" && meta.name.length > 0) {
        refAtom.name = meta.name;
      }
      out.push(refAtom);
    } else if (tok.kind === "var") {
      flush();
      const meta = tok.meta as { name?: string; index?: number } | undefined;
      const varAtom: VarAtom = { kind: "var", name: meta?.name ?? "" };
      if (typeof meta?.index === "number") varAtom.index = meta.index;
      out.push(varAtom);
    } else {
      // text / escape / dp-* — collapse back into the running text buffer
      textBuf += tok.raw;
    }
  }
  flush();
  return out;
}

export function serialise(atoms: Atom[]): string {
  let out = "";
  for (const a of atoms) {
    if (a.kind === "text") out += a.text;
    else if (a.kind === "var") out += "$" + a.name + (a.index != null ? "." + a.index : "");
    else if (a.kind === "ref") {
      out += "@{" + a.uuid;
      if (a.name && a.name.length > 0) out += "#" + a.name;
      if (a.subCategories.length > 0) out += ":" + a.subCategories.join(",");
      out += "}";
    }
  }
  return out;
}

export interface Cursor {
  /** Index into the atoms[] array. Text atoms own their offset; non-text
   *  atoms are entered/exited via offset 0 only. */
  atomIndex: number;
  /** Char offset inside a text atom. 0 for non-text atoms. */
  offset: number;
}

export interface EditResult { atoms: Atom[]; cursor: Cursor }

/** Merge consecutive text atoms so the model invariant ("no adjacent text
 *  atoms") stays true after every operation. */
function normalise(atoms: Atom[]): Atom[] {
  const out: Atom[] = [];
  for (const a of atoms) {
    const last = out[out.length - 1];
    if (a.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + a.text };
    } else if (a.kind === "text" && a.text.length === 0) {
      // Drop empty text atoms — they confuse cursor arithmetic.
      continue;
    } else {
      out.push(a);
    }
  }
  return out;
}

export function insertText(atoms: Atom[], cur: Cursor, text: string): EditResult {
  if (!text) return { atoms, cursor: cur };
  const next = atoms.map((a) => ({ ...a }));
  const target = next[cur.atomIndex];
  if (target?.kind === "text") {
    next[cur.atomIndex] = {
      kind: "text",
      text: target.text.slice(0, cur.offset) + text + target.text.slice(cur.offset),
    };
    return {
      atoms: normalise(next),
      cursor: { atomIndex: cur.atomIndex, offset: cur.offset + text.length },
    };
  }
  // Cursor is at a non-text atom boundary — splice in a fresh text atom.
  next.splice(cur.atomIndex, 0, { kind: "text", text });
  return {
    atoms: normalise(next),
    cursor: { atomIndex: cur.atomIndex + 1, offset: 0 },
  };
}

export function insertAtom(atoms: Atom[], cur: Cursor, atom: Atom): EditResult {
  const next = atoms.map((a) => ({ ...a }));
  const target = next[cur.atomIndex];
  if (target?.kind === "text") {
    // Split the host text atom around the insertion point.
    const before = target.text.slice(0, cur.offset);
    const after = target.text.slice(cur.offset);
    next.splice(cur.atomIndex, 1,
      { kind: "text", text: before },
      atom,
      { kind: "text", text: after },
    );
  } else {
    next.splice(cur.atomIndex, 0, atom);
  }
  const normalised = normalise(next);
  // Locate the inserted atom by object identity — normalise only mutates
  // text atoms, so the original `atom` reference survives unchanged.
  const insertedIdx = normalised.indexOf(atom);
  return {
    atoms: normalised,
    cursor: { atomIndex: insertedIdx + 1, offset: 0 },
  };
}

export function deleteBackward(atoms: Atom[], cur: Cursor): EditResult {
  if (atoms.length === 0) return { atoms, cursor: cur };
  const next = atoms.map((a) => ({ ...a }));
  const target = next[cur.atomIndex];
  if (target?.kind === "text" && cur.offset > 0) {
    next[cur.atomIndex] = {
      kind: "text",
      text: target.text.slice(0, cur.offset - 1) + target.text.slice(cur.offset),
    };
    return {
      atoms: normalise(next),
      cursor: { atomIndex: cur.atomIndex, offset: cur.offset - 1 },
    };
  }
  // At offset 0 (or non-text) — delete the previous atom entirely.
  if (cur.atomIndex === 0) return { atoms, cursor: cur };
  const prevIdx = cur.atomIndex - 1;
  const removed = next[prevIdx];
  // If the removed atom sat between two text atoms, normalise will merge them
  // and the cursor should land at the boundary inside the merged atom.
  const beforeRemoved = prevIdx > 0 ? next[prevIdx - 1] : undefined;
  const afterRemoved = next[cur.atomIndex];
  next.splice(prevIdx, 1);
  const normalised = normalise(next);
  if (normalised.length === 0) return { atoms: normalised, cursor: { atomIndex: 0, offset: 0 } };
  // Case: removed atom was a non-text sentinel between two text atoms → they merged.
  if (
    removed && removed.kind !== "text" &&
    beforeRemoved?.kind === "text" &&
    afterRemoved?.kind === "text"
  ) {
    return {
      atoms: normalised,
      cursor: { atomIndex: prevIdx - 1, offset: beforeRemoved.text.length },
    };
  }
  // Otherwise: land cursor at the end of the atom now at prevIdx.
  const landing = normalised[prevIdx];
  if (landing?.kind === "text") {
    return { atoms: normalised, cursor: { atomIndex: prevIdx, offset: landing.text.length } };
  }
  return { atoms: normalised, cursor: { atomIndex: prevIdx + 1, offset: 0 } };
}

export function replaceAtom(atoms: Atom[], atomIndex: number, atom: Atom): Atom[] {
  if (atomIndex < 0 || atomIndex >= atoms.length) return atoms;
  const next = atoms.map((a) => ({ ...a }));
  next[atomIndex] = atom;
  return normalise(next);
}
