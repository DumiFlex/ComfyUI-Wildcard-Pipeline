/**
 * WP Image Filter — config + picker request shapes.
 *
 * Mirrors `engine/image_filter.py` (`DEFAULT_CONFIG`, `parse_config`) and the
 * request the node sends over the websocket (`wp_nodes/image_filter_node.py`).
 */

export type FilterMode = "pause" | "reuse" | "pass_all";
export type NothingPicked = "stop" | "keep_all";
export type SendAs = "same_shape" | "per_image";
export type OnTimeout = "keep_all" | "stop" | "keep_first";

export interface ImageFilterConfig {
  mode: FilterMode;
  nothing_picked: NothingPicked;
  send_as: SendAs;
  /** Seconds; 0 waits until answered. */
  timeout: number;
  on_timeout: OnTimeout;
}

export const MAX_TIMEOUT = 86_400;

export function defaultImageFilterConfig(): ImageFilterConfig {
  return { mode: "pause", nothing_picked: "stop", send_as: "same_shape", timeout: 600, on_timeout: "keep_all" };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Same per-key recovery as the Python side: bad values fall back alone. */
export function parseImageFilterConfig(raw: unknown): ImageFilterConfig {
  const out = defaultImageFilterConfig();
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  const o = obj as Record<string, unknown>;
  out.mode = oneOf(o.mode, ["pause", "reuse", "pass_all"] as const, out.mode);
  out.nothing_picked = oneOf(o.nothing_picked, ["stop", "keep_all"] as const, out.nothing_picked);
  out.send_as = oneOf(o.send_as, ["same_shape", "per_image"] as const, out.send_as);
  out.on_timeout = oneOf(o.on_timeout, ["keep_all", "stop", "keep_first"] as const, out.on_timeout);
  if (typeof o.timeout === "number" && Number.isFinite(o.timeout)) {
    out.timeout = clampTimeout(o.timeout);
  }
  return out;
}

export function clampTimeout(n: number): number {
  return Math.max(0, Math.min(MAX_TIMEOUT, Math.trunc(n)));
}

/** One image as ComfyUI's `/view` addresses it. */
export interface ImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export interface FrameLabel {
  loop_index?: number;
  pins?: Record<string, string>;
}

/** What the node sends when it starts waiting. */
export interface PickRequest {
  token: string;
  node_id: string;
  /** `frames[f][i]` is image `i` of frame `f`. */
  frames: ImageRef[][];
  labels: FrameLabel[];
  /** Seconds; 0 = no limit. */
  timeout: number;
  /** Server clock (epoch seconds) when the wait began. */
  started_at: number;
}

export type Pick = [frame: number, image: number];

export type PickAnswer =
  | { action: "picks"; picks: Pick[] }
  | { action: "keep_all" }
  | { action: "stop" };

export function viewUrl(ref: ImageRef): string {
  const q = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
  return `/view?${q.toString()}`;
}

export function pickKey(frame: number, image: number): string {
  return `${frame}:${image}`;
}

/** Narrow an untyped websocket payload to a usable request (or null). */
export function parsePickRequest(raw: unknown): PickRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.token !== "string" || !Array.isArray(r.frames)) return null;
  const frames: ImageRef[][] = r.frames.map((frame) =>
    Array.isArray(frame)
      ? frame.filter((x): x is ImageRef => !!x && typeof (x as ImageRef).filename === "string")
      : [],
  );
  const labels = Array.isArray(r.labels) ? (r.labels as FrameLabel[]) : [];
  return {
    token: r.token,
    node_id: String(r.node_id ?? ""),
    frames,
    labels,
    timeout: typeof r.timeout === "number" ? r.timeout : 0,
    started_at: typeof r.started_at === "number" ? r.started_at : Date.now() / 1000,
  };
}

/** The node's `wp_image_filter` UI payload: what the last run kept. */
export interface ImageFilterRun {
  picks: Pick[];
  frames: number;
  total: number;
  /** How the picks were made: "pause", "reuse" or "pass_all". */
  mode: string;
  /** The branch was stopped (nothing went on). */
  stopped: boolean;
}
