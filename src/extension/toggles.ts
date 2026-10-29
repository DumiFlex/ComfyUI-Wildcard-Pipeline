/**
 * WP_Toggles: the widget value, how toggles resolve, and which BOOLEAN
 * output each pinned toggle drives. Pure logic, no DOM.
 *
 * Resolution mirrors `engine/toggles.py` via the shared
 * `tests/fixtures/toggles-corpus.json`; keep the two in step.
 *
 * Outputs: the node declares the context plus {@link MAX_OUTPUTS} BOOLEANs
 * (ComfyUI V3 has no dynamic outputs) and the canvas shows only the pinned
 * ones. Each pinned toggle's `out` is its output slot (1-based; slot 0 is
 * the context). Slots never follow row order: a reorder moves the dot with
 * its row, so no link ever has to be re-pointed. Unpinning a toggle removes
 * its slot (`removeOutput` shifts the links of later slots down itself) and
 * every higher `out` drops by one; a new pin takes the next free slot.
 */

/** BOOLEAN outputs the node declares. Never lower it (saved links). */
export const MAX_OUTPUTS = 16;
export const TOGGLE_STYLES = ["switch", "checkbox", "buttons", "chip"] as const;
export type ToggleStyle = (typeof TOGGLE_STYLES)[number];
export type TogglesMode = "any" | "one";

export interface ToggleRow {
  id: string;
  kind: "toggle";
  name: string;
  /** Variable name without `$`. */
  var: string;
  on: boolean;
  /** Has a BOOLEAN output. */
  pin: boolean;
  /** Output slot (1..16) while pinned, else 0. */
  out: number;
  style: ToggleStyle;
  on_label?: string;
  off_label?: string;
  /** Id of the toggle this one needs (Any on mode). */
  needs?: string;
  /** An upstream yes/no value for `var` sets the switch (`withUpstream`). */
  upstream?: true;
  /** Frontend only: off mutes or bypasses the wired nodes and `groups`. */
  control?: ToggleControl;
  /** Canvas group titles `control` also covers. */
  groups?: string[];
  /** `control` acts while the toggle is ON instead of off. */
  invert?: true;
  /** Clean view: no `$variable` line under the name. */
  hide_var?: true;
  /** Pick one: what the picked variable gets instead of the name (may read `$vars`). */
  value?: string;
}

export const TOGGLE_CONTROLS = ["mute", "bypass"] as const;
export type ToggleControl = (typeof TOGGLE_CONTROLS)[number];

export interface LabelRow {
  id: string;
  kind: "label";
  name: string;
  /** Variable colour 1..8. */
  color: number;
  collapsed?: boolean;
}

export type TogglesItem = ToggleRow | LabelRow;

export interface TogglesConfig {
  version: 1;
  mode: TogglesMode;
  /** Pick one: also write the picked toggle's value (or name) here. */
  group_var: string;
  rows: TogglesItem[];
  /** Pick one: the picked variable prints in the prompt (else internal). */
  group_visible?: true;
  /** Pick one: an upstream `group_var` naming a toggle picks it. */
  group_upstream?: true;
  /** Set by `withUpstream` only, never saved: the toggle the upstream
   *  `group_var` picked, and the toggles upstream set to a yes word. */
  forced?: string;
  upstream_on?: string[];
}

export const VAR_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const TRUTHY = new Set(["true", "yes", "on", "1"]);
const FALSY = new Set(["false", "no", "off", "0"]);

/** An upstream value as a switch position, or null when it isn't a lone
 *  yes/no word (mirror of `engine/toggles.py::upstream_bool`). */
export function upstreamBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const low = value.trim().toLowerCase();
  if (TRUTHY.has(low)) return true;
  if (FALSY.has(low)) return false;
  return null;
}

/** `cfg` with each `upstream` toggle's switch set from `upstream` values
 *  (mirror of `with_upstream`); `set` lists the toggles it set. */
export function withUpstream(
  cfg: TogglesConfig,
  upstream: Record<string, unknown> | null | undefined,
): { config: TogglesConfig; set: string[] } {
  if (!upstream) return { config: cfg, set: [] };
  const set: string[] = [];
  const on: string[] = [];
  const rows = cfg.rows.map((r) => {
    if (r.kind !== "toggle" || !r.upstream || !r.var) return r;
    const v = upstreamBool(upstream[r.var]);
    if (v === null) return r;
    set.push(r.id);
    if (v) on.push(r.id);
    return { ...r, on: v };
  });
  const config: TogglesConfig = { ...cfg, rows, upstream_on: on };
  const named = cfg.group_var ? upstream[cfg.group_var] : undefined;
  if (cfg.mode === "one" && cfg.group_upstream && typeof named === "string" && named.trim()) {
    const key = named.trim().toLowerCase();
    const hit = toggleRows(config).find((t) => key === t.name.toLowerCase() || key === t.var.toLowerCase());
    if (hit) {
      config.forced = hit.id;
      set.push(hit.id);
    }
  }
  return { config, set };
}

export function newToggleId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "Use subject LoRA?" → "use_subject_lora". Starts with a letter. */
export function varFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return /^[a-z]/.test(slug) ? slug : `t_${slug}`;
}

/** A variable no other toggle on the node uses yet. */
export function uniqueVar(base: string, cfg: TogglesConfig, exceptId?: string): string {
  const taken = new Set(toggleRows(cfg).filter((t) => t.id !== exceptId).map((t) => t.var));
  if (cfg.group_var) taken.add(cfg.group_var);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function newToggle(cfg: TogglesConfig, name?: string): ToggleRow {
  const n = toggleRows(cfg).length + 1;
  const label = name ?? `Toggle ${n}`;
  return {
    id: newToggleId(),
    kind: "toggle",
    name: label,
    var: uniqueVar(varFromName(label) || `toggle_${n}`, cfg),
    on: false,
    pin: true,
    out: 0,
    style: "switch",
  };
}

export function defaultTogglesConfig(): TogglesConfig {
  const cfg: TogglesConfig = { version: 1, mode: "any", group_var: "", rows: [] };
  const first = newToggle(cfg);
  first.out = 1;
  cfg.rows.push(first);
  return cfg;
}

export function toggleRows(cfg: TogglesConfig): ToggleRow[] {
  return cfg.rows.filter((r): r is ToggleRow => r.kind === "toggle");
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function parseTogglesConfig(raw: unknown): TogglesConfig {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return defaultTogglesConfig();
  const d = data as Record<string, unknown>;
  const rows: TogglesItem[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(d.rows) ? d.rows : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    let id = str(o.id);
    if (!id || seen.has(id)) id = newToggleId();
    seen.add(id);
    if (o.kind === "label") {
      const c = typeof o.color === "number" && o.color >= 1 && o.color <= 8 ? Math.round(o.color) : 1;
      const label: LabelRow = { id, kind: "label", name: str(o.name), color: c };
      if (o.collapsed === true) label.collapsed = true;
      rows.push(label);
      continue;
    }
    if (o.kind !== undefined && o.kind !== "toggle") continue;
    const style = TOGGLE_STYLES.includes(o.style as ToggleStyle) ? (o.style as ToggleStyle) : "switch";
    const out = typeof o.out === "number" && Number.isInteger(o.out) ? o.out : 0;
    const t: ToggleRow = {
      id,
      kind: "toggle",
      name: str(o.name) || id,
      var: str(o.var),
      on: o.on === true,
      pin: o.pin === true,
      out: o.pin === true ? out : 0,
      style,
    };
    if (str(o.on_label)) t.on_label = str(o.on_label);
    if (str(o.off_label)) t.off_label = str(o.off_label);
    if (str(o.needs)) t.needs = str(o.needs);
    if (typeof o.value === "string" && o.value) t.value = o.value;
    if (o.upstream === true) t.upstream = true;
    if (TOGGLE_CONTROLS.includes(o.control as ToggleControl)) t.control = o.control as ToggleControl;
    if (o.invert === true) t.invert = true;
    if (o.hide_var === true) t.hide_var = true;
    const groups = Array.isArray(o.groups) ? o.groups.map(str).filter(Boolean) : [];
    if (groups.length) t.groups = [...new Set(groups)];
    rows.push(t);
  }
  const cfg: TogglesConfig = {
    version: 1,
    mode: d.mode === "one" ? "one" : "any",
    group_var: str(d.group_var),
    rows,
  };
  if (d.group_visible === true) cfg.group_visible = true;
  if (d.group_upstream === true) cfg.group_upstream = true;
  return cfg;
}

/** Pick one: the toggle that is on. First match wins: the one the upstream
 *  picked variable names, the first one upstream set on, the first one on. */
export function pickedId(cfg: TogglesConfig): string | undefined {
  const toggles = toggleRows(cfg);
  const ids = new Set(toggles.map((t) => t.id));
  if (cfg.forced && ids.has(cfg.forced)) return cfg.forced;
  const up = (cfg.upstream_on ?? []).find((id) => ids.has(id));
  return up ?? toggles.find((t) => t.on)?.id;
}

/** Toggle id → on after `needs` (Any on) or the Pick one rules. */
export function effectiveToggles(cfg: TogglesConfig): Map<string, boolean> {
  const toggles = toggleRows(cfg);
  const out = new Map<string, boolean>();
  if (cfg.mode === "one") {
    const picked = pickedId(cfg);
    for (const t of toggles) out.set(t.id, t.id === picked);
    return out;
  }
  const byId = new Map(toggles.map((t) => [t.id, t]));
  const eff = (id: string, seen: Set<string>): boolean => {
    const memo = out.get(id);
    if (memo !== undefined) return memo;
    const t = byId.get(id);
    if (!t || seen.has(id)) return false;
    const val = t.on && (!t.needs || eff(t.needs, new Set([...seen, id])));
    out.set(id, val);
    return val;
  };
  for (const t of toggles) eff(t.id, new Set());
  return out;
}

/** Variable → "true" / "false" (+ the Pick one variable), as the node writes. */
export function resolveToggles(cfg: TogglesConfig): Record<string, string> {
  const eff = effectiveToggles(cfg);
  const values: Record<string, string> = {};
  for (const t of toggleRows(cfg)) {
    if (t.var && VAR_RE.test(t.var)) values[t.var] = eff.get(t.id) ? "true" : "false";
  }
  if (cfg.mode === "one" && cfg.group_var && VAR_RE.test(cfg.group_var)) {
    const picked = toggleRows(cfg).find((t) => eff.get(t.id));
    values[cfg.group_var] = picked ? picked.value || picked.name : "";
  }
  return values;
}

/** Pinned toggles in slot order (1, 2, …): by `out` when those are 1..N
 *  without gaps or repeats, else row order (the engine does the same). */
export function outputSlots(cfg: TogglesConfig): ToggleRow[] {
  const pinned = toggleRows(cfg).filter((t) => t.pin).slice(0, MAX_OUTPUTS);
  const outs = pinned.map((t) => t.out).sort((a, b) => a - b);
  if (outs.every((o, i) => o === i + 1)) return [...pinned].sort((a, b) => a.out - b.out);
  return pinned;
}

/** The node's 16 BOOLEAN outputs. */
export function outputValues(cfg: TogglesConfig): boolean[] {
  const eff = effectiveToggles(cfg);
  const vals = outputSlots(cfg).map((t) => eff.get(t.id) ?? false);
  return [...vals, ...Array<boolean>(MAX_OUTPUTS - vals.length).fill(false)];
}

/** Same config with every pinned `out` in 1..N (N ≤ 16; pins past 16 are
 *  dropped) and unpinned `out` 0. Keeps valid slots as they are. */
export function normalizeOuts(cfg: TogglesConfig): TogglesConfig {
  let pins = 0;
  const rows = cfg.rows.map((r) => {
    if (r.kind !== "toggle") return r;
    if (r.pin && pins < MAX_OUTPUTS) {
      pins++;
      return r;
    }
    return r.pin || r.out ? { ...r, pin: false, out: 0 } : r;
  });
  const capped = { ...cfg, rows };
  const slots = outputSlots(capped);
  const slotOf = new Map(slots.map((t, i) => [t.id, i + 1]));
  return {
    ...capped,
    rows: rows.map((r) =>
      r.kind === "toggle" && r.pin && r.out !== slotOf.get(r.id) ? { ...r, out: slotOf.get(r.id) ?? 0 } : r,
    ),
  };
}

export interface OutputPlan {
  /** `next` with every `out` set. */
  config: TogglesConfig;
  /** Slots to remove, highest first (each removal shifts later ones). */
  remove: number[];
  /** New slots to add at the end. */
  add: number;
}

/**
 * What to do to the node's outputs to go from `prev` (already normalized)
 * to `next` (an edit: kept toggles carry their old `out`, a new pin any).
 */
export function planOutputs(prev: TogglesConfig, next: TogglesConfig): OutputPlan {
  const prevOut = new Map(toggleRows(prev).filter((t) => t.pin && t.out > 0).map((t) => [t.id, t.out]));
  const stillPinned = new Set(toggleRows(next).filter((t) => t.pin && prevOut.has(t.id)).map((t) => t.id));
  const remove = [...prevOut].filter(([id]) => !stillPinned.has(id)).map(([, o]) => o).sort((a, b) => b - a);
  let used = stillPinned.size;
  let add = 0;
  const rows = next.rows.map((r) => {
    if (r.kind !== "toggle") return r;
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

/** Would `id` needing `parent` make a loop? */
export function needsLoop(cfg: TogglesConfig, id: string, parent: string): boolean {
  const byId = new Map(toggleRows(cfg).map((t) => [t.id, t]));
  const seen = new Set<string>([id]);
  let cur: string | undefined = parent;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.needs;
  }
  return false;
}

/** Problems per toggle id (and `"group"` for the Pick one variable), as the
 *  widget shows them. The engine warns about the same at run time. */
export function toggleProblems(cfg: TogglesConfig): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const t of toggleRows(cfg)) {
    if (!t.var) {
      out.set(t.id, "No variable: the node writes nothing for this toggle");
      continue;
    }
    if (!VAR_RE.test(t.var)) {
      out.set(t.id, "A variable starts with a letter and has only letters, digits and _");
      continue;
    }
    const other = seen.get(t.var);
    if (other !== undefined) out.set(t.id, `"${other}" also writes $${t.var}; this one wins`);
    else seen.set(t.var, t.name);
  }
  if (cfg.mode === "one" && cfg.group_var) {
    if (!VAR_RE.test(cfg.group_var)) out.set("group", "A variable starts with a letter and has only letters, digits and _");
    else if (seen.has(cfg.group_var)) out.set("group", `A toggle also writes $${cfg.group_var}`);
  }
  return out;
}

export interface ToggleGroup {
  /** null for the toggles above the first label. */
  label: LabelRow | null;
  toggles: ToggleRow[];
}

/** Rows as label groups (toggles belong to the label above them). */
export function groupsOf(cfg: TogglesConfig): ToggleGroup[] {
  const groups: ToggleGroup[] = [{ label: null, toggles: [] }];
  for (const r of cfg.rows) {
    if (r.kind === "label") groups.push({ label: r, toggles: [] });
    else groups[groups.length - 1].toggles.push(r);
  }
  return groups;
}

export function rowsOf(groups: ToggleGroup[]): TogglesItem[] {
  return groups.flatMap((g) => (g.label ? [g.label, ...g.toggles] : g.toggles));
}

/** Depth of a toggle in its needs chain (0 = needs nothing), for the indent. */
export function needsDepth(cfg: TogglesConfig, id: string): number {
  const byId = new Map(toggleRows(cfg).map((t) => [t.id, t]));
  let depth = 0;
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.needs;
  while (cur && byId.has(cur) && !seen.has(cur) && depth < 4) {
    seen.add(cur);
    depth++;
    cur = byId.get(cur)?.needs;
  }
  return depth;
}

export const TOGGLES_NODE = "WP_Toggles";

interface TogglesNodeLike {
  widgets?: { name: string; value?: unknown }[];
}

/** The node's config, read off its widget (graph walkers). */
export function nodeTogglesConfig(node: TogglesNodeLike): TogglesConfig {
  return parseTogglesConfig(node.widgets?.find((w) => w.name === "wp_toggles")?.value ?? "");
}

/** What the node writes (all internal), for the static chain preview. */
export function staticToggleValues(node: TogglesNodeLike): Record<string, string> {
  return resolveToggles(nodeTogglesConfig(node));
}

/** One internal fixed_values step standing in for the node (preview API). */
export function togglesPreviewModules(node: TogglesNodeLike): Record<string, unknown>[] {
  const entries = Object.entries(staticToggleValues(node)).map(([variable_name, value]) => ({ variable_name, value }));
  return [{
    id: "0de1f0fd", type: "fixed_values", enabled: true,
    meta: { name: "WP Toggles" }, entries, instance: { internal: true },
  }];
}
