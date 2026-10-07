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

/** Split `text` so every place a value appears is its own run. Longer
 *  values win where two overlap; values under 2 characters are skipped. */
export function promptRuns(text: string, rows: readonly ValueRow[]): PromptRun[] {
  const marks: { start: number; end: number; row: ValueRow }[] = [];
  const sorted = rows.filter((r) => r.value.trim().length >= 2).sort((a, b) => b.value.length - a.value.length);
  for (const row of sorted) {
    let at = text.indexOf(row.value);
    while (at >= 0) {
      const end = at + row.value.length;
      if (!marks.some((m) => at < m.end && end > m.start)) marks.push({ start: at, end, row });
      at = text.indexOf(row.value, end);
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
