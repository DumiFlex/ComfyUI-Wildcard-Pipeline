/**
 * WP Label & Grid presets: each sets the grid fields in one click. They
 * follow the shape of the run the images come from (one batch, a list of
 * single images, a list of batches, a sweep whose labels say its options),
 * and after a run the widget marks the one that fits it (`suggestPreset`).
 *
 * Loaded with the widget's SFC chunk, not the boot chunk.
 */
import type { HeaderSource, LabelGridConfig, LabelGridRun } from "../../extension/label-grid";

/** "3 frames × 4 images", "5 images", "1 batch of 9", "1 image". */
export function describeRun(run: LabelGridRun): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const sizes = run.batchSizes;
  if (run.items <= 1) return sizes[0] > 1 ? `1 batch of ${sizes[0]}` : plural(run.count, "image");
  if (sizes.every((s) => s === 1)) return plural(run.count, "image");
  if (sizes.every((s) => s === sizes[0])) return `${run.items} frames × ${plural(sizes[0], "image")}`;
  return `${run.items} frames, ${plural(run.count, "image")}`;
}

/* ── presets ──────────────────────────────────────────────────────────── */

export type PresetId = "auto" | "sheet" | "strip" | "frames_rows" | "frames_cols" | "xy" | "off";

export interface GridPreset {
  id: PresetId;
  label: string;
  icon: string;
  hint: string;
}

export const PRESETS: readonly GridPreset[] = [
  { id: "auto", label: "Fit the run", icon: "pi-sparkles", hint: "Follows the images that come in: a sheet for one batch, a row for a few single images, one row per frame for a list of batches" },
  { id: "sheet", label: "Sheet", icon: "pi-th-large", hint: "Every image in turn, filled into a near-square sheet (or the columns you set)" },
  { id: "strip", label: "Side by side", icon: "pi-ellipsis-h", hint: "Every image in one row, for comparing a few runs" },
  { id: "frames_rows", label: "Frame rows", icon: "pi-bars", hint: "One row per frame of a loop, its batch across. With labels the rows are headed #1, #2, …" },
  { id: "frames_cols", label: "Frame columns", icon: "pi-pause", hint: "One column per frame of a loop, its batch down. With labels the columns are headed #1, #2, …" },
  { id: "xy", label: "XY plot", icon: "pi-table", hint: "Rows and columns from two parts of the labels (a sweep's options), each part's values as headers" },
  { id: "off", label: "No grid", icon: "pi-image", hint: "Only label the images; the grid output stays empty" },
];

type GridFields = Pick<LabelGridConfig, "grid" | "arrange" | "columns" | "rows_from" | "columns_from">;

/** Label part 1 holds frame numbers (`#1`, `#2`, …): the Image Filter's labels. */
function framesNumbered(run: LabelGridRun | null): boolean {
  const first = run?.parts[0];
  return !!run?.labelled && !!first && first.count > 1 && first.values.every((v) => /^#\d+$/.test(v));
}

/** The two label parts an XY plot should use (rows, columns): the first two
 *  that change across the run without being unique per image, skipping the
 *  frame numbers. `null` when the labels don't have two. */
export function xyParts(run: LabelGridRun | null): [number, number] | null {
  if (!run?.labelled) return null;
  const picked: number[] = [];
  run.parts.forEach((p, i) => {
    if (picked.length >= 2) return;
    if (i === 0 && framesNumbered(run)) return;
    if (p.count > 1 && p.count < run.count) picked.push(i + 1);
  });
  return picked.length === 2 ? [picked[0], picked[1]] : null;
}

/** The grid fields a preset sets, read against the last run when there is one. */
export function presetFields(id: PresetId, run: LabelGridRun | null): GridFields {
  const base: GridFields = { grid: true, arrange: "auto", columns: 0, rows_from: "none", columns_from: "none" };
  const frameHead = framesNumbered(run) ? "part:1" : "none";
  switch (id) {
    case "auto": return base;
    case "sheet": return { ...base, arrange: "fill" };
    case "strip": return { ...base, arrange: "strip" };
    case "frames_rows": return { ...base, arrange: "rows", rows_from: frameHead };
    case "frames_cols": return { ...base, arrange: "columns", columns_from: frameHead };
    case "xy": {
      const [r, c] = xyParts(run) ?? [2, 3];
      return { ...base, rows_from: `part:${r}`, columns_from: `part:${c}` };
    }
    case "off": return { ...base, grid: false };
  }
}

export function applyPreset(cfg: LabelGridConfig, id: PresetId, run: LabelGridRun | null): LabelGridConfig {
  return { ...cfg, ...presetFields(id, run) };
}

/** Which preset the config's grid fields amount to; null = set by hand. */
export function matchPreset(cfg: LabelGridConfig): PresetId | null {
  if (!cfg.grid) return "off";
  const r = cfg.rows_from;
  const c = cfg.columns_from;
  const none = r === "none" && c === "none";
  if (r.startsWith("part:") && c.startsWith("part:")) return "xy";
  if (cfg.arrange === "auto" && none && cfg.columns === 0) return "auto";
  if (cfg.arrange === "fill" && none) return "sheet";
  if (cfg.arrange === "strip" && none) return "strip";
  if (cfg.arrange === "rows" && c === "none" && (r === "none" || r === "part:1")) return "frames_rows";
  if (cfg.arrange === "columns" && r === "none" && (c === "none" || c === "part:1")) return "frames_cols";
  return null;
}

/** The preset that fits a run's shape best. */
export function suggestPreset(run: LabelGridRun | null): PresetId | null {
  if (!run || run.count === 0) return null;
  if (run.count === 1) return "off";
  if (xyParts(run)) return "xy";
  if (run.items <= 1) return "sheet";
  if (run.batchSizes.every((s) => s === 1)) return run.items <= 6 ? "strip" : "sheet";
  return "frames_rows";
}

/** Choices for "rows from" / "columns from", with what each part held. */
export function headerSourceOptions(run: LabelGridRun | null): { value: HeaderSource; label: string }[] {
  const out: { value: HeaderSource; label: string }[] = [
    { value: "none", label: "No headers" },
    { value: "typed", label: "Typed below" },
  ];
  const parts = run?.parts.length ? run.parts.length : 0;
  const shown = Math.max(parts, 3);
  for (let n = 1; n <= Math.min(shown, 6); n++) {
    const p = run?.parts[n - 1];
    const sample = p ? `: ${p.values.slice(0, 3).join(", ")}${p.count > 3 ? ", …" : ""}` : "";
    out.push({ value: `part:${n}`, label: `Label part ${n}${sample}` });
  }
  out.push({ value: "part:-1", label: "Last label part" });
  return out;
}
