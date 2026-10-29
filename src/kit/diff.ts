/**
 * A small word or line diff for DiffView: the longest common subsequence of
 * the two token lists, then the runs that are the same, added or removed.
 * Inputs past `limit` tokens on either side fall back to "all removed, all
 * added", which keeps the table (n × m) small.
 */
export type DiffPart = { kind: "same" | "add" | "del"; text: string };

/** Words with the spaces after them, so joining the parts gives the text back. */
export function tokenize(text: string, by: "words" | "lines"): string[] {
  if (!text) return [];
  return by === "lines" ? text.split(/(?<=\n)/) : text.match(/\s+|[^\s]+/g) ?? [];
}

export function diffTokens(a: string[], b: string[], limit = 2000): DiffPart[] {
  if (a.length > limit || b.length > limit) {
    return merge([...a.map((t) => ({ kind: "del" as const, text: t })), ...b.map((t) => ({ kind: "add" as const, text: t }))]);
  }
  const n = a.length; const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ kind: "del", text: a[i] }); i++; }
    else { out.push({ kind: "add", text: b[j] }); j++; }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return merge(out);
}

/** Join neighbours of one kind into one part. */
function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.kind === p.kind) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

export function diffText(before: string, after: string, by: "words" | "lines" = "words"): DiffPart[] {
  return diffTokens(tokenize(before, by), tokenize(after, by));
}
