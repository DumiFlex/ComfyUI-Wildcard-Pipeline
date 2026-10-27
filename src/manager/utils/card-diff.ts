/**
 * Old → new building blocks for the chat's change cards
 * (`composables/card-views/`): a list matched up by id, a set of tags
 * split into kept / added / dropped, and option weights as shares.
 *
 * Pure and DOM-free; the views colour what these return the same way
 * everywhere (`components/ai/views/card-diff.css`).
 */

/** What happened to one part of an item. */
export type Change = "added" | "removed" | "changed" | "same";

export interface ListDiffRow<T> {
  change: Change;
  /** The part as it will be (as it was, for a removed one). */
  now: T;
  /** The part as it was; null for an added one. */
  was: T | null;
}

/**
 * Two lists matched up by `key`, in the new order, with each removed part
 * put back where it stood (after the part it followed before).
 */
export function diffList<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
): ListDiffRow<T>[] {
  const old = new Map(before.map((b) => [key(b), b]));
  const kept = new Set(after.map(key));
  const rows: ListDiffRow<T>[] = after.map((now) => {
    const was = old.get(key(now)) ?? null;
    if (!was) return { change: "added", now, was: null };
    return { change: same(was, now) ? "same" : "changed", now, was };
  });
  // Removed parts go back in after the part they followed.
  let at = 0;
  before.forEach((b) => {
    const k = key(b);
    if (kept.has(k)) {
      const i = rows.findIndex((r) => r.was !== null && key(r.was) === k);
      if (i >= 0) at = i + 1;
      return;
    }
    rows.splice(at, 0, { change: "removed", now: b, was: b });
    at += 1;
  });
  return rows;
}

export interface TagDiff {
  tag: string;
  change: "added" | "removed" | "same";
}

/** Tags old → new, kept ones first in their order, then the added ones;
 *  dropped ones stay where they were, marked. */
export function diffTags(before: readonly string[], after: readonly string[]): TagDiff[] {
  const now = new Set(after);
  const had = new Set(before);
  return [
    ...before.map((tag): TagDiff => ({ tag, change: now.has(tag) ? "same" : "removed" })),
    ...after.filter((t) => !had.has(t)).map((tag): TagDiff => ({ tag, change: "added" })),
  ];
}

/** Whether a tag diff changes anything. */
export function tagsChanged(d: readonly TagDiff[]): boolean {
  return d.some((t) => t.change !== "same");
}

/** Each weight as its share of the total, 0–100 (the editor's numbers:
 *  `WildcardEditor.probabilityFor`). */
export function shares(weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  return weights.map((w) => (sum > 0 && Number.isFinite(w) && w > 0 ? (w / sum) * 100 : 0));
}

export interface TextPart {
  text: string;
  change: "added" | "removed" | "same";
}

/** Text as words and the spaces and punctuation between them, so a diff
 *  marks whole words ("$mood" stays one piece). */
function tokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}_$@#.:-]+|\s+|[^\p{L}\p{N}_$@#.:\s-]/gu) ?? [];
}

/** Longest a word diff tries before it shows old → new whole. */
const MAX_CELLS = 250_000;

/**
 * Old text → new as one run of parts: words kept, added and removed, in
 * reading order (a removed run before the added run that replaced it).
 * Very long texts with little in common come back as all-removed then
 * all-added, which reads the same.
 */
export function diffWords(before: string, after: string): TextPart[] {
  if (before === after) return before ? [{ text: before, change: "same" }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...(before ? [{ text: before, change: "removed" as const }] : []),
      ...(after ? [{ text: after, change: "added" as const }] : []),
    ];
  }
  // Longest common run, filled from the end so the walk reads forward.
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out: TextPart[] = [];
  const push = (text: string, change: TextPart["change"]) => {
    const last = out[out.length - 1];
    if (last && last.change === change) last.text += text;
    else out.push({ text, change });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], "same"); i++; j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      push(a[i], "removed"); i++;
    } else {
      push(b[j], "added"); j++;
    }
  }
  while (i < a.length) push(a[i++], "removed");
  while (j < b.length) push(b[j++], "added");
  // A bare space kept between two changes reads as part of the new words
  // ("$mood, night" rather than "$mood," · " " · "night").
  const tidy: TextPart[] = [];
  out.forEach((part, k) => {
    const gap = part.change === "same" && !part.text.trim() && k > 0 && k < out.length - 1
      && out[k - 1].change !== "same" && out[k + 1].change !== "same";
    const both = gap && out[k - 1].change === "removed" && out[k + 1].change === "removed";
    const next: TextPart = gap ? { ...part, change: both ? "removed" : "added" } : part;
    const last = tidy[tidy.length - 1];
    if (last && last.change === next.change) last.text += next.text;
    else tidy.push({ ...next });
  });
  return tidy;
}

/** `$names` a text reads (`$name`, `$name.0`, `$name.neg` read `$name`). */
export function readVars(text: string): string[] {
  return [...new Set([...text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))];
}
