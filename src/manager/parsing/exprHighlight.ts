/**
 * Token colouring for the sub-category filter expression.
 *
 * A filter expression mixes three things that read very differently — the tags
 * you are selecting, the boolean operators joining them, and the parens that
 * group them — and as flat monospace text they all look identical. Colouring
 * them makes the structure of `(warm or cool) and not vivid` legible at a
 * glance, and makes an unknown term visible AS you type it rather than after
 * the validator has finished the sentence.
 *
 * Deliberately its own scanner rather than a reuse of the parser's: this must
 * tokenize text that does NOT parse (that is the whole point of marking a bad
 * term), and it must preserve every space verbatim, because the output is
 * rendered behind a textarea and has to line up with it character for
 * character.
 */

export type ExprTokenKind =
  /** `and` / `or` / `not`. */
  | "op"
  /** `(` or `)`. */
  | "paren"
  /** A tag the wildcard declares. */
  | "term"
  /** A word that is not an operator and not a declared tag. */
  | "bad"
  /** Runs of whitespace, kept verbatim so the mirror aligns with the input. */
  | "space";

export interface ExprToken {
  text: string;
  kind: ExprTokenKind;
}

const OPERATORS = new Set(["and", "or", "not"]);

/**
 * Split `src` into coloured tokens.
 *
 * Every character of the input appears in exactly one token, in order, so
 * joining the texts reproduces the source exactly — the invariant the mirror
 * alignment depends on.
 */
export function highlightExpression(src: string, known: ReadonlySet<string>): ExprToken[] {
  const out: ExprToken[] = [];
  // Whitespace | paren | word (tags may contain - and _) | any other single
  // char, so stray punctuation still lands in a token rather than vanishing.
  const scanner = /(\s+)|([()])|([\w-]+)|([^\s()\w-])/g;
  let m: RegExpExecArray | null;
  while ((m = scanner.exec(src)) !== null) {
    if (m[1] !== undefined) {
      out.push({ text: m[1], kind: "space" });
    } else if (m[2] !== undefined) {
      out.push({ text: m[2], kind: "paren" });
    } else if (m[3] !== undefined) {
      const word = m[3];
      if (OPERATORS.has(word.toLowerCase())) out.push({ text: word, kind: "op" });
      else out.push({ text: word, kind: known.has(word) ? "term" : "bad" });
    } else {
      // Not valid in an expression, so it reads as bad rather than as text.
      out.push({ text: m[4], kind: "bad" });
    }
  }
  return out;
}
