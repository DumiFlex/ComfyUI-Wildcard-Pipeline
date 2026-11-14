/**
 * WP_LabelGrid on the canvas — the widget's config and grid presets.
 *
 * The node's one widget holds every setting as JSON; `parseLabelGridConfig`
 * mirrors `engine/label_grid.py::parse_config` (per-key fallback, clamped
 * numbers) so a hand-edited or older workflow shows what the node will do.
 *
 * The grid presets live beside the widget
 * (`components/label-grid/presets.ts`), so they load with it and not with
 * the boot chunk.
 */

export const LABEL_GRID_NODE = "WP_LabelGrid";
/** The node's one widget: label + grid settings as JSON. */
export const CONFIG_WIDGET = "wp_label_grid";

export type LabelPosition =
  | "top" | "bottom" | "left" | "right"
  | "over_top" | "over_bottom" | "over_left" | "over_right" | "none";
export type LabelAlign = "center" | "left" | "right";
/** Left / right labels: across, or turned along the edge (upwards on the
 *  left, downwards on the right). */
export type LabelOrientation = "horizontal" | "vertical";
export type GridArrange = "auto" | "rows" | "columns" | "fill" | "strip" | "stack";
/** `none` / `typed` / `part:N` (N from 1, `part:-1` = the last part). */
export type HeaderSource = string;

export interface LabelGridConfig {
  label: string;
  position: LabelPosition;
  align: LabelAlign;
  orientation: LabelOrientation;
  font: string;
  /** 0 = automatic (a share of the image width). */
  font_size: number;
  text_color: string;
  label_color: string;
  grid: boolean;
  arrange: GridArrange;
  /** For fill: 0 = near square. */
  columns: number;
  rows_from: HeaderSource;
  row_headers: string;
  columns_from: HeaderSource;
  column_headers: string;
  title: string;
  gap: number;
  margin: number;
  background: string;
  header_color: string;
  /** 0 = keep each image's size. */
  cell_width: number;
}

export const POSITIONS: readonly LabelPosition[] = [
  "top", "bottom", "left", "right", "over_top", "over_bottom", "over_left", "over_right", "none",
];
export const ALIGNS: readonly LabelAlign[] = ["center", "left", "right"];
export const ORIENTATIONS: readonly LabelOrientation[] = ["horizontal", "vertical"];
export const ARRANGES: readonly GridArrange[] = ["auto", "rows", "columns", "fill", "strip", "stack"];
const HEADER_FROM = /^(none|typed|part:-?[1-9]\d?)$/;

/** Must equal `engine/label_grid.py::DEFAULT_CONFIG`. */
export const DEFAULT_LABEL_GRID_CONFIG: Readonly<LabelGridConfig> = {
  label: "{label}",
  position: "top",
  align: "center",
  orientation: "horizontal",
  font: "default",
  font_size: 0,
  text_color: "#ffffff",
  label_color: "#000000",
  grid: true,
  arrange: "auto",
  columns: 0,
  rows_from: "none",
  row_headers: "",
  columns_from: "none",
  column_headers: "",
  title: "",
  gap: 8,
  margin: 0,
  background: "#ffffff",
  header_color: "#000000",
  cell_width: 0,
};

/** Upper bounds, as `engine/label_grid.py::_INT_LIMITS`. */
export const INT_LIMITS = { font_size: 1024, columns: 256, gap: 512, margin: 1024, cell_width: 8192 } as const;
type IntKey = keyof typeof INT_LIMITS;
const TEXT_KEYS = [
  "label", "font", "text_color", "label_color", "row_headers", "column_headers",
  "title", "background", "header_color",
] as const;

export function defaultLabelGridConfig(): LabelGridConfig {
  return { ...DEFAULT_LABEL_GRID_CONFIG };
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

export function parseLabelGridConfig(raw: unknown): LabelGridConfig {
  const out = defaultLabelGridConfig();
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  const r = obj as Record<string, unknown>;
  if (oneOf(r.position, POSITIONS)) out.position = r.position;
  if (oneOf(r.align, ALIGNS)) out.align = r.align;
  if (oneOf(r.orientation, ORIENTATIONS)) out.orientation = r.orientation;
  if (oneOf(r.arrange, ARRANGES)) out.arrange = r.arrange;
  for (const key of ["rows_from", "columns_from"] as const) {
    const v = r[key];
    if (typeof v === "string" && HEADER_FROM.test(v)) out[key] = v;
  }
  for (const key of Object.keys(INT_LIMITS) as IntKey[]) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.max(0, Math.min(INT_LIMITS[key], Math.trunc(v)));
  }
  for (const key of TEXT_KEYS) {
    const v = r[key];
    if (typeof v === "string") out[key] = v;
  }
  if (typeof r.grid === "boolean") out.grid = r.grid;
  return out;
}

/** The label part a `part:N` source names; 0 for none / typed. */
export function headerPart(source: HeaderSource): number {
  if (!source.startsWith("part:")) return 0;
  const n = Number(source.slice(5));
  return Number.isInteger(n) ? n : 0;
}

/* ── last run ─────────────────────────────────────────────────────────── */

export interface LabelPart {
  /** A few distinct values, first seen first. */
  values: string[];
  /** How many distinct values the part has. */
  count: number;
}

/** What the node saw on its last run (`wp_nodes/label_grid_node.py`). */
export interface LabelGridRun {
  items: number;
  batchSizes: number[];
  count: number;
  /** Any image came with a label. */
  labelled: boolean;
  /** Each label part (after the label template), in order. */
  parts: LabelPart[];
  /** What `arrange = auto` picked for this run. */
  auto: GridArrange;
  /** The grid's [width, height], or null when no grid was made. */
  grid: [number, number] | null;
  /** Images the label lines left without one. */
  missing: number;
  /** Label lines no image took. */
  extra: number;
  /** Typed row / column headers vs the grid's rows / columns, when they differ. */
  rows: [number, number] | null;
  columns: [number, number] | null;
  /** Images an XY plot put under "(no label)". */
  noLabel: number;
}

export function parseLabelGridRun(raw: unknown): LabelGridRun | null {
  const run = Array.isArray(raw) ? raw[0] : raw;
  if (!run || typeof run !== "object") return null;
  const r = run as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const sizes = Array.isArray(r.batch_sizes) ? r.batch_sizes.map(num) : [];
  const parts: LabelPart[] = Array.isArray(r.parts)
    ? r.parts.flatMap((p) => {
      if (!p || typeof p !== "object") return [];
      const q = p as Record<string, unknown>;
      const values = Array.isArray(q.values) ? q.values.filter((v): v is string => typeof v === "string") : [];
      return [{ values, count: num(q.count) || values.length }];
    })
    : [];
  const pair = (v: unknown): [number, number] | null =>
    Array.isArray(v) && v.length === 2 ? [num(v[0]), num(v[1])] : null;
  const grid = pair(r.grid);
  return {
    items: num(r.items) || sizes.length,
    batchSizes: sizes,
    count: num(r.count) || sizes.reduce((a, b) => a + b, 0),
    labelled: r.labelled === true,
    parts,
    auto: oneOf(r.auto, ARRANGES) ? r.auto : "auto",
    grid,
    missing: num(r.missing),
    extra: num(r.extra),
    rows: pair(r.rows),
    columns: pair(r.columns),
    noLabel: num(r.no_label),
  };
}

/** What doesn't match on the last run, in words ("" when it all fits):
 *  label lines vs images, typed headers vs rows / columns. */
export function runMismatch(run: LabelGridRun): string[] {
  const out: string[] = [];
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  if (run.missing) out.push(`${n(run.missing, "image")} without a label line`);
  if (run.extra) out.push(`${n(run.extra, "label line")} left over`);
  if (run.noLabel) out.push(`${n(run.noLabel, "image")} under "(no label)"`);
  for (const [key, word] of [["rows", "row"], ["columns", "column"]] as const) {
    const fit = run[key];
    if (!fit) continue;
    const [have, need] = fit;
    out.push(have < need
      ? `${n(have, `${word} header`)} for ${n(need, word)}`
      : `${n(have - need, `${word} header`)} left over`);
  }
  return out;
}
