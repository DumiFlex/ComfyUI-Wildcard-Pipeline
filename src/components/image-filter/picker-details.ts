/**
 * Pure helpers for the zoom's Details panel: the frame's variable values
 * (swept ones first, coloured like their sweep axis) and the prompt split
 * into runs so each value shows where it landed.
 */
import type { FrameLabel } from "./types";
import type { SweepAxisInfo } from "./picker-loop";

export interface ValueRow {
  name: string;
  value: string;
  /** Index of the sweep axis this variable is, else -1. */
  axis: number;
}

export interface PromptRun {
  text: string;
  /** The variable whose value this run is, if any. */
  name?: string;
  axis?: number;
}

const bare = (name: string): string => name.replace(/^\$/, "");

/** The frame's variables: swept ones first (in axis order), then the rest. */
export function frameValues(label: FrameLabel | undefined, axes: readonly SweepAxisInfo[]): ValueRow[] {
  const vars = label?.vars ?? {};
  const rows: ValueRow[] = [];
  const seen = new Set<string>();
  axes.forEach((a, axis) => {
    const name = bare(a.name);
    const id = label?.pins?.[a.uid];
    const value = vars[name] ?? (id !== undefined ? a.labels[id] ?? id : undefined);
    if (value === undefined || seen.has(name)) return;
    seen.add(name);
    rows.push({ name, value, axis });
  });
  for (const [name, value] of Object.entries(vars)) {
    if (!seen.has(name)) rows.push({ name, value, axis: -1 });
  }
  return rows;
}

const WORD = /[\p{L}\p{N}_]/u;
/** True when `text[start, end)` doesn't cut a word in half. */
function onWordEdges(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  const after = text[end];
  return !(before && WORD.test(before) && WORD.test(text[start] ?? ""))
    && !(after && WORD.test(after) && WORD.test(text[end - 1] ?? ""));
}

/** What to look for in the prompt for one value: the whole value (edge
 *  commas trimmed) when it is there as written, else each of its
 *  comma-separated parts, since a prompt cleaner can drop a repeated tag or
 *  reorder them. */
function needles(text: string, value: string): string[] {
  const whole = value.trim().replace(/^[,\s]+|[,\s]+$/g, "");
  if (whole.length < 2) return [];
  if (text.includes(whole)) return [whole];
  return whole.split(",").map((p) => p.trim()).filter((p) => p.length >= 2);
}

/** Split `text` so every place a value appears as whole words is its own
 *  run ("toe" never marks part of "cameltoe"). Longer values win where two
 *  overlap; values under 2 characters are skipped. A value the prompt only
 *  holds in pieces (a cleaner dropped or moved a tag) marks each piece. */
export function promptRuns(text: string, rows: readonly ValueRow[]): PromptRun[] {
  const marks: { start: number; end: number; row: ValueRow }[] = [];
  const wanted = rows.flatMap((row) => needles(text, row.value).map((needle) => ({ needle, row })));
  wanted.sort((a, b) => b.needle.length - a.needle.length);
  for (const { needle, row } of wanted) {
    let at = text.indexOf(needle);
    while (at >= 0) {
      const end = at + needle.length;
      if (onWordEdges(text, at, end) && !marks.some((m) => at < m.end && end > m.start)) {
        marks.push({ start: at, end, row });
      }
      at = text.indexOf(needle, end);
    }
  }
  marks.sort((a, b) => a.start - b.start);
  const runs: PromptRun[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) runs.push({ text: text.slice(pos, m.start) });
    runs.push({ text: text.slice(m.start, m.end), name: m.row.name, axis: m.row.axis });
    pos = m.end;
  }
  if (pos < text.length) runs.push({ text: text.slice(pos) });
  return runs;
}

/** Plain text for the Copy button: one `$name: value` line per row. */
export function valuesText(rows: readonly ValueRow[], seed?: number): string {
  const lines = rows.map((r) => `$${r.name}: ${r.value}`);
  if (typeof seed === "number") lines.push(`seed: ${seed}`);
  return lines.join("\n");
}
