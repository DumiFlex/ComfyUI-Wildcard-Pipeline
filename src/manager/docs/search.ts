/**
 * Full-text search over the docs. The text comes from the plain-text copy
 * the AI chat already reads (`engine/ai/docs_index.json`, built by
 * `pnpm docs:index`), loaded the first time someone searches.
 *
 * Every word of the query must appear in a section (or its page's title,
 * blurb and keywords). A section scores higher when the words are in the
 * page title, then the section title, then the text; a whole-phrase match
 * adds more. One result per section, best first.
 */

export interface IndexSection { title: string; text: string }
export interface IndexPage {
  id: string; title: string; group: string; blurb: string; keywords: string[]; sections: IndexSection[];
}

export interface DocHit {
  pageId: string;
  pageTitle: string;
  /** Section title; empty for a hit on the page itself (title, blurb). */
  section: string;
  /** A short stretch of text around the first match. */
  snippet: string;
  /** [start, end) ranges of the query words inside `snippet`. */
  marks: [number, number][];
  score: number;
}

const SNIPPET = 160;

export function queryWords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[\s,]+/).map((w) => w.trim()).filter((w) => w.length > 0))];
}

function countOf(hay: string, word: string): number {
  let n = 0;
  for (let i = hay.indexOf(word); i >= 0 && n < 20; i = hay.indexOf(word, i + word.length)) n++;
  return n;
}

/** Ranges of every word in `text`, merged where they touch. */
export function markRanges(text: string, words: string[]): [number, number][] {
  const lower = text.toLowerCase();
  const out: [number, number][] = [];
  for (const w of words) {
    for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) out.push([i, i + w.length]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** A stretch of `text` around its first match, on word boundaries. */
export function snippetFor(text: string, words: string[]): { snippet: string; marks: [number, number][] } {
  const flat = text.replace(/\s*\n\s*/g, " · ").replace(/^- /, "");
  const lower = flat.toLowerCase();
  const first = Math.min(...words.map((w) => { const i = lower.indexOf(w); return i < 0 ? Infinity : i; }));
  let start = Number.isFinite(first) ? Math.max(0, first - 50) : 0;
  if (start > 0) {
    const sp = flat.indexOf(" ", start);
    start = sp >= 0 && sp < first ? sp + 1 : start;
  }
  let end = Math.min(flat.length, start + SNIPPET);
  if (end < flat.length) {
    const sp = flat.lastIndexOf(" ", end);
    if (sp > start + SNIPPET / 2) end = sp;
  }
  const body = flat.slice(start, end);
  const pre = start > 0 ? "…" : "";
  const snippet = `${pre}${body}${end < flat.length ? "…" : ""}`;
  return { snippet, marks: markRanges(snippet, words) };
}

export function searchDocs(pages: readonly IndexPage[], query: string, limit = 30): DocHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const phrase = query.trim().toLowerCase();
  const hits: DocHit[] = [];
  for (const p of pages) {
    const head = `${p.title} ${p.blurb} ${p.keywords.join(" ")}`.toLowerCase();
    const pageTitle = p.title.toLowerCase();
    let pageHit = false;
    for (const s of p.sections) {
      const st = s.title.toLowerCase();
      const tx = s.text.toLowerCase();
      if (!words.every((w) => head.includes(w) || st.includes(w) || tx.includes(w))) continue;
      // A section that only matches through its page's head is the page hit, once.
      const inSection = words.some((w) => st.includes(w) || tx.includes(w));
      if (!inSection) { pageHit = true; continue; }
      let score = 0;
      for (const w of words) {
        if (pageTitle.includes(w)) score += 6;
        else if (head.includes(w)) score += 3;
        if (st.includes(w)) score += 5;
        score += Math.min(countOf(tx, w), 5);
      }
      if (words.length > 1 && (tx.includes(phrase) || st.includes(phrase))) score += 8;
      const { snippet, marks } = snippetFor(s.text, words);
      hits.push({ pageId: p.id, pageTitle: p.title, section: s.title, snippet, marks, score });
    }
    if (pageHit && !hits.some((h) => h.pageId === p.id)) {
      const { snippet, marks } = snippetFor(p.blurb, words);
      const score = words.reduce((n, w) => n + (pageTitle.includes(w) ? 6 : 3), 0);
      hits.push({ pageId: p.id, pageTitle: p.title, section: "", snippet, marks, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

let loaded: Promise<IndexPage[]> | null = null;

/** The docs text, loaded once (its own chunk, fetched on the first search). */
export function loadDocsIndex(): Promise<IndexPage[]> {
  loaded ??= import("../../../engine/ai/docs_index.json")
    .then((m) => (m.default as { pages: IndexPage[] }).pages)
    .catch((e: unknown) => { loaded = null; throw e; });
  return loaded;
}
