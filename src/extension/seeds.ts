/**
 * WP Seeds config + seed maths — TS mirror of `engine/seeds.py`.
 *
 * The node's widget value is a `SeedsConfig` (`{version: 1, rows}`); a row is
 * a label or a seed. A seed row's start seed follows the node's base seed (made
 * from the base seed and the row's NAME) or is its own value (random: rerolled on the
 * canvas after each queue; fixed: never). Inside a Context Loop every frame
 * gets its own seed (`per_frame: "new"`, frame 0 is the base) or the base
 * (`same`); `locks` pin a frame's seed. Parity with the engine is held by
 * `tests/fixtures/seeds-corpus.json`. `base_from_loop` takes the node's base
 * seed from the upstream Context Loop's `seed` (like WP Seed List).
 *
 * Outputs: the node declares the context plus {@link MAX_OUTPUTS} INTs; a
 * pinned row drives `seed_<out>`. `normalizeOuts` / `planOutputs` keep `out`
 * in 1..N the way WP Toggles does.
 */
import { hashSeed, maskSeed } from "../components/shared/seed-derive";

export const MAX_OUTPUTS = 16;
export type SeedMode = "follow" | "random" | "fixed";
export type PerFrame = "new" | "same";
export const SEED_MODES: readonly SeedMode[] = ["follow", "random", "fixed"];

export interface SeedRow {
  id: string;
  kind: "seed";
  name: string;
  mode: SeedMode;
  /** Own seed (random / fixed rows). */
  value: number;
  per_frame: PerFrame;
  /** Has an INT output. */
  pin: boolean;
  /** Output slot (1-based; 0 when not pinned). */
  out: number;
  /** 0-based frame → locked seed. */
  locks?: Record<string, number> | undefined;
}

export interface SeedLabel {
  id: string;
  kind: "label";
  name: string;
  /** Folded on the node (its rows hidden). */
  collapsed?: boolean | undefined;
}

export type SeedsItem = SeedRow | SeedLabel;

export interface SeedsConfig {
  version: 1;
  rows: SeedsItem[];
  /** The base seed is the upstream Context Loop's seed (stored only as true). */
  base_from_loop?: true | undefined;
}

export const defaultSeedsConfig = (): SeedsConfig => ({ version: 1, rows: [] });

/** How a row name is matched: trimmed, inner spaces collapsed, case-folded. */
export function nameKey(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}

export function seedRows(cfg: SeedsConfig): SeedRow[] {
  return cfg.rows.filter((r): r is SeedRow => r.kind === "seed");
}

export function newSeedId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A typed-in seed kept in range (whole, ≥ 0, 50 bits). */
export function maskSeedValue(v: number): number {
  return Number.isFinite(v) ? maskSeed(Math.max(0, Math.trunc(v))) : 0;
}

/** A random seed in ComfyUI's randomize range (50 bits). */
export function randomSeed(): number {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return Number(v & ((1n << 50n) - 1n));
}

/** A name not used by another row ("Seed", "Seed 2" …). */
export function uniqueName(cfg: SeedsConfig, base = "Seed", except?: string): string {
  const taken = new Set(seedRows(cfg).filter((r) => r.id !== except).map((r) => nameKey(r.name)));
  if (!taken.has(nameKey(base))) return base;
  for (let n = 2; ; n++) if (!taken.has(nameKey(`${base} ${n}`))) return `${base} ${n}`;
}

export function newSeedRow(cfg: SeedsConfig, name?: string): SeedRow {
  return {
    id: newSeedId(),
    kind: "seed",
    name: uniqueName(cfg, name ?? "Seed"),
    mode: "follow",
    value: randomSeed(),
    per_frame: "new",
    pin: false,
    out: 0,
  };
}

/** A follow row's start seed: stable per (node base seed, row name). */
export function namedSeed(base: number, name: string): number {
  return hashSeed(`seeds:${maskSeed(base)}:${nameKey(name)}`);
}

/** Frame `index`'s seed for a row whose frame-0 seed is `base`. */
export function frameSeed(base: number, index: number): number {
  if (index <= 0) return maskSeed(base);
  return hashSeed(`${maskSeed(base)}:${Math.trunc(index)}`);
}

/** The row's seed before frames and locks (`engine/seeds.py:row_base`). */
export function baseSeed(row: SeedRow, base: number): number {
  return row.mode === "follow" ? namedSeed(base, row.name) : maskSeed(row.value);
}

export function lockOf(row: SeedRow, index: number): number | undefined {
  const v = row.locks?.[String(index)];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? maskSeed(v) : undefined;
}

/** The row's seed on frame `index` (a lock wins). */
export function rowSeed(row: SeedRow, base: number, index: number): number {
  const locked = lockOf(row, index);
  if (locked !== undefined) return locked;
  const start = baseSeed(row, base);
  return row.per_frame === "same" ? start : frameSeed(start, index);
}

/** The mode after `mode` in the row's cycle button: Follow → Random → Fixed. */
export function nextMode(mode: SeedMode): SeedMode {
  return SEED_MODES[(SEED_MODES.indexOf(mode) + 1) % SEED_MODES.length] ?? "follow";
}

/** Same row in `mode`. Leaving Follow keeps the seed it had, so a row only
 *  changes seed when it starts to follow the base seed again. */
export function withMode(row: SeedRow, mode: SeedMode, base: number): SeedRow {
  if (mode === row.mode) return row;
  return row.mode === "follow" ? { ...row, mode, value: namedSeed(base, row.name) } : { ...row, mode };
}

/** Same row set to Fixed on `seed`: "Use last run's seed" (the seed it
 *  started from last run, so a Random row that rolled on gets it back). */
export function withLastSeed(row: SeedRow, seed: number): SeedRow {
  return { ...row, mode: "fixed", value: maskSeed(seed) };
}

/** Same row with frame `index` locked to `seed`, or unlocked when `seed` is null. */
export function withLock(row: SeedRow, index: number, seed: number | null): SeedRow {
  const locks = { ...(row.locks ?? {}) };
  if (seed === null) delete locks[String(index)];
  else locks[String(index)] = maskSeed(seed);
  const next: SeedRow = { ...row, locks };
  if (!Object.keys(locks).length) delete next.locks;
  return next;
}

/** Group a seed in threes for reading ("731 402 118"). */
export function formatSeed(seed: number): string {
  return String(seed).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A row and the label it sits under (rows before the first label: none). */
export interface SeedGroup {
  label: SeedLabel | null;
  rows: SeedRow[];
}
export function seedGroups(cfg: SeedsConfig): SeedGroup[] {
  const out: SeedGroup[] = [{ label: null, rows: [] }];
  for (const r of cfg.rows) {
    if (r.kind === "label") out.push({ label: r, rows: [] });
    else out[out.length - 1]?.rows.push(r);
  }
  return out.filter((g) => g.label || g.rows.length);
}

/** Problems per row id, as the widget shows them. */
export function seedProblems(cfg: SeedsConfig): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const r of seedRows(cfg)) {
    const key = nameKey(r.name);
    if (!key) {
      out.set(r.id, "No name: no Context can pick this row and the node skips it");
      continue;
    }
    const other = seen.get(key);
    if (other !== undefined) out.set(r.id, `"${other}" has the same name; Contexts read that one`);
    else seen.set(key, r.name);
  }
  return out;
}

function int(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return Number(v);
  return fallback;
}

/** Decode the widget value. Never throws: malformed rows are dropped. */
export function parseSeedsConfig(raw: unknown): SeedsConfig {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return defaultSeedsConfig();
  const rawRows = (data as { rows?: unknown }).rows;
  const fromLoop = (data as { base_from_loop?: unknown }).base_from_loop === true;
  const rows: SeedsItem[] = [];
  const ids = new Set<string>();
  for (const r of Array.isArray(rawRows) ? rawRows : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    let id = typeof o.id === "string" && o.id ? o.id : newSeedId();
    if (ids.has(id)) id = newSeedId();
    ids.add(id);
    const name = typeof o.name === "string" ? o.name : "";
    if (o.kind === "label") {
      rows.push(o.collapsed === true ? { id, kind: "label", name, collapsed: true } : { id, kind: "label", name });
      continue;
    }
    if (o.kind !== undefined && o.kind !== "seed") continue;
    const locks: Record<string, number> = {};
    if (o.locks && typeof o.locks === "object") {
      for (const [k, v] of Object.entries(o.locks as Record<string, unknown>)) {
        const idx = int(k, -1);
        const seed = int(v, -1);
        if (idx >= 0 && seed >= 0) locks[String(idx)] = maskSeed(seed);
      }
    }
    const row: SeedRow = {
      id,
      kind: "seed",
      name,
      mode: SEED_MODES.includes(o.mode as SeedMode) ? (o.mode as SeedMode) : "follow",
      value: maskSeed(Math.max(0, int(o.value, 0))),
      per_frame: o.per_frame === "same" ? "same" : "new",
      pin: o.pin === true,
      out: int(o.out, 0),
    };
    if (Object.keys(locks).length) row.locks = locks;
    rows.push(row);
  }
  return fromLoop ? { version: 1, rows, base_from_loop: true } : { version: 1, rows };
}

/** Pinned rows in output order. */
export function outputSlots(cfg: SeedsConfig): SeedRow[] {
  const pinned = seedRows(cfg).filter((r) => r.pin).slice(0, MAX_OUTPUTS);
  const outs = pinned.map((r) => r.out).sort((a, b) => a - b);
  if (outs.every((o, i) => o === i + 1)) return [...pinned].sort((a, b) => a.out - b.out);
  return pinned;
}

/** Same config with every pinned `out` in 1..N (N ≤ 16; later pins drop)
 *  and unpinned `out` 0. Keeps valid slots as they are. */
export function normalizeOuts(cfg: SeedsConfig): SeedsConfig {
  let pins = 0;
  const rows = cfg.rows.map((r) => {
    if (r.kind !== "seed") return r;
    if (r.pin && pins < MAX_OUTPUTS) {
      pins++;
      return r;
    }
    return r.pin || r.out ? { ...r, pin: false, out: 0 } : r;
  });
  const capped = { ...cfg, rows };
  const slotOf = new Map(outputSlots(capped).map((r, i) => [r.id, i + 1]));
  return {
    ...capped,
    rows: rows.map((r) =>
      r.kind === "seed" && r.pin && r.out !== slotOf.get(r.id) ? { ...r, out: slotOf.get(r.id) ?? 0 } : r,
    ),
  };
}

export interface OutputPlan {
  config: SeedsConfig;
  /** Slots to remove, highest first. */
  remove: number[];
  /** New slots to add at the end. */
  add: number;
}

/** What to do to the node's outputs to go from `prev` (normalized) to `next`
 *  (kept rows carry their old `out`; a new pin takes the next slot). */
export function planOutputs(prev: SeedsConfig, next: SeedsConfig): OutputPlan {
  const prevOut = new Map(seedRows(prev).filter((r) => r.pin && r.out > 0).map((r) => [r.id, r.out]));
  const stillPinned = new Set(seedRows(next).filter((r) => r.pin && prevOut.has(r.id)).map((r) => r.id));
  const remove = [...prevOut].filter(([id]) => !stillPinned.has(id)).map(([, o]) => o).sort((a, b) => b - a);
  let used = stillPinned.size;
  let add = 0;
  const rows = next.rows.map((r) => {
    if (r.kind !== "seed") return r;
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

/** Same config with every random row given a new value (after a queue). */
export function rerollRandom(cfg: SeedsConfig, roll: () => number = randomSeed): SeedsConfig {
  if (!seedRows(cfg).some((r) => r.mode === "random")) return cfg;
  return {
    ...cfg,
    rows: cfg.rows.map((r) => (r.kind === "seed" && r.mode === "random" ? { ...r, value: roll() } : r)),
  };
}

/** What a Context's "Seed from" holds: `auto` | `loop` | `own` | `row:<name>`. */
export type SeedFrom = string;
export const SEED_FROM_AUTO = "auto";
export const SEED_FROM_LOOP = "loop";
export const SEED_FROM_OWN = "own";
export const SEED_FROM_ROW = "row:";

export function seedFromRow(seedFrom: string | undefined): string | null {
  return seedFrom?.startsWith(SEED_FROM_ROW) ? seedFrom.slice(SEED_FROM_ROW.length) : null;
}

/** The chip text for a Context's seed source. */
export function seedFromLabel(seedFrom: string | undefined): string {
  const row = seedFromRow(seedFrom);
  if (row !== null) return `Seeds › ${row}`;
  if (seedFrom === SEED_FROM_LOOP) return "Loop";
  if (seedFrom === SEED_FROM_OWN) return "Own seed";
  return "Auto";
}
