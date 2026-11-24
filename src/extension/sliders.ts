/**
 * WP_Slider: the widget value, what each slider writes, and which number
 * output each pinned slider drives. Pure logic, no DOM.
 *
 * Resolution mirrors `engine/sliders.py` via the shared
 * `tests/fixtures/sliders-corpus.json`; keep the two in step.
 *
 * Outputs: the node declares the context plus {@link MAX_OUTPUTS} `*`
 * outputs (ComfyUI V3 has no dynamic outputs and fixed types) and the
 * canvas shows only the pinned ones, typed INT or FLOAT (`out_type`, else INT at 0 decimals).
 * Each pinned slider's `out` is its output slot (1-based; slot 0 is the
 * context). Slots never follow row order: a reorder moves the dot with its
 * row, so no link has to be re-pointed. Unpinning removes the slot and
 * every higher `out` drops by one; a new pin takes the next free slot.
 */
import { stepDots } from "@/kit/xy-pad";

/** Number outputs the node declares. Never lower it (saved links). */
export const MAX_OUTPUTS = 16;
export const SLIDER_MODES = ["number", "text", "words"] as const;
export type SliderMode = (typeof SLIDER_MODES)[number];
/** Looks: `row` (name, then a thin track), `bar` (the row is a filled bar
 *  with the name inside), `fader` (an upright track; neighbouring faders
 *  stand side by side). */
export const SLIDER_STYLES = ["row", "bar", "fader"] as const;
export type SliderStyle = (typeof SLIDER_STYLES)[number];
export const MAX_DECIMALS = 6;

/** Cross-node run-time table `$name.num` reads (engine `sliders.NUMS_KEY`). */
export const SLIDER_NUMS_KEY = "__wp_slider_nums__";

export interface SliderWord {
  word: string;
  /** The range ends at this value (inclusive). Absent: catches the rest. */
  upto?: number;
  negative?: string;
}

export type SliderOff = "mute" | "bypass";
/** In Words mode, where the picked word goes in the row's text. */
export const WORD_SLOT = "{word}";

export interface SliderRow {
  id: string;
  kind: "slider";
  name: string;
  /** Variable name without `$`. */
  var: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  mode: SliderMode;
  /** Text mode: what the variable gets (may read `$vars` and `$name.num`).
   *  Words mode: where `{word}` stands, the picked word goes in. */
  text?: string;
  /** Negative text the variable carries (words: unless the word has one). */
  negative?: string;
  /** Words mode: value ranges, in order. */
  words?: SliderWord[];
  /** Has a number output. */
  pin: boolean;
  /** Output slot (1..16) while pinned, else 0. */
  out: number;
  /** Keeps the variable out of the prompt and the Assembler's listing. */
  internal?: true;
  /** The output's type; absent follows the decimals (INT at 0, else FLOAT). */
  out_type?: "int" | "float";
  /** `mute` writes nothing; `bypass` writes the plain number (no text,
   *  word or negative). The output still sends the number. */
  off?: SliderOff;
  /** The value can't be moved on the canvas. */
  lock?: true;
  style: SliderStyle;
  /** Not snapped to `step`: a drag lands on any value the decimals can
   *  write (the arrows still move by `step`). */
  free?: true;
  /** Clean view: no `$variable` line under the name. */
  hide_var?: true;
  /** Tick marks at each Words range end (and the ends of the track). */
  marks?: true;
  /** Looks only. A PrimeIcons name without `pi-`; colours `#rrggbb`.
   *  `tint` colours the track and thumb. */
  icon?: string;
  icon_color?: string;
  text_color?: string;
  tint?: string;
}

export interface SliderLabelRow {
  id: string;
  kind: "label";
  name: string;
  /** Variable colour 1..8 (used while `hex` is absent). */
  color: number;
  hex?: string;
  icon?: string;
  collapsed?: boolean;
}

export type SlidersItem = SliderRow | SliderLabelRow;

/** WP Slider 2D / 3D's pad looks (the kit XYPad's and OrbitPad's props). */
export interface PadLooks {
  /** Absent: the plain pad. size = area, ratio guides and a W × H readout;
   *  stick = round with zero in the middle; map = each Words axis's ranges
   *  as labelled stripes; orbit (3D only) = the kit OrbitPad: X turns
   *  round the subject, Y is the height angle, Z the distance; mix (3D
   *  only) = the kit TrianglePad: the three axes are shares of a blend,
   *  each a part of its own range, the parts adding up to one. */
  style?: "size" | "stick" | "map" | "orbit" | "mix";
  /** Orbit: drawn as a light (an amber sun) instead of a camera. */
  light?: true;
  /** Width over height of the pad (1 = square). */
  ratio?: number;
  /** The shape follows the two ranges (a 0–1024 × 0–1344 pad is 3:4). */
  fit?: true;
  /** Shade from the bottom-left corner to the point. */
  area?: true;
  /** No lines through the point. */
  no_crosshair?: true;
  /** Map style: no colour per word section (coloured by default). */
  no_tint?: true;
  /** Dots per side. Absent: one per step (spread on steps past 16);
   *  0: none; N: up to N per side, on steps. */
  grid?: number;
  /** The point lands on a dot. */
  snap_dots?: true;
  /** The pad's width: s / m; absent fills the node. */
  size?: "s" | "m";
}

export interface SlidersConfig {
  version: 1;
  rows: SlidersItem[];
  /** WP Slider 2D / 3D only. */
  pad?: PadLooks;
}

export const VAR_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export function newSliderId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "Camera distance" → "camera_distance". Starts with a letter. */
export function varFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return /^[a-z]/.test(slug) ? slug : `s_${slug}`;
}

export function sliderRows(cfg: SlidersConfig): SliderRow[] {
  return cfg.rows.filter((r): r is SliderRow => r.kind === "slider");
}

/** A variable no other slider on the node uses yet. */
export function uniqueVar(base: string, cfg: SlidersConfig, exceptId?: string): string {
  const taken = new Set(sliderRows(cfg).filter((s) => s.id !== exceptId).map((s) => s.var));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function newSlider(cfg: SlidersConfig, name?: string): SliderRow {
  const n = sliderRows(cfg).length + 1;
  const label = name ?? `Slider ${n}`;
  return {
    id: newSliderId(),
    kind: "slider",
    name: label,
    var: uniqueVar(varFromName(label) || `slider_${n}`, cfg),
    value: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    decimals: 2,
    mode: "number",
    // No output until asked for: most sliders only feed their $variable.
    pin: false,
    out: 0,
    style: "row",
  };
}

export function newSliderLabel(cfg: SlidersConfig): SliderLabelRow {
  const n = cfg.rows.filter((r) => r.kind === "label").length;
  return { id: newSliderId(), kind: "label", name: "Group", color: (n % 8) + 1 };
}

export function defaultSlidersConfig(): SlidersConfig {
  const cfg: SlidersConfig = { version: 1, rows: [] };
  cfg.rows.push(newSlider(cfg));
  return cfg;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;
const hex = (v: unknown): string => (typeof v === "string" && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : "");
const iconName = (v: unknown): string => {
  const s = str(v).replace(/^pi-/, "");
  return ICON_RE.test(s) ? s : "";
};
/** A finite number, else `fallback` (booleans are not numbers). */
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function parseWords(raw: unknown): SliderWord[] {
  const out: SliderWord[] = [];
  for (const w of Array.isArray(raw) ? raw : []) {
    if (!w || typeof w !== "object" || Array.isArray(w)) continue;
    const o = w as Record<string, unknown>;
    const word: SliderWord = { word: typeof o.word === "string" ? o.word : "" };
    if (typeof o.upto === "number" && Number.isFinite(o.upto)) word.upto = o.upto;
    if (typeof o.negative === "string" && o.negative.trim()) word.negative = o.negative.trim();
    out.push(word);
  }
  return out;
}

/** Widget JSON → config (mirror of `parse_config`; the frontend also keeps
 *  labels and looks). A row with no id gets one. */
export function parseSlidersConfig(raw: unknown): SlidersConfig {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return defaultSlidersConfig();
  const d = data as Record<string, unknown>;
  const rows: SlidersItem[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(d.rows) ? d.rows : []) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    let id = str(o.id);
    if (!id || seen.has(id)) id = newSliderId();
    seen.add(id);
    if (o.kind === "label") {
      const c = typeof o.color === "number" && o.color >= 1 && o.color <= 8 ? Math.round(o.color) : 1;
      const label: SliderLabelRow = { id, kind: "label", name: str(o.name), color: c };
      if (hex(o.hex)) label.hex = hex(o.hex);
      if (iconName(o.icon)) label.icon = iconName(o.icon);
      if (o.collapsed === true) label.collapsed = true;
      rows.push(label);
      continue;
    }
    if (o.kind !== undefined && o.kind !== "slider") continue;
    const min = num(o.min, 0);
    const max = num(o.max, 1);
    const step = num(o.step, 0.01);
    const dec = typeof o.decimals === "number" && Number.isInteger(o.decimals) ? o.decimals : 2;
    const out = typeof o.out === "number" && Number.isInteger(o.out) ? o.out : 0;
    const s: SliderRow = {
      id,
      kind: "slider",
      name: str(o.name) || id,
      var: str(o.var),
      value: num(o.value, min),
      min,
      max,
      step: step > 0 ? step : 0.01,
      decimals: Math.max(0, Math.min(MAX_DECIMALS, dec)),
      mode: SLIDER_MODES.includes(o.mode as SliderMode) ? (o.mode as SliderMode) : "number",
      pin: o.pin === true,
      out: o.pin === true ? out : 0,
      style: SLIDER_STYLES.includes(o.style as SliderStyle) ? (o.style as SliderStyle) : "row",
    };
    if (typeof o.text === "string" && o.text) s.text = o.text;
    if (typeof o.negative === "string" && o.negative.trim()) s.negative = o.negative.trim();
    const words = parseWords(o.words);
    if (words.length) s.words = words;
    if (o.internal === true) s.internal = true;
    if (o.out_type === "int" || o.out_type === "float") s.out_type = o.out_type;
    if (o.off === "mute" || o.off === "bypass") s.off = o.off;
    if (o.lock === true) s.lock = true;
    if (o.free === true) s.free = true;
    if (o.hide_var === true) s.hide_var = true;
    if (o.marks === true) s.marks = true;
    if (iconName(o.icon)) s.icon = iconName(o.icon);
    if (hex(o.icon_color)) s.icon_color = hex(o.icon_color);
    if (hex(o.text_color)) s.text_color = hex(o.text_color);
    if (hex(o.tint)) s.tint = hex(o.tint);
    rows.push(s);
  }
  const cfg: SlidersConfig = { version: 1, rows };
  const pad = parsePad(d.pad);
  if (pad) cfg.pad = pad;
  return cfg;
}

function hasRows(raw: unknown): boolean {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      return false;
    }
  }
  return !!data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows);
}

const PAD_STYLES = new Set(["size", "stick", "map", "orbit", "mix"]);
function parsePad(raw: unknown): PadLooks | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const pad: PadLooks = {};
  if (typeof o.style === "string" && PAD_STYLES.has(o.style)) pad.style = o.style as PadLooks["style"];
  if (typeof o.ratio === "number" && o.ratio >= 0.25 && o.ratio <= 4) pad.ratio = o.ratio;
  if (o.fit === true) pad.fit = true;
  if (o.area === true) pad.area = true;
  if (o.no_crosshair === true) pad.no_crosshair = true;
  if (o.no_tint === true) pad.no_tint = true;
  if (typeof o.grid === "number" && Number.isInteger(o.grid) && o.grid >= 0 && o.grid <= 16) pad.grid = o.grid;
  if (o.snap_dots === true) pad.snap_dots = true;
  if (o.size === "s" || o.size === "m") pad.size = o.size;
  if (o.light === true) pad.light = true;
  return pad;
}

/** The pad's width over height: its own, or (with `fit`) the two ranges'. */
export function padRatio(pad: PadLooks, x: Pick<SliderRow, "min" | "max">, y: Pick<SliderRow, "min" | "max">): number {
  if (pad.style === "stick") return 1;
  if (!pad.fit) return pad.ratio ?? 1;
  const w = x.max - x.min;
  const h = y.max - y.min;
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min(4, Math.max(0.25, w / h));
}

/**
 * `target` with `from`'s range, decimals, snap, marks and (from a Words
 * axis) its words: the window's "Match X". The name, the variable, the
 * output, the looks and the target's own mode and text otherwise stay; the
 * value is kept inside the new range.
 */
export function matchAxis(target: SliderRow, from: SliderRow): SliderRow {
  const next: SliderRow = { ...target, min: from.min, max: from.max, step: from.step, decimals: from.decimals };
  next.value = Math.min(Math.max(target.value, from.min), Math.max(from.min, from.max));
  if (from.free) next.free = true;
  else delete next.free;
  if (from.marks) next.marks = true;
  else delete next.marks;
  if (from.mode === "words" && from.words) {
    next.mode = "words";
    next.words = from.words.map((w) => ({ ...w }));
  }
  return next;
}

/** The axis is still as a new node made it: named X / Y / Z, its variable
 *  x / y / z (or x_2 …), a plain 0..1 Number with no icon. */
function untouchedAxis(s: SliderRow, tag: string): boolean {
  return s.name === tag && new RegExp(`^${tag.toLowerCase()}(_\\d+)?$`).test(s.var)
    && s.min === 0 && s.max === 1 && s.mode === "number" && !s.icon && !s.text && !s.words;
}

/** What Size and Stick fill in on axes that are still untouched. */
const STYLE_AXES: Partial<Record<NonNullable<PadLooks["style"]>, [Partial<SliderRow>, Partial<SliderRow>]>> = {
  size: [
    { name: "Width", var: "width", icon: "arrows-h", min: 512, max: 2048, step: 64, decimals: 0, value: 1024 },
    { name: "Height", var: "height", icon: "arrows-v", min: 512, max: 2048, step: 64, decimals: 0, value: 1024 },
  ],
  stick: [
    { name: "Left / right", var: "stick_x", icon: "arrows-h", min: -1, max: 1, step: 0.05, decimals: 2, value: 0 },
    { name: "Down / up", var: "stick_y", icon: "arrows-v", min: -1, max: 1, step: 0.05, decimals: 2, value: 0 },
  ],
};

/**
 * The pad with `style` picked: Size and Stick also fill good X and Y
 * defaults (names, variables, icons, ranges) when both are still untouched,
 * and Size follows the ranges' shape (Auto) unless a shape was picked.
 * Anything the user changed stays as it is.
 */
export function withPadStyle(cfg: SlidersConfig, dims: 2 | 3, style: PadLooks["style"]): SlidersConfig {
  const pad: PadLooks = { ...(cfg.pad ?? {}) };
  if (style) pad.style = style;
  else delete pad.style;
  if (style === "size" && !pad.fit && pad.ratio === undefined) pad.fit = true;
  const rows = sliderRows(cfg);
  const axes = rows.slice(0, dims);
  const fill = style ? STYLE_AXES[style] : undefined;
  const [sx, sy] = axes;
  let nextAxes = axes;
  if (fill && sx && sy && untouchedAxis(sx, "X") && untouchedAxis(sy, "Y")) {
    nextAxes = axes.map((s, i) => {
      const f = fill[i];
      if (!f) return s;
      const others = { ...cfg, rows: rows.filter((r) => r.id !== s.id) };
      return { ...s, ...f, var: uniqueVar(f.var ?? s.var, others) };
    });
  }
  const next: SlidersConfig = { ...cfg, rows: [...nextAxes, ...cfg.rows.filter((r) => !axes.includes(r as SliderRow))] };
  if (Object.keys(pad).length) next.pad = pad;
  else delete next.pad;
  return next;
}

/** A Words axis's ranges as the pad's labelled bands (none for other modes). */
export function padBands(s: SliderRow): { to: number; label: string }[] {
  if (s.mode !== "words") return [];
  return (s.words ?? []).map((w) => ({ to: w.upto ?? s.max, label: w.word }));
}

export type PadAxis = "x" | "y" | "z";
const AXES: readonly PadAxis[] = ["x", "y", "z"];

/** A new pad axis: X across, Y up, Z the third number, 0 to 1. */
function padAxis(cfg: SlidersConfig, axis: PadAxis): SliderRow {
  const s = newSlider(cfg, axis.toUpperCase());
  return { ...s, var: uniqueVar(axis, cfg), value: 0.5, pin: true, out: AXES.indexOf(axis) + 1 };
}

/**
 * WP Slider 2D / 3D's config: exactly `dims` slider rows (X, Y and for 3D
 * Z), each with an output (slot 1, 2, 3); a missing axis is added. 3D also
 * keeps the first later row in text mode (the phrase, `padPhrase`, no
 * output); labels and any other rows are dropped.
 */
export function padConfig(raw: unknown, dims: 2 | 3 = 2): SlidersConfig {
  const parsed = parseSlidersConfig(raw);
  // An empty or broken value parses to WP Slider's default slider: start clean.
  const rows = hasRows(raw) ? sliderRows(parsed) : [];
  const axes = rows.slice(0, dims);
  const phrase = dims === 3 ? rows.slice(dims).find((s) => s.mode === "text") : undefined;
  const cfg: SlidersConfig = { version: 1, rows: axes };
  if (parsed.pad) cfg.pad = parsed.pad;
  if (dims === 2 && (cfg.pad?.style === "orbit" || cfg.pad?.style === "mix")) delete cfg.pad.style;
  for (let i = axes.length; i < dims; i++) cfg.rows.push(padAxis(cfg, AXES[i] ?? "z"));
  cfg.rows = sliderRows(cfg).map((s, i) => ({ ...s, pin: true, out: i + 1, style: "row" }));
  if (phrase) cfg.rows.push({ ...phrase, pin: false, out: 0, style: "row" });
  return cfg;
}

/** The pad's axes: X, Y (and Z on WP Slider 3D), without the phrase row. */
export function padAxes(cfg: SlidersConfig, dims: 2 | 3): SliderRow[] {
  return sliderRows(cfg).slice(0, dims);
}

/** WP Slider 3D's phrase row (text mode, after the axes), if any. */
export function padPhrase(cfg: SlidersConfig): SliderRow | undefined {
  return sliderRows(cfg).slice(3).find((s) => s.mode === "text");
}

/** The phrase as it reads now: each `$var` of the axes swapped for what it
 *  holds (the node resolves the rest at run time). */
export function phrasePreview(cfg: SlidersConfig): string {
  const p = padPhrase(cfg);
  if (!p?.text) return "";
  const vals = resolveSliders({ version: 1, rows: padAxes(cfg, 3) });
  return p.text.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, (m, name: string) => vals[name] ?? m);
}

export type OrbitKind = "camera" | "light";

const w = (word: string, upto?: number): SliderWord => (upto === undefined ? { word } : { word, upto });
/** Eight sides round the subject, each 45° wide, centred on its angle;
 *  the back takes both ends of -180..180. */
function sides(names: readonly string[]): SliderWord[] {
  const cuts = [-157.5, -112.5, -67.5, -22.5, 22.5, 67.5, 112.5, 157.5];
  return [...cuts.map((c, i) => w(names[i] ?? "", c)), w(names[0] ?? "")];
}

/** The Orbit style's word sets: one per axis, then the phrase. */
export const ORBIT_WORDS: Record<OrbitKind, {
  vars: [string, string, string, string];
  names: [string, string, string, string];
  side: SliderWord[]; height: SliderWord[]; distance: SliderWord[];
  heightMin: number; phrase: string;
}> = {
  camera: {
    vars: ["view_side", "view_height", "view_shot", "view"],
    names: ["Around", "Height", "Distance", "View"],
    side: sides(["back", "back-left", "left side", "front-left", "front", "front-right", "right side", "back-right"]),
    height: [w("worm's-eye view", -30), w("low angle", -10), w("eye level", 15), w("high angle", 60), w("bird's-eye view")],
    distance: [w("extreme close-up", 0.15), w("close-up", 0.35), w("medium shot", 0.55), w("full shot", 0.75), w("wide shot")],
    heightMin: -45,
    phrase: "$view_side view, $view_height, $view_shot",
  },
  light: {
    vars: ["light_side", "light_height", "light_soft", "light"],
    names: ["Around", "Height", "Distance", "Light"],
    side: sides([
      "backlight", "rim light from the back-left", "side light from the left", "light from the front-left",
      "front light", "light from the front-right", "side light from the right", "rim light from the back-right",
    ]),
    height: [w("low light", 20), w("high light", 60), w("overhead light")],
    distance: [w("soft light", 0.35), w("diffused light", 0.65), w("hard light")],
    heightMin: 0,
    phrase: "$light_side, $light_height, $light_soft",
  },
};

/**
 * Orbit's ready-made axes: around -180..180 by 15°, height by 5°, distance
 * 0..1, each in words mode (kept out of the prompt), plus the phrase that
 * joins them. Keeps each axis's id, output type and looks; variable names
 * already used by other rows get a number.
 */
export function orbitPreset(cfg: SlidersConfig, kind: OrbitKind): SlidersConfig {
  const set = ORBIT_WORDS[kind];
  const old = padAxes(cfg, 3);
  const others: SlidersConfig = { version: 1, rows: [] };
  const base = (i: number): SliderRow => old[i] ?? padAxis(others, AXES[i] ?? "z");
  const ranges = [
    { min: -180, max: 180, step: 15, decimals: 0, value: -45, words: set.side },
    { min: set.heightMin, max: 90, step: 5, decimals: 0, value: 30, words: set.height },
    { min: 0, max: 1, step: 0.05, decimals: 2, value: 0.5, words: set.distance },
  ];
  const axes: SliderRow[] = ranges.map((r, i) => {
    const s = base(i);
    const row: SliderRow = {
      ...s, ...r, name: set.names[i] ?? s.name, var: set.vars[i] ?? s.var, mode: "words",
      internal: true, pin: true, out: i + 1, style: "row",
    };
    delete row.text;
    delete row.free;
    return row;
  });
  const prev = padPhrase(cfg);
  const phrase: SliderRow = {
    ...(prev ?? newSlider(others, set.names[3])),
    name: set.names[3], var: set.vars[3], mode: "text", text: set.phrase, pin: false, out: 0, style: "row",
  };
  delete phrase.internal;
  const next: SlidersConfig = { version: 1, rows: [...axes, phrase] };
  next.pad = { ...(cfg.pad ?? {}), style: "orbit" };
  if (kind === "light") next.pad.light = true;
  else delete next.pad.light;
  return next;
}

/** Orbit fits these axes as they are: X turns -180..180 and Y is an angle. */
export function orbitReady(cfg: SlidersConfig): boolean {
  const [x, y] = padAxes(cfg, 3);
  return !!x && !!y && x.min === -180 && x.max === 180 && y.min >= -90 && y.max <= 90 && y.max > y.min;
}

/** Mix: how much of the blend each axis holds, 0..1 of its own range (its min = none, its max = all). */
export function mixParts(axes: readonly SliderRow[]): [number, number, number] {
  const part = (s: SliderRow | undefined): number => {
    if (!s || !(s.max > s.min)) return 0;
    return Math.min(1, Math.max(0, (s.value - s.min) / (s.max - s.min)));
  };
  return [part(axes[0]), part(axes[1]), part(axes[2])];
}

/** Mix: the axes' values for shares that add up to 100 (each a share of its own range, on its decimals). */
export function mixValues(axes: readonly SliderRow[], shares: readonly number[]): number[] {
  return axes.slice(0, 3).map((s, i) => {
    const t = Math.min(1, Math.max(0, (shares[i] ?? 0) / 100));
    const span = s.max > s.min ? s.max - s.min : 0;
    return sliderNumber({ value: s.min + t * span, decimals: s.decimals });
  });
}

const MIX_STEPS = [1, 2, 4, 5, 10, 20, 25, 50];
/** Mix: the triangle's step in percent: the finest axis step, on a step that divides 100. */
export function mixStep(axes: readonly SliderRow[]): number {
  const pcts = axes.slice(0, 3).filter((s) => s.max > s.min && s.step > 0).map((s) => (s.step / (s.max - s.min)) * 100);
  const want = pcts.length ? Math.min(...pcts) : 5;
  return [...MIX_STEPS].reverse().find((m) => m <= want + 1e-9) ?? 1;
}

/** The Mix style's ready-made blend: three art styles and the weighted phrase. */
export const MIX_EXAMPLE = {
  names: ["Watercolor", "Ink sketch", "Oil painting", "Style mix"] as const,
  vars: ["mix_a", "mix_b", "mix_c", "style_mix"] as const,
  values: [0.4, 0.3, 0.3] as const,
  phrase: "(watercolor:$mix_a), (ink sketch:$mix_b), (oil painting:$mix_c)",
};

/**
 * Mix's ready-made axes: three number axes 0..1 by 0.05 (kept out of the
 * prompt) holding a blend that adds up to 1, plus a phrase that weights each
 * one. Keeps each axis's id, output type and looks; variable names already
 * used by other rows get a number.
 */
export function mixPreset(cfg: SlidersConfig): SlidersConfig {
  const old = padAxes(cfg, 3);
  const others: SlidersConfig = { version: 1, rows: [] };
  const axes: SliderRow[] = [0, 1, 2].map((i) => {
    const s = old[i] ?? padAxis(others, AXES[i] ?? "z");
    const row: SliderRow = {
      ...s, name: MIX_EXAMPLE.names[i] ?? s.name, var: MIX_EXAMPLE.vars[i] ?? s.var, mode: "number",
      min: 0, max: 1, step: 0.05, decimals: 2, value: MIX_EXAMPLE.values[i] ?? 0,
      internal: true, pin: true, out: i + 1, style: "row",
    };
    delete row.text;
    delete row.words;
    delete row.free;
    return row;
  });
  const prev = padPhrase(cfg);
  const phrase: SliderRow = {
    ...(prev ?? newSlider(others, MIX_EXAMPLE.names[3])),
    name: MIX_EXAMPLE.names[3], var: MIX_EXAMPLE.vars[3], mode: "text", text: MIX_EXAMPLE.phrase, pin: false, out: 0, style: "row",
  };
  delete phrase.internal;
  const next: SlidersConfig = { version: 1, rows: [...axes, phrase] };
  next.pad = { ...(cfg.pad ?? {}), style: "mix" };
  delete next.pad.light;
  return next;
}

/**
 * The number as the variable writes it: `decimals` places, the way JS
 * `toFixed` rounds (the engine matches it), and never "-0".
 */
export function fmtSlider(s: Pick<SliderRow, "value" | "decimals">): string {
  const out = s.value.toFixed(s.decimals);
  return /^-0(\.0*)?$/.test(out) ? out.slice(1) : out;
}

/** The value rounded to its decimals. */
export function sliderNumber(s: Pick<SliderRow, "value" | "decimals">): number {
  return Number(fmtSlider(s));
}

/** Words mode: the range the value falls in. */
export function wordFor(s: SliderRow): SliderWord | undefined {
  const words = s.words ?? [];
  if (!words.length) return undefined;
  const v = sliderNumber(s);
  return words.find((w) => w.upto === undefined || v <= w.upto) ?? words[words.length - 1];
}

const usable = (s: SliderRow): boolean => !!s.var && VAR_RE.test(s.var);
/** Whether the row writes its variable at all (a muted row doesn't). */
const writes = (s: SliderRow): boolean => usable(s) && s.off !== "mute";

/** Words mode: what the variable holds, the picked word set into `text`
 *  where it says `{word}` (the word alone otherwise). */
export function wordText(s: SliderRow): string {
  const word = wordFor(s)?.word ?? fmtSlider(s);
  const text = s.text ?? "";
  return text.includes(WORD_SLOT) ? text.split(WORD_SLOT).join(word) : word;
}

/** Variable → what it holds (text mode unresolved; the node resolves it).
 *  A later row with the same variable wins. */
export function resolveSliders(cfg: SlidersConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sliderRows(cfg)) {
    if (!writes(s)) continue;
    if (s.off === "bypass") out[s.var] = fmtSlider(s);
    else if (s.mode === "text") out[s.var] = s.text ?? "";
    else if (s.mode === "words") out[s.var] = wordText(s);
    else out[s.var] = fmtSlider(s);
  }
  return out;
}

/** What a slider writes now, as the hover shows it: its number, its word,
 *  or its text with this node's `$name.num` and `$name` filled in (variables
 *  from other nodes stay as written; the node resolves them at run time). */
export function sliderWrites(cfg: SlidersConfig, s: SliderRow): string {
  if (s.off === "mute") return "";
  if (s.off === "bypass") return fmtSlider(s);
  const wordIn = s.mode === "words" && (s.text ?? "").includes(WORD_SLOT);
  if (s.mode === "words" && !wordIn) return wordText(s);
  if (s.mode !== "text" && !wordIn) return fmtSlider(s);
  const nums = sliderNums(cfg);
  const vals = resolveSliders(cfg);
  return (wordIn ? wordText(s) : s.text ?? "")
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\.num\b/g, (m, name: string) => nums[name] ?? m)
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)(?![.\w])/g, (m, name: string) => (name === s.var ? m : (vals[name] ?? m)));
}

/** Each variable's number as text, what `$name.num` reads. */
export function sliderNums(cfg: SlidersConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sliderRows(cfg)) if (writes(s)) out[s.var] = fmtSlider(s);
  return out;
}

/** The negative a slider's variable carries now ("" for none). */
export function sliderNegative(s: SliderRow): string {
  if (s.mode === "words") {
    const w = wordFor(s);
    if (w?.negative) return w.negative;
  }
  return s.negative ?? "";
}

/** Variable → its negative, left out when empty; the last row decides. */
export function ownSliderNegatives(cfg: SlidersConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sliderRows(cfg)) {
    if (!writes(s)) continue;
    const text = s.off === "bypass" ? "" : sliderNegative(s).trim();
    if (text) out[s.var] = text;
    else delete out[s.var];
  }
  return out;
}

/** Variables marked internal (the last row writing one decides). */
export function internalSliderVars(cfg: SlidersConfig): Set<string> {
  const flags = new Map<string, boolean>();
  for (const s of sliderRows(cfg)) if (writes(s)) flags.set(s.var, !!s.internal);
  return new Set([...flags].filter(([, v]) => v).map(([k]) => k));
}

/** Problems per slider id, as the widget shows them (the engine warns too). */
export function sliderProblems(cfg: SlidersConfig): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const s of sliderRows(cfg)) {
    if (s.max <= s.min) {
      out.set(s.id, "Max must be above Min");
      continue;
    }
    if (!s.var) {
      out.set(s.id, "No variable: the node writes nothing for this slider");
      continue;
    }
    if (!VAR_RE.test(s.var)) {
      out.set(s.id, "A variable starts with a letter and has only letters, digits and _");
      continue;
    }
    const other = seen.get(s.var);
    if (other !== undefined) out.set(s.id, `"${other}" also writes $${s.var}; this one wins`);
    else seen.set(s.var, s.name);
  }
  return out;
}

/** Pinned sliders in slot order (1, 2, …): by `out` when those are 1..N
 *  without gaps or repeats, else row order (the engine does the same). */
export function outputSlots(cfg: SlidersConfig): SliderRow[] {
  const pinned = sliderRows(cfg).filter((s) => s.pin).slice(0, MAX_OUTPUTS);
  const outs = pinned.map((s) => s.out).sort((a, b) => a - b);
  if (outs.every((o, i) => o === i + 1)) return [...pinned].sort((a, b) => a.out - b.out);
  return pinned;
}

/** The node's 16 number outputs (pinned sliders, then 0). */
/** What a slider's output sends: a whole number for an INT (rounded half away
 *  from zero, like engine `output_number`), else the number at its decimals. */
export function outputNumber(s: Pick<SliderRow, "value" | "decimals" | "out_type">): number {
  return sliderOutputType(s) === "INT" ? Number(s.value.toFixed(0)) || 0 : sliderNumber(s);
}

export function outputValues(cfg: SlidersConfig): number[] {
  const vals = outputSlots(cfg).map(outputNumber);
  return [...vals, ...Array<number>(MAX_OUTPUTS - vals.length).fill(0)];
}

/** The output type a slider's dot shows. */
export function sliderOutputType(s: Pick<SliderRow, "decimals" | "out_type">): "INT" | "FLOAT" {
  if (s.out_type) return s.out_type === "int" ? "INT" : "FLOAT";
  return s.decimals === 0 ? "INT" : "FLOAT";
}

/** Same config with every pinned `out` in 1..N (pins past 16 dropped) and
 *  unpinned `out` 0. Keeps valid slots as they are. */
export function normalizeOuts(cfg: SlidersConfig): SlidersConfig {
  let pins = 0;
  const rows = cfg.rows.map((r) => {
    if (r.kind !== "slider") return r;
    if (r.pin && pins < MAX_OUTPUTS) {
      pins++;
      return r;
    }
    return r.pin || r.out ? { ...r, pin: false, out: 0 } : r;
  });
  const capped = { ...cfg, rows };
  const slotOf = new Map(outputSlots(capped).map((s, i) => [s.id, i + 1]));
  return {
    ...capped,
    rows: rows.map((r) =>
      r.kind === "slider" && r.pin && r.out !== slotOf.get(r.id) ? { ...r, out: slotOf.get(r.id) ?? 0 } : r,
    ),
  };
}

export interface OutputPlan {
  /** `next` with every `out` set. */
  config: SlidersConfig;
  /** Slots to remove, highest first (each removal shifts later ones). */
  remove: number[];
  /** New slots to add at the end. */
  add: number;
}

/** What to do to the node's outputs to go from `prev` (normalized) to
 *  `next` (an edit: kept sliders carry their old `out`, a new pin any). */
export function planOutputs(prev: SlidersConfig, next: SlidersConfig): OutputPlan {
  const prevOut = new Map(sliderRows(prev).filter((s) => s.pin && s.out > 0).map((s) => [s.id, s.out]));
  const stillPinned = new Set(sliderRows(next).filter((s) => s.pin && prevOut.has(s.id)).map((s) => s.id));
  const remove = [...prevOut].filter(([id]) => !stillPinned.has(id)).map(([, o]) => o).sort((a, b) => b - a);
  let used = stillPinned.size;
  let add = 0;
  const rows = next.rows.map((r) => {
    if (r.kind !== "slider") return r;
    const old = prevOut.get(r.id);
    if (r.pin && old !== undefined) {
      const out = old - remove.filter((x) => x < old).length;
      return out === r.out ? r : { ...r, out };
    }
    if (r.pin && used < MAX_OUTPUTS) {
      used++;
      add++;
      return { ...r, out: used };
    }
    return r.pin || r.out ? { ...r, pin: false, out: 0 } : r;
  });
  return { config: { ...next, rows }, remove, add };
}

export interface SliderGroup {
  /** null for the sliders above the first label. */
  label: SliderLabelRow | null;
  sliders: SliderRow[];
}

/** Rows as label groups: a slider belongs to the label above it. */
export function groupsOf(cfg: SlidersConfig): SliderGroup[] {
  const groups: SliderGroup[] = [{ label: null, sliders: [] }];
  for (const r of cfg.rows) {
    if (r.kind === "label") groups.push({ label: r, sliders: [] });
    else groups[groups.length - 1].sliders.push(r);
  }
  return groups;
}

/** Rows shown in order: sliders under a folded label are left out. */
export function visibleRows(cfg: SlidersConfig): SlidersItem[] {
  return groupsOf(cfg).flatMap((g) => (g.label ? [g.label, ...(g.label.collapsed ? [] : g.sliders)] : g.sliders));
}

export type SliderDropEdge = "before" | "after" | "end";

/**
 * The rows after dropping row `fromId` beside `overId` (or at the end), or
 * null when nothing would change. A slider lands where it is dropped (after
 * a label: first in that group, which unfolds); a label moves with its
 * sliders and lands only before another label or at the end.
 */
export function dropSliderRow(
  cfg: SlidersConfig,
  fromId: string,
  overId: string,
  edge: SliderDropEdge,
): SlidersItem[] | null {
  const moved = cfg.rows.find((r) => r.id === fromId);
  const over = cfg.rows.find((r) => r.id === overId);
  if (!moved || !over) return null;
  let block: SlidersItem[] = [moved];
  if (moved.kind === "label") {
    const g = groupsOf(cfg).find((x) => x.label?.id === moved.id);
    block = [moved, ...(g?.sliders ?? [])];
  }
  const ids = new Set(block.map((r) => r.id));
  if (edge !== "end" && ids.has(over.id)) return null;
  let rest = cfg.rows.filter((r) => !ids.has(r.id));
  let at: number;
  if (edge === "end") at = rest.length;
  else if (moved.kind === "label") {
    // Between groups only: before a label, or after a group's last row.
    if (over.kind === "label" && edge === "before") at = rest.findIndex((r) => r.id === over.id);
    else {
      const og = groupsOf({ ...cfg, rows: rest }).find((g) => g.label?.id === over.id || g.sliders.some((s) => s.id === over.id));
      const last = og ? (og.label?.collapsed ? og.label.id : og.sliders[og.sliders.length - 1]?.id ?? og.label?.id) : undefined;
      if (edge !== "after" || last !== over.id || !og?.label) return null;
      at = rest.findIndex((r) => r.id === over.id) + 1;
    }
  } else {
    const i = rest.findIndex((r) => r.id === over.id);
    at = edge === "before" ? i : i + 1;
    if (over.kind === "label" && edge === "after" && over.collapsed) {
      rest = rest.map((r) => (r.id === over.id ? { ...over, collapsed: false } : r));
    }
  }
  const rows = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  const same = rows.length === cfg.rows.length && rows.every((r, i) => {
    const o = cfg.rows[i];
    return o?.id === r.id && (r.kind !== "label" || o.kind !== "label" || !!r.collapsed === !!o.collapsed);
  });
  return same ? null : rows;
}

/** The finest step a drag can land on: one unit of the last decimal, when
 *  that is finer than `step` (Shift drags at it; `free` always does). */
export function fineStepOf(s: Pick<SliderRow, "step" | "decimals">): number | undefined {
  const unit = Number((0.1 ** s.decimals).toFixed(s.decimals));
  return unit > 0 && unit < s.step ? unit : undefined;
}

/** Rows to draw for one group: faders standing next to each other share a
 *  strip, every other slider is a row of its own. */
export type SliderRun = { kind: "row"; s: SliderRow } | { kind: "faders"; faders: SliderRow[] };
export function sliderRuns(sliders: SliderRow[]): SliderRun[] {
  const out: SliderRun[] = [];
  for (const s of sliders) {
    const last = out[out.length - 1];
    if (s.style !== "fader") out.push({ kind: "row", s });
    else if (last?.kind === "faders") last.faders.push(s);
    else out.push({ kind: "faders", faders: [s] });
  }
  return out;
}

/** Decimals a number is written with (0.05 → 2, 1e-7 → 7). */
function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const t = n.toString();
  const e = /e-(\d+)$/.exec(t);
  if (e) return Number(e[1]);
  return t.split(".")[1]?.length ?? 0;
}

/**
 * A range edit that keeps the other fields in step with the one changed:
 * fewer decimals round the step (never below one unit: 0 decimals turns a
 * 0.05 step into 1) and the min and max; a finer step raises the decimals
 * so the step can be written; a min past the max moves the max with it.
 */
export function fitRange(
  s: Pick<SliderRow, "min" | "max" | "step" | "decimals">,
  p: { min?: number | null; max?: number | null; step?: number | null; decimals?: number | null },
): { min: number; max: number; step: number; decimals: number } {
  let decimals = p.decimals != null ? Math.max(0, Math.min(MAX_DECIMALS, Math.round(p.decimals))) : s.decimals;
  let step = p.step != null && p.step > 0 ? p.step : s.step;
  let min = p.min ?? s.min;
  let max = p.max ?? s.max;
  const round = (v: number, d: number): number => Number(v.toFixed(d));
  if (p.decimals != null) {
    const unit = round(0.1 ** decimals, decimals);
    step = Math.max(unit, round(step, decimals));
    min = round(min, decimals);
    max = round(max, decimals);
  } else if (p.step != null) {
    decimals = Math.min(MAX_DECIMALS, Math.max(decimals, decimalsOf(step)));
  }
  if (p.min != null && min >= max) max = round(min + step, decimals);
  if (p.max != null && max <= min) min = round(max - step, decimals);
  return { min, max, step, decimals };
}

/** Most ticks a Number or Text slider draws along its track. */
export const SLIDER_MARKS_MAX = 9;
/**
 * Track marks while `marks` is on: in Words mode a tick where each word's
 * range ends; otherwise evenly spaced ticks on the steps (at most
 * `SLIDER_MARKS_MAX`). The two ends never get one: the track ends there.
 */
export function sliderMarks(s: SliderRow): { value: number }[] {
  if (!s.marks || !(s.max > s.min)) return [];
  const vals = s.mode === "words"
    ? (s.words ?? []).map((w) => w.upto).filter((u): u is number => u !== undefined && u > s.min && u < s.max)
    : stepDots(s.min, s.max, s.step, SLIDER_MARKS_MAX);
  return [...new Set(vals)].sort((a, b) => a - b).map((value) => ({ value }));
}

export const SLIDER_NODE = "WP_Slider";
/** WP Slider 2D: the same widget JSON with two rows, X then Y (+ `pad`). */
export const SLIDER_2D_NODE = "WP_Slider2D";
/** WP Slider 3D: three rows, X, Y, Z, then an optional text-mode phrase. */
export const SLIDER_3D_NODE = "WP_Slider3D";
/** Nodes whose `wp_sliders` widget graph walkers read as sliders. */
export function isSliderNode(type: string | undefined): boolean {
  return type === SLIDER_NODE || type === SLIDER_2D_NODE || type === SLIDER_3D_NODE;
}

interface SlidersNodeLike {
  widgets?: { name: string; value?: unknown }[];
}

/** The node's config, read off its widget (graph walkers). */
export function nodeSlidersConfig(node: SlidersNodeLike): SlidersConfig {
  return parseSlidersConfig(node.widgets?.find((w) => w.name === "wp_sliders")?.value ?? "");
}

/** What the node writes, for the static chain preview. */
export function staticSliderValues(node: SlidersNodeLike): Record<string, string> {
  return resolveSliders(nodeSlidersConfig(node));
}

/** Each variable the node writes → the negative it carries now ("" for none). */
export function staticSliderNegatives(node: SlidersNodeLike): Record<string, string> {
  const cfg = nodeSlidersConfig(node);
  const own = ownSliderNegatives(cfg);
  const out: Record<string, string> = {};
  for (const v of Object.keys(resolveSliders(cfg))) out[v] = own[v] ?? "";
  return out;
}

/** The node's variables that stay out of the prompt. */
export function staticSliderInternals(node: SlidersNodeLike): Set<string> {
  return internalSliderVars(nodeSlidersConfig(node));
}

/** The node's `$name.num` table. */
export function staticSliderNums(node: SlidersNodeLike): Record<string, string> {
  return sliderNums(nodeSlidersConfig(node));
}

/** fixed_values steps standing in for the node (preview API): one for the
 *  variables that show in the prompt, one internal one for the rest. */
export function slidersPreviewModules(node: SlidersNodeLike): Record<string, unknown>[] {
  const cfg = nodeSlidersConfig(node);
  const hidden = internalSliderVars(cfg);
  const negs = ownSliderNegatives(cfg);
  const all = Object.entries(resolveSliders(cfg)).map(([variable_name, value]) => ({
    variable_name, value, ...(negs[variable_name] ? { negative: negs[variable_name] } : {}),
  }));
  const step = (id: string, entries: typeof all, internal: boolean): Record<string, unknown> => ({
    id, type: "fixed_values", enabled: true,
    meta: { name: "WP Slider" }, entries, instance: internal ? { internal: true } : {},
  });
  const shown = all.filter((e) => !hidden.has(e.variable_name));
  const kept = all.filter((e) => hidden.has(e.variable_name));
  const out: Record<string, unknown>[] = [];
  if (shown.length) out.push(step("51d0f0fe", shown, false));
  if (kept.length || !shown.length) out.push(step("51d0f0fd", kept, true));
  return out;
}
