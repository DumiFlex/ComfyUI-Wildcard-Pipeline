/**
 * Host side of the Community tab's iframe bridge. The community embed runs
 * in its own origin (`/embed-frame.html` on the community host) and reaches
 * this library only through the requests served here.
 *
 * Trust: only messages from the iframe's own window AND the community origin
 * count. Everything the frame sends is input: install envelopes still go
 * through `installEnvelope` (parse, migrate, server-side validation), and
 * every field is checked before use.
 */
import type {
  CollisionDecision,
  InstallCollision,
  InstallOrigin,
} from "../import-export/install";
import {
  FRAME_PROTOCOL,
  isFrameMessage,
  type FrameMessage,
  type FrameTheme,
  type FrameTokenPair,
} from "./frame-protocol";
import type { HostInstallOpts, HostRuntime } from "./hostRuntime";

export type FrameView =
  | "browse" | "detail" | "profile" | "auth" | "bundles" | "library" | "publish" | "deleted";

export interface FrameTarget {
  view: FrameView;
  slug?: string;
  username?: string;
}

export interface FrameBridgeOptions {
  iframe: HTMLIFrameElement;
  /** The community origin, e.g. `https://wp.dumiflex.dev`. */
  origin: string;
  runtime: HostRuntime;
  theme: () => FrameTheme;
  analytics: () => boolean;
  /** Sign-in the old script embed kept in this page's storage. Sent once in
   *  hello; `onTokensAdopted` fires when the frame has taken it. */
  legacyTokens?: () => FrameTokenPair | null;
  onTokensAdopted?: () => void;
  onReady?: () => void;
  onNavigate?: (target: FrameTarget) => void;
  onClose?: () => void;
  /** Window to listen on (tests). */
  win?: Window;
}

export interface FrameBridge {
  navigate(target: FrameTarget): void;
  setTheme(theme: FrameTheme): void;
  /** Hand the publish form its payload (the `#…` string single-row-publish builds). */
  publish(hash: string): void;
  dispose(): void;
}

const VIEWS = new Set<string>([
  "browse", "detail", "profile", "auth", "bundles", "library", "publish", "deleted",
]);
const ID_RE = /^[0-9a-f]{8}$/;

export function cleanTarget(data: unknown): FrameTarget | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.view !== "string" || !VIEWS.has(d.view)) return null;
  const out: FrameTarget = { view: d.view as FrameView };
  if (typeof d.slug === "string" && /^[^/\s?#]{1,100}\/[^/\s?#]{1,100}$/.test(d.slug)) out.slug = d.slug;
  if (typeof d.username === "string" && /^[^/\s?#]{1,100}$/.test(d.username)) out.username = d.username;
  return out;
}

function cleanInstallOpts(raw: unknown): Omit<HostInstallOpts, "resolveCollisions"> {
  const out: Omit<HostInstallOpts, "resolveCollisions"> = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  const origin = o.origin as Record<string, unknown> | undefined;
  if (
    origin && typeof origin === "object"
    && typeof origin.post_slug === "string" && origin.post_slug.length <= 200
    && Number.isInteger(origin.version_number)
  ) {
    const clean: InstallOrigin = {
      post_slug: origin.post_slug,
      version_number: origin.version_number as number,
    };
    if (origin.content_rating === "safe" || origin.content_rating === "nsfw") {
      clean.content_rating = origin.content_rating;
    }
    out.origin = clean;
  }
  if (Array.isArray(o.dependencies)) {
    out.dependencies = o.dependencies.flatMap((d: unknown) => {
      if (!d || typeof d !== "object") return [];
      const e = d as Record<string, unknown>;
      if (typeof e.slug !== "string") return [];
      return [{
        slug: e.slug,
        ...(typeof e.module_id === "string" && ID_RE.test(e.module_id) ? { module_id: e.module_id } : {}),
      }];
    });
  }
  return out;
}

/** The frame's collision answer, keeping only ids that were asked about and
 *  decisions the modal can make (skip / replace / rename). */
export function cleanDecisions(
  raw: unknown,
  rows: InstallCollision[],
): Record<string, CollisionDecision> | null {
  if (!raw || typeof raw !== "object") return null;
  const asked = new Set(rows.map((r) => r.id));
  const out: Record<string, CollisionDecision> = {};
  for (const [id, d] of Object.entries(raw as Record<string, unknown>)) {
    if (!asked.has(id) || !d || typeof d !== "object") continue;
    const dec = d as Record<string, unknown>;
    if (dec.kind === "skip" || dec.kind === "replace") out[id] = { kind: dec.kind };
    else if (dec.kind === "rename" && typeof dec.new_name === "string" && dec.new_name.trim()) {
      out[id] = { kind: "rename", new_name: dec.new_name.slice(0, 200) };
    }
  }
  return out;
}

export function connectFrame(opts: FrameBridgeOptions): FrameBridge {
  const win = opts.win ?? window;
  let greeted = false;
  let disposed = false;
  let seq = 0;
  const queue: FrameMessage[] = [];
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void }>();

  function frameWindow(): Window | null {
    return opts.iframe.contentWindow;
  }

  function post(msg: Record<string, unknown>): void {
    const full = { ...msg, wpc: FRAME_PROTOCOL } as FrameMessage;
    const w = frameWindow();
    if (disposed) return;
    if (!greeted || !w) {
      if (full.type === "event") queue.push(full);
      return;
    }
    w.postMessage(full, opts.origin);
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = `h${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ type: "request", id, method, params });
    });
  }

  async function serve(id: string, run: () => Promise<unknown>): Promise<void> {
    try {
      post({ type: "reply", id, ok: true, result: await run() });
    } catch (err) {
      post({ type: "reply", id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  function hello(): void {
    const w = frameWindow();
    if (!w) return;
    const tokens = opts.legacyTokens?.() ?? null;
    w.postMessage({
      wpc: FRAME_PROTOCOL,
      type: "hello",
      abi: opts.runtime.abi,
      schemaVersion: opts.runtime.schemaVersion,
      theme: opts.theme(),
      analytics: opts.analytics(),
      ...(tokens ? { legacyTokens: tokens } : {}),
    }, opts.origin);
    greeted = true;
    for (const m of queue.splice(0)) w.postMessage(m, opts.origin);
  }

  function onRequest(id: string, method: string, params: unknown): void {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    if (method === "install") {
      void serve(id, () => opts.runtime.install(p.envelope, {
        ...cleanInstallOpts(p.opts),
        ...(p.collisions === true
          ? {
              resolveCollisions: async (rows: InstallCollision[]) =>
                cleanDecisions(await request("resolveCollisions", { call: id, rows }), rows),
            }
          : {}),
      }));
    } else if (method === "markPublished") {
      void serve(id, async () => {
        const kind = p.kind === "bundle" ? "bundle" : p.kind === "module" ? "module" : null;
        if (typeof p.id !== "string" || !ID_RE.test(p.id) || !kind) return false;
        if (typeof p.slug !== "string" || !Number.isInteger(p.version)) return false;
        return opts.runtime.markPublished(p.id, kind, p.slug, p.version as number);
      });
    } else {
      void serve(id, async () => {
        throw new Error(`Unknown method ${method}`);
      });
    }
  }

  function onMessage(event: MessageEvent): void {
    const w = frameWindow();
    if (!w || event.source !== w || event.origin !== opts.origin) return;
    const msg: unknown = event.data;
    if (!isFrameMessage(msg)) return;
    switch (msg.type) {
      case "event":
        if (msg.name === "ready") {
          // Also after a reload inside the frame: greet the new page.
          greeted = false;
          hello();
          opts.onReady?.();
        } else if (msg.name === "navigate") {
          const t = cleanTarget(msg.data);
          if (t) opts.onNavigate?.(t);
        } else if (msg.name === "close") {
          opts.onClose?.();
        } else if (msg.name === "tokens-adopted") {
          opts.onTokensAdopted?.();
        }
        return;
      case "request":
        if (greeted) onRequest(msg.id, msg.method, msg.params);
        return;
      case "reply": {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || "The community page refused the request."));
        return;
      }
      default:
        return;
    }
  }

  win.addEventListener("message", onMessage);

  return {
    navigate: (target) => post({ type: "event", name: "navigate", data: target }),
    setTheme: (theme) => post({ type: "event", name: "theme", data: theme }),
    publish: (hash) => post({ type: "event", name: "publish", data: hash }),
    dispose() {
      disposed = true;
      win.removeEventListener("message", onMessage);
      for (const p of pending.values()) p.reject(new Error("Community tab closed."));
      pending.clear();
      queue.length = 0;
    },
  };
}
