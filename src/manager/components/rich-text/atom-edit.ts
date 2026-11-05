/**
 * Pure edit operations for `RichTextInput`: raw-text splices, atom-direct
 * deletion and block re-colouring. All offsets are in the serialised raw-text
 * space (`serialiseAtomsLocal`), the same space the component's caret mapping
 * produces. DOM-free.
 */
import type { Atom } from "../atomicEditorModel";
import { tokenizeRich } from "../../../widgets/richTokenize";
import { serialiseAtomsLocal, ZWSP, ZWSP_RE } from "./ref-atoms";

/** Delete the raw-text span `[delStart, delEnd)` directly off a live atom
 *  list — WITHOUT re-tokenizing. This is what keeps chip formation off the
 *  delete path: text atoms are sliced char-exact; a chip is one cursor stop,
 *  so any overlap removes the WHOLE chip (the span widens to chip
 *  boundaries). No `parse`/`parseForSurface` runs, so raw text that merely
 *  looks like a chip (`$mood`, `$mood.`) survives a Backspace as plain text.
 *
 *  Offsets are in the same serialised raw-text space `rangeOffsetToRaw`
 *  produces (chip length = `serialiseAtomsLocal([atom]).length`), so the
 *  caret arithmetic lines up. Returns the new atom list plus the caret
 *  offset to restore (the start of the deleted span, widened to a chip
 *  boundary when a chip was removed). */
export function deleteRawRange(
  live: Atom[],
  delStart: number,
  delEnd: number,
): { atoms: Atom[]; caret: number } {
  const spans: { atom: Atom; start: number; end: number }[] = [];
  let cursor = 0;
  for (const atom of live) {
    const len = serialiseAtomsLocal([atom]).length;
    spans.push({ atom, start: cursor, end: cursor + len });
    cursor += len;
  }
  // Widen the deletion span to fully cover any chip it partially intersects —
  // chips can't be half-deleted.
  let lo = delStart;
  let hi = delEnd;
  for (const s of spans) {
    if (s.atom.kind === "text") continue;
    if (s.start < hi && s.end > lo) {
      lo = Math.min(lo, s.start);
      hi = Math.max(hi, s.end);
    }
  }
  const out: Atom[] = [];
  const pushAtom = (a: Atom): void => {
    const last = out[out.length - 1];
    if (a.kind === "text" && last && last.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + a.text };
    } else {
      out.push(a);
    }
  };
  for (const s of spans) {
    const atom = s.atom;
    if (s.end <= lo || s.start >= hi) {
      pushAtom(atom); // fully outside the deletion span — keep as-is
      continue;
    }
    if (atom.kind === "text") {
      const cutFrom = Math.max(0, lo - s.start);
      const cutTo = Math.min(atom.text.length, hi - s.start);
      const kept = atom.text.slice(0, cutFrom) + atom.text.slice(cutTo);
      if (kept.length > 0) pushAtom({ kind: "text", text: kept });
      continue;
    }
    // Chip fully covered by [lo, hi) (widened above) — drop it.
  }
  return { atoms: out, caret: lo };
}

/** Re-derive brace-block scaffolding colour from the CURRENT serialised text,
 *  WITHOUT chipifying (chips are left exactly as-is, so Wave-5's "never
 *  chipify on delete" holds). Used after an atom-direct edit so the amber/green
 *  colour tracks the live text: a still-valid block keeps its colour, and
 *  breaking a block — deleting its `{`/`}`/`|` or the `$$` delimiter — drops it.
 *  Text atoms are split at block-token boundaries so a span straddling a block
 *  edge (the atom-direct read merges adjacent text) colours each side right. */
export function recolorBlocks(list: Atom[]): Atom[] {
  const text = serialiseAtomsLocal(list);
  if (!text) return list;
  const colorAt: Array<"alt" | "multi" | null> = new Array(text.length).fill(null);
  for (const tok of tokenizeRich(text)) {
    const c = tok.kind === "dp-multi" ? "multi" : tok.kind === "dp-brace" ? "alt" : null;
    if (!c) continue;
    for (let k = tok.start; k < tok.end; k++) colorAt[k] = c;
  }
  const out: Atom[] = [];
  const pushText = (t: string, bc: "alt" | "multi" | null): void => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text" && (last.blockColor ?? null) === bc) {
      out[out.length - 1] = bc
        ? { kind: "text", text: last.text + t, blockColor: bc }
        : { kind: "text", text: last.text + t };
    } else {
      out.push(bc ? { kind: "text", text: t, blockColor: bc } : { kind: "text", text: t });
    }
  };
  let off = 0;
  for (const a of list) {
    const len = serialiseAtomsLocal([a]).length;
    if (a.kind === "text") {
      let i = 0;
      while (i < a.text.length) {
        const c = colorAt[off + i] ?? null;
        let j = i + 1;
        while (j < a.text.length && (colorAt[off + j] ?? null) === c) j++;
        pushText(a.text.slice(i, j), c);
        i = j;
      }
    } else {
      out.push(a);
    }
    off += len;
  }
  return out;
}

/** True when going from `cur` to `next` would ADD or REMOVE atom nodes, or
 *  flip an atom between its chip and its text branch.
 *
 *  Those are exactly the renders that make Vue insert or unmount list items,
 *  and therefore the only ones that touch a fragment anchor. A same-shape
 *  apply patches text and props in place and cannot trip over a missing one,
 *  which is what keeps ordinary typing on the cheap path. */
export function isStructuralChange(cur: Atom[], next: Atom[]): boolean {
  if (cur.length !== next.length) return true;
  return cur.some((atom, i) => (atom.kind === "text") !== (next[i].kind === "text"));
}

/** Result of a raw-text splice: the new value and where the caret goes. */
export interface Splice {
  text: string;
  caret: number;
}

/** Splice a chip's serialised text over the typed trigger fragment.
 *
 *  Strips the typed trigger fragment (`@col`, `$per`) before inserting the
 *  chip. `trigStart` holds the raw-text offset of the trigger `@` / `$`; the
 *  slice [trigStart, caret] is the trigger + typed query text.
 *
 *  Defensive scan-backward: if `trigStart` is unset (-1) OR doesn't point
 *  at a valid trigger character, re-derive it by scanning back from the
 *  caret for a `$<ident>` or `@<ident>` run. Catches event-order races where
 *  Enter fires before the autocomplete probe has seen the latest text, AND
 *  the test-seam path where apply runs without ever calling the probe.
 *  Without this, the previously-typed `$testo` would survive alongside the
 *  freshly-inserted chip. */
export function spliceAtTrigger(
  text: string,
  caret: number,
  trigStart: number,
  chipText: string,
): Splice {
  let cutFrom = trigStart >= 0 ? Math.min(trigStart, caret) : caret;
  const cutChar = text[cutFrom];
  if (cutChar !== "$" && cutChar !== "@") {
    const head = text.slice(0, caret);
    // Match a trailing trigger + typed query. `$ident` / `@ident` /
    // `@{partial-uuid` cases. Falls back to no-op (cutFrom unchanged)
    // when no pattern matches.
    const m = head.match(/[$@](?:[A-Za-z_][A-Za-z0-9_]*|\{[0-9a-fA-F:,_ -]*\}?)?$/);
    if (m) cutFrom = head.length - m[0].length;
  }
  const before = text.slice(0, cutFrom);
  const after = text.slice(caret);
  return { text: before + chipText + after, caret: (before + chipText).length };
}

/** Splice a plain word (booru tag / model path) over the word being typed,
 *  which starts at `wordStart` (or at the caret when unset). Unlike
 *  `spliceAtTrigger` there is no backwards `$`/`@` scan — that is exactly
 *  wrong for a sigil-less word and would cut from the wrong place. */
export function spliceWord(text: string, caret: number, wordStart: number, word: string): Splice {
  const from = wordStart >= 0 ? Math.min(wordStart, caret) : caret;
  const before = text.slice(0, from);
  return { text: before + word + text.slice(caret), caret: (before + word).length };
}

/** Insert `insert` at `caret`, separating it from its neighbours with one
 *  space on each side that isn't already whitespace.
 *
 *  The trailing space is not cosmetic: inserting `$mood` before the word
 *  `portrait` would otherwise yield `$moodportrait`, which re-parses as a
 *  variable named `moodportrait`. The caret sits after the token, before the
 *  trailing space, so the user can keep typing the token. */
export function spliceSpaced(current: string, caret: number, insert: string): Splice {
  const before = current.slice(0, caret);
  const after = current.slice(caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  return {
    text: before + `${lead}${insert}${trail}` + after,
    caret: before.length + lead.length + insert.length,
  };
}

/** Replace the raw range `[start, end)` with `insert`. */
export function spliceRange(current: string, start: number, end: number, insert: string): Splice {
  const before = current.slice(0, start);
  return { text: before + insert + current.slice(end), caret: (before + insert).length };
}

/** Clipboard text made safe to paste: render-only ZWSP caret pads are
 *  stripped, and single-line fields fold newline runs into one space. */
export function cleanPastedText(data: string, multiline: boolean): string {
  const clean = data.replace(ZWSP_RE, "");
  return multiline ? clean : clean.replace(/[\r\n]+/g, " ");
}

/** Length of `s` with render-only ZWSP pads removed. */
export function visibleLength(s: string): number {
  return s.replace(ZWSP_RE, "").length;
}

/** Index into `raw` (which may contain ZWSP pads) after `visible` visible
 *  characters, skipping any pads that follow so the caret lands on real text. */
export function rawIndexForVisible(raw: string, visible: number): number {
  let pos = 0;
  let seen = 0;
  while (pos < raw.length && seen < visible) {
    if (raw[pos] !== ZWSP) seen++;
    pos++;
  }
  while (pos < raw.length && raw[pos] === ZWSP) pos++;
  return pos;
}
