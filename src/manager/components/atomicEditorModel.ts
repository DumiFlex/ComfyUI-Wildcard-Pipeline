import { tokenizeRich, type RichToken } from "../../widgets/richTokenize";

export interface TextAtom {
  kind: "text";
  text: string;
  /** SP2b: set when this text atom is brace-block scaffolding (the braces,
   *  count, `$$sep$$`, pipes, and literal arms of a `{…}` block). Drives the
   *  block-colour highlight — "alt" (amber `{a|b}`) or "multi" (green
   *  `{N$$…}`). Absent for ordinary text. Ignored by serialise. */
  blockColor?: "alt" | "multi";
}
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

/** Build a chip atom (ref/var) from a token, or null for any other kind.
 *  Shared by the top-level scan and the SP2b per-branch block decomposition. */
function tokenToChipAtom(tok: RichToken): RefAtom | VarAtom | null {
  if (tok.kind === "ref") {
    const meta = tok.meta as { uuid?: string; name?: string; sub_categories?: string[] } | undefined;
    const refAtom: RefAtom = {
      kind: "ref",
      uuid: meta?.uuid ?? "",
      subCategories: Array.isArray(meta?.sub_categories) ? meta.sub_categories : [],
    };
    if (typeof meta?.name === "string" && meta.name.length > 0) refAtom.name = meta.name;
    return refAtom;
  }
  if (tok.kind === "var") {
    const meta = tok.meta as { name?: string; index?: number } | undefined;
    const varAtom: VarAtom = { kind: "var", name: meta?.name ?? "" };
    if (typeof meta?.index === "number") varAtom.index = meta.index;
    return varAtom;
  }
  return null;
}

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
    const chip = tok.kind === "ref" || tok.kind === "var" ? tokenToChipAtom(tok) : null;
    if (chip) {
      flush();
      out.push(chip);
    } else if (tok.kind === "dp-multi" || tok.kind === "dp-brace") {
      // SP2b: decompose a brace block into scaffolding-text (block-coloured) +
      // inner chip atoms instead of one opaque text atom. The scaffolding
      // (braces / count / `$$sep$$` / pipes / literal arms) carries blockColor;
      // a lone ref/var arm becomes the chip it would be standalone. Serialise
      // (concatenation) reconstructs the original `{…}` string exactly.
      flush();
      const color: "alt" | "multi" = tok.kind === "dp-multi" ? "multi" : "alt";
      const m = (tok.meta ?? {}) as {
        branches?: string[]; min?: number; max?: number;
        independent?: boolean; sep?: string; count?: number;
      };
      const branches = Array.isArray(m.branches) ? m.branches : [];
      let prefix: string;
      if (tok.kind === "dp-multi") {
        const cmin = m.min ?? m.count ?? 0;
        const cmax = m.max ?? m.count ?? 0;
        const countStr = cmin === cmax ? String(cmin) : `${cmin}-${cmax}`;
        prefix = `{${countStr}${m.independent ? "~" : ""}$$${m.sep ?? ""}$$`;
      } else {
        prefix = "{";
      }
      out.push({ kind: "text", text: prefix, blockColor: color });
      branches.forEach((branch, bi) => {
        if (bi > 0) out.push({ kind: "text", text: "|", blockColor: color });
        const bt = tokenizeRich(branch);
        const inner = bt.length === 1 ? tokenToChipAtom(bt[0]) : null;
        if (inner) out.push(inner);
        else out.push({ kind: "text", text: branch, blockColor: color });
      });
      out.push({ kind: "text", text: "}", blockColor: color });
    } else {
      // text / escape / dp-pipe / dp-weight — collapse into the running buffer
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
