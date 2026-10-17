/**
 * Community sign-in left behind by the old script embed.
 *
 * Before the Community tab moved into an iframe, the embed ran in this page
 * and kept its tokens in ComfyUI's localStorage under `wpc.embed.*`, where
 * every script in the page could read them. The framed embed keeps its own
 * tokens on the community origin; these helpers hand the old pair over once
 * (in the bridge's hello) and wipe it when the frame says it has taken it.
 */
import type { FrameTokenPair } from "./frame-protocol";

const ACCESS_KEY = "wpc.embed.access";
const REFRESH_KEY = "wpc.embed.refresh";
const EXPIRES_KEY = "wpc.embed.expires_at";

export function readLegacyTokens(): FrameTokenPair | null {
  try {
    const access = localStorage.getItem(ACCESS_KEY);
    const refresh = localStorage.getItem(REFRESH_KEY);
    const expiresAt = Number(localStorage.getItem(EXPIRES_KEY));
    if (!access || !refresh || !Number.isFinite(expiresAt)) return null;
    return { access, refresh, expiresAt };
  } catch {
    return null;
  }
}

export function wipeLegacyTokens(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // storage blocked: nothing to wipe
  }
}
