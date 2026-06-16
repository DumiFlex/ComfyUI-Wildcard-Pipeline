/**
 * Minimal localStorage-backed TokenStore for the embedded community.
 *
 * The Community web exposes its REST under bearer-token auth — the
 * embed reads tokens through this contract:
 *
 *   interface TokenStore {
 *     getAccessToken(): Promise<string | null>;
 *     getRefreshToken(): Promise<string | null>;
 *     setTokens(pair: { access, refresh, expiresAt }): Promise<void>;
 *     clear(): Promise<void>;
 *   }
 *
 * Today this is read-mostly: tokens land via the OAuth2 device flow
 * (host runs it; sets via `setTokens`). When the embed encounters a
 * 401 it fires `onUnauthenticated` — the host then re-runs device
 * flow and re-mounts. The store also handles proactive refresh: if
 * `now() > expiresAt - REFRESH_SKEW_MS`, `getAccessToken()` hits
 * `/api/v1/auth/refresh` once and overwrites itself before returning
 * the new access token.
 *
 * The device flow is not yet wired into the extension shell — until
 * it is, this store reports null and the embed renders anonymously
 * (public posts only). That's the right fallback for the v1 ship:
 * users get browse + detail + downloads with no auth ceremony.
 */

const ACCESS_KEY = "wpc.embed.access";
const REFRESH_KEY = "wpc.embed.refresh";
const EXPIRES_KEY = "wpc.embed.expires_at";

const REFRESH_SKEW_MS = 60_000;

interface PersistedTokens {
  access: string;
  refresh: string;
  expiresAt: number;
}

export interface WpcTokenStore {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(pair: PersistedTokens): Promise<void>;
  clear(): Promise<void>;
}

function readPair(): PersistedTokens | null {
  if (typeof localStorage === "undefined") return null;
  const access = localStorage.getItem(ACCESS_KEY);
  const refresh = localStorage.getItem(REFRESH_KEY);
  const expiresRaw = localStorage.getItem(EXPIRES_KEY);
  if (!access || !refresh || !expiresRaw) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return null;
  return { access, refresh, expiresAt };
}

function writePair(pair: PersistedTokens): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ACCESS_KEY, pair.access);
  localStorage.setItem(REFRESH_KEY, pair.refresh);
  localStorage.setItem(EXPIRES_KEY, String(pair.expiresAt));
}

function wipe(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}

/**
 * Build a TokenStore tied to a given API base. The base is needed for
 * the refresh-token round-trip; callers should pass the same
 * `WPC_API_URL` they hand to `mount({apiBaseUrl})`.
 */
export function createWpcTokenStore(apiBaseUrl: string): WpcTokenStore {
  const base = apiBaseUrl.replace(/\/$/, "");
  let refreshInFlight: Promise<PersistedTokens | null> | null = null;

  async function refreshNow(): Promise<PersistedTokens | null> {
    const current = readPair();
    if (!current) return null;
    try {
      // Backend route is /auth/token/refresh per
      // api/app/routers/auth.py:425 — was hitting /auth/refresh which
      // 404'd silently and forced a re-login every access-token TTL.
      // Body field MUST be `refresh_token` — backend's RefreshRequest
      // uses Pydantic `extra="forbid"`, so a stray `refresh` key gets
      // rejected with 422 (not 401), the wipe path never fires, and
      // the embed silently loses auth on the next access-token expiry.
      const res = await fetch(`${base}/api/v1/auth/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) wipe();
        return null;
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      const pair: PersistedTokens = {
        access: data.access_token,
        refresh: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };
      writePair(pair);
      return pair;
    } catch {
      // Network blip — leave tokens as-is so we can try again next
      // call. Don't wipe.
      return null;
    }
  }

  return {
    async getAccessToken(): Promise<string | null> {
      const current = readPair();
      if (!current) return null;
      if (Date.now() < current.expiresAt - REFRESH_SKEW_MS) {
        return current.access;
      }
      // Coalesce concurrent refresh calls — multiple embed mounts on
      // the same page would otherwise burn the same refresh token in
      // parallel and one would win, invalidating the others.
      if (!refreshInFlight) {
        refreshInFlight = refreshNow().finally(() => {
          refreshInFlight = null;
        });
      }
      const refreshed = await refreshInFlight;
      return refreshed?.access ?? null;
    },

    async getRefreshToken(): Promise<string | null> {
      return readPair()?.refresh ?? null;
    },

    async setTokens(pair: PersistedTokens): Promise<void> {
      writePair(pair);
    },

    async clear(): Promise<void> {
      wipe();
    },
  };
}
