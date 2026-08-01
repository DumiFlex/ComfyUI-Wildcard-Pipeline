/**
 * How each sub-category tag currently participates in a filter expression, and
 * whether it can match anything at all.
 *
 * Drives the palette chips' three visual states. Derived from the PARSED AST
 * rather than from what the user clicked, so the chips stay honest when the
 * expression is typed, pasted, or edited by hand — the palette is a view of
 * the expression, never a second source of truth for it.
 */
import type { Ast } from "./subcatFilter";

export type TermState =
  /** Not mentioned in the expression. */
  | "idle"
  /** Mentioned, and reachable without a `not` above it. */
  | "in"
  /** Mentioned only under a `not` — it excludes rather than includes. */
  | "negated"
  /** Declared by the wildcard, but carried by ZERO of its options. Offerable
   *  and guaranteed to match nothing — the shape of the bug that prompted all
   *  of this, so it gets its own state rather than looking selectable. */
  | "dead";

/**
 * Walk the AST collecting each tag with the parity of the `not`s above it.
 *
 * A tag can appear both ways (`warm or not warm`), which is legal if useless.
 * Positive wins for display: the chip reads as "participating", and the
 * negation is still visible in the expression itself.
 */
export function collectTermPolarity(ast: Ast | null): Map<string, "pos" | "neg"> {
  const out = new Map<string, "pos" | "neg">();
  const walk = (node: Ast | null, negated: boolean): void => {
    if (!node) return;
    if ("tag" in node) {
      const prev = out.get(node.tag);
      const here = negated ? "neg" : "pos";
      // Positive is sticky — a tag that appears positively anywhere is
      // participating, whatever else the expression does with it.
      if (prev !== "pos") out.set(node.tag, here);
      return;
    }
    if ("op" in node && node.op === "not") {
      walk(node.x, !negated);
      return;
    }
    if ("op" in node) for (const kid of node.kids) walk(kid, negated);
  };
  walk(ast, false);
  return out;
}

/** Tags carried by at least one option — anything else can never match. */
export function livingTags(optionTagSets: readonly (readonly string[])[]): Set<string> {
  const live = new Set<string>();
  for (const tags of optionTagSets) for (const t of tags) live.add(t);
  return live;
}

/**
 * Resolve one tag's chip state.
 *
 * `dead` outranks `idle` but NOT `in` / `negated`: a tag the user has already
 * put in the expression should show what the expression does with it, even if
 * it matches nothing — the zero-match warning covers that case separately, and
 * two alarms for one mistake is noise.
 */
export function termState(
  tag: string,
  polarity: Map<string, "pos" | "neg">,
  live: Set<string>,
): TermState {
  const p = polarity.get(tag);
  if (p === "pos") return "in";
  if (p === "neg") return "negated";
  return live.has(tag) ? "idle" : "dead";
}

/**
 * Closest known term to a mistyped one, for the validator's did-you-mean.
 *
 * Plain Levenshtein with a distance cap proportional to the word's length, so
 * `colde`→`cold` is offered but `warm`→`cool` is not. Returns null when
 * nothing is close enough — a wrong guess is worse than no guess.
 */
export function nearestTerm(unknown: string, known: Iterable<string>): string | null {
  const needle = unknown.toLowerCase();
  // 1 edit for short words, 2 for anything from 6 characters up.
  const budget = needle.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestD = Infinity;
  for (const cand of known) {
    const d = levenshtein(needle, cand.toLowerCase());
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best !== null && bestD <= budget && bestD > 0 ? best : null;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  // Single row, rolled — these strings are tag-length, so the allocation
  // matters more than the algorithmic constant.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}
