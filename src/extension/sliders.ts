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

/** Number outputs the node declares. Never lower it (saved links). */
export const MAX_OUTPUTS = 16;
export const SLIDER_MODES = ["number", "text", "words"] as const;
export type SliderMode = (typeof SLIDER_MODES)[number];
/** Looks. Only `row` is drawn today; the others wait on their kit pieces
 *  and fall back to `row`. */
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
  /** Text mode: what the variable gets (may read `$vars` and `$name.num`). */
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
  style: SliderStyle;
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

export interface SlidersConfig {
  version: 1;
  rows: SlidersItem[];
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
    if (o.hide_var === true) s.hide_var = true;
    if (o.marks === true) s.marks = true;
    if (iconName(o.icon)) s.icon = iconName(o.icon);
    if (hex(o.icon_color)) s.icon_color = hex(o.icon_color);
    if (hex(o.text_color)) s.text_color = hex(o.text_color);
    if (hex(o.tint)) s.tint = hex(o.tint);
    rows.push(s);
  }
  return { version: 1, rows };
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

/** Variable → what it holds (text mode unresolved; the node resolves it).
 *  A later row with the same variable wins. */
export function resolveSliders(cfg: SlidersConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sliderRows(cfg)) {
    if (!usable(s)) continue;
    if (s.mode === "text") out[s.var] = s.text ?? "";
    else if (s.mode === "words") out[s.var] = wordFor(s)?.word ?? fmtSlider(s);
    else out[s.var] = fmtSlider(s);
  }
  return out;
}

/** Each variable's number as text, what `$name.num` reads. */
export function sliderNums(cfg: SlidersConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sliderRows(cfg)) if (usable(s)) out[s.var] = fmtSlider(s);
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
    if (!usable(s)) continue;
    const text = sliderNegative(s).trim();
    if (text) out[s.var] = text;
    else delete out[s.var];
  }
  return out;
}

/** Variables marked internal (the last row writing one decides). */
export function internalSliderVars(cfg: SlidersConfig): Set<string> {
  const flags = new Map<string, boolean>();
  for (const s of sliderRows(cfg)) if (usable(s)) flags.set(s.var, !!s.internal);
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

/** Track marks: each Words range end, plus the ends while `marks` is on. */
export function sliderMarks(s: SliderRow): { value: number; label?: string }[] {
  if (!s.marks) return [];
  const ends = s.mode === "words" ? (s.words ?? []).map((w) => w.upto).filter((u): u is number => u !== undefined) : [];
  const vals = [...new Set([s.min, ...ends, s.max])].filter((v) => v >= s.min && v <= s.max).sort((a, b) => a - b);
  return vals.map((value) => ({ value }));
}

export const SLIDER_NODE = "WP_Slider";

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
