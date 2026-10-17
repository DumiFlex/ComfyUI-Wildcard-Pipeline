/**
 * Message protocol between this extension (host) and the community embed
 * page it frames (`${WPC_API_URL}/embed-frame.html`).
 *
 * Mirror of the community repo's `web/src/frame/protocol.ts`. Additive
 * changes only; bump `FRAME_PROTOCOL` on a remove or rename, in both repos.
 *
 * Every message is `{ wpc: FRAME_PROTOCOL, type, ... }`. Requests carry an
 * `id`; the other side answers `{ type: "reply", id, ok, result | error }`.
 *
 * - Frame → host requests: `install` `{ envelope, opts, collisions }`
 *   (opts = origin + dependencies), `markPublished` `{ id, kind, slug, version }`.
 * - Host → frame requests: `resolveCollisions` `{ call, rows }` (`call` = the
 *   install request's id); the reply is the decision map, or null to cancel.
 * - Frame → host events: `ready`, `navigate` (target), `close`, `tokens-adopted`.
 * - Host → frame: `hello` once after each `ready`; events `navigate` (target),
 *   `theme`, `publish` (the publish form's hash string).
 */
export const FRAME_PROTOCOL = 1;

export type FrameTheme = "dark" | "light" | "auto";

export interface FrameTokenPair {
  access: string;
  refresh: string;
  expiresAt: number;
}

export interface FrameHello {
  wpc: typeof FRAME_PROTOCOL;
  type: "hello";
  abi: number;
  schemaVersion: number;
  theme?: FrameTheme;
  analytics?: boolean;
  legacyTokens?: FrameTokenPair;
}

export interface FrameRequest {
  wpc: typeof FRAME_PROTOCOL;
  type: "request";
  id: string;
  method: string;
  params?: unknown;
}

export interface FrameReply {
  wpc: typeof FRAME_PROTOCOL;
  type: "reply";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface FrameEvent {
  wpc: typeof FRAME_PROTOCOL;
  type: "event";
  name: string;
  data?: unknown;
}

export type FrameMessage = FrameHello | FrameRequest | FrameReply | FrameEvent;

export function isFrameMessage(data: unknown): data is FrameMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as { wpc?: unknown; type?: unknown };
  return d.wpc === FRAME_PROTOCOL && typeof d.type === "string";
}
