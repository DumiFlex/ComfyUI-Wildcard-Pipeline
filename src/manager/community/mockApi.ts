/**
 * Mock community API.
 *
 * UI-only — there is no real backend. Each function returns a Promise with
 * a small artificial latency so the UI gets to render real loading /
 * skeleton states. State (auth, install history, stars) is persisted to
 * localStorage so it survives reload.
 */
import {
  SEED_ATOMS,
  SEED_AUTHORS,
  SEED_FEATURED_IDS,
  SEED_TAGS,
} from "./seed";
import type {
  CommunityApiStatus,
  CommunityAtom,
  CommunityInstallEntry,
  CommunityKind,
  CommunityModule,
  CommunitySearchQuery,
  CommunityUploadPayload,
  CommunityUser,
} from "./types";

const STORAGE_KEYS = {
  user: "wp-community-user",
  installed: "wp-community-installed",
  history: "wp-community-history",
  starred: "wp-community-starred",
  uploads: "wp-community-uploads",
  forceOffline: "wp-community-force-offline",
};

const DEFAULT_LATENCY = 250;

/** In-memory copy of the mock catalog — uploads from the wizard append here. */
const catalog: CommunityAtom[] = SEED_ATOMS.slice();

function delay(ms = DEFAULT_LATENCY) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no-op — quota / private mode */
  }
}

function readSet(key: string): string[] {
  return readJson<string[]>(key, []);
}

/* ----------------------------- offline flag ----------------------------- */

export function isForceOffline(): boolean {
  return readJson<boolean>(STORAGE_KEYS.forceOffline, false);
}

export function setForceOffline(value: boolean): void {
  writeJson(STORAGE_KEYS.forceOffline, value);
}

/* ----------------------------- API status ------------------------------- */

export async function getApiStatus(): Promise<CommunityApiStatus> {
  await delay(120);
  return isForceOffline() ? "offline" : "online";
}

/* --------------------------------- auth -------------------------------- */

export function getCurrentUser(): CommunityUser | null {
  return readJson<CommunityUser | null>(STORAGE_KEYS.user, null);
}

export async function signInWithGitHub(): Promise<CommunityUser> {
  await delay(400);
  if (isForceOffline()) throw new Error("offline");
  // Mocked GitHub OAuth response — real flow would round-trip a popup window.
  const user: CommunityUser = {
    login: "you",
    name: "You",
    avatar_url: "https://avatars.githubusercontent.com/u/0?v=4",
    verified: false,
  };
  writeJson(STORAGE_KEYS.user, user);
  return user;
}

export async function signOut(): Promise<void> {
  await delay(120);
  try {
    localStorage.removeItem(STORAGE_KEYS.user);
  } catch {
    /* no-op */
  }
}

/* --------------------------- catalog queries --------------------------- */

function compareVersion(have: string, need: string): number {
  const a = have.split(".").map((n) => parseInt(n, 10) || 0);
  const b = need.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function engineSatisfies(have: string, need: string): boolean {
  return compareVersion(have, need) >= 0;
}

export async function searchModules(query: CommunitySearchQuery = {}): Promise<CommunityAtom[]> {
  await delay(180);
  if (isForceOffline()) throw new Error("offline");

  const q = (query.q || "").trim().toLowerCase();
  const verified = !!query.verified_only;
  const includeNsfw = !!query.include_nsfw;
  const compatibleOnly = !!query.compatible_only;
  const engine = query.engine || "1.4";
  const sort = query.sort || "trending";

  let items = catalog.slice();

  if (query.kind && query.kind !== "all") {
    if (query.kind === "bundle") items = items.filter((it) => it.type === "bundle");
    else items = items.filter((it) => it.type === query.kind);
  }
  if (query.tag) {
    items = items.filter((it) => it.tags.includes(query.tag as string));
  }
  if (q) {
    items = items.filter((it) => {
      const hay = `${it.name} ${it.tagline} ${it.tags.join(" ")} ${it.author.login}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (verified) items = items.filter((it) => it.author.verified);
  if (!includeNsfw) items = items.filter((it) => !it.nsfw);
  if (compatibleOnly) {
    items = items.filter((it) => engineSatisfies(engine, it.engine_min_version || "0"));
  }

  items.sort((a, b) => {
    const at = Date.parse(a.updated_at) || 0;
    const bt = Date.parse(b.updated_at) || 0;
    if (sort === "stars")     return b.stars - a.stars;
    if (sort === "downloads") return b.downloads - a.downloads;
    if (sort === "recent")    return bt - at;
    if (sort === "rating")    return b.rating - a.rating;
    // trending = blend of recent updates × stars
    const aScore = a.stars * 0.6 + (1e10 / Math.max(1, Date.now() - at)) * 0.4;
    const bScore = b.stars * 0.6 + (1e10 / Math.max(1, Date.now() - bt)) * 0.4;
    return bScore - aScore;
  });

  return items;
}

export async function getModule(id: string): Promise<CommunityAtom> {
  await delay(220);
  if (isForceOffline()) throw new Error("offline");
  const found = catalog.find((it) => it.id === id);
  if (!found) {
    const err = new Error("not_found") as Error & { code?: number };
    err.code = 404;
    throw err;
  }
  return found;
}

export async function getFeatured(): Promise<CommunityAtom[]> {
  await delay(150);
  if (isForceOffline()) throw new Error("offline");
  return SEED_FEATURED_IDS
    .map((id) => catalog.find((it) => it.id === id))
    .filter((it): it is CommunityAtom => Boolean(it));
}

export function getAllTags(): string[] {
  return SEED_TAGS.slice();
}

export function getAllAuthors(): CommunityUser[] {
  return SEED_AUTHORS.slice();
}

/* --------------------------- install + stars --------------------------- */

export function getInstalled(): string[] {
  return readSet(STORAGE_KEYS.installed);
}

export function getInstallHistory(): CommunityInstallEntry[] {
  return readJson<CommunityInstallEntry[]>(STORAGE_KEYS.history, []);
}

export async function installModule(id: string): Promise<void> {
  await delay(450);
  if (isForceOffline()) throw new Error("offline");
  const installed = new Set(getInstalled());
  installed.add(id);
  writeJson(STORAGE_KEYS.installed, Array.from(installed));
  const history = getInstallHistory().filter((h) => h.id !== id);
  history.unshift({ id, at: new Date().toISOString() });
  writeJson(STORAGE_KEYS.history, history.slice(0, 50));
}

export async function uninstallModule(id: string): Promise<void> {
  await delay(250);
  if (isForceOffline()) throw new Error("offline");
  const installed = getInstalled().filter((x) => x !== id);
  writeJson(STORAGE_KEYS.installed, installed);
}

export function getStarred(): string[] {
  return readSet(STORAGE_KEYS.starred);
}

export async function starModule(id: string, on: boolean): Promise<void> {
  await delay(180);
  if (isForceOffline()) throw new Error("offline");
  const set = new Set(getStarred());
  if (on) set.add(id);
  else set.delete(id);
  writeJson(STORAGE_KEYS.starred, Array.from(set));
}

/* ------------------------------- uploads ------------------------------- */

export function getMyUploads(): string[] {
  return readSet(STORAGE_KEYS.uploads);
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}`;
}

export async function uploadModule(payload: CommunityUploadPayload): Promise<CommunityModule> {
  await delay(800);
  if (isForceOffline()) throw new Error("offline");
  const user = getCurrentUser() ?? {
    login: "you",
    avatar_url: "https://avatars.githubusercontent.com/u/0?v=4",
    verified: false,
  };
  const id = makeId(payload.atom === "bundle" ? "pkg" : kindPrefix(payload.type));
  const now = new Date().toISOString();
  const module: CommunityModule = {
    id,
    type: payload.type,
    name: payload.name,
    description: payload.description,
    category: payload.category,
    tags: payload.tags,
    author: user,
    versions: [{ version: payload.version, published_at: now, changelog: "Initial release." }],
    stars: 0,
    downloads: 0,
    rating: 0,
    rating_count: 0,
    rating_dist: [0, 0, 0, 0, 0],
    nsfw: payload.nsfw,
    engine_min_version: payload.engine_min_version,
    license: payload.license,
    hero: "linear-gradient(135deg, var(--wp-accent-600) 0%, var(--wp-accent-800) 100%)",
    tagline: payload.tagline,
    readme: payload.readme,
    updated_at: now,
    preview_options: [],
    comments: [],
  };
  catalog.unshift(module);
  const uploads = new Set(getMyUploads());
  uploads.add(id);
  writeJson(STORAGE_KEYS.uploads, Array.from(uploads));
  return module;
}

function kindPrefix(kind: CommunityKind): string {
  switch (kind) {
    case "wildcard": return "wc";
    case "fixed_values": return "fv";
    case "combine": return "cmb";
    case "derivation": return "drv";
    case "constraint": return "cn";
    case "pipeline": return "pl";
    default: return "mod";
  }
}

/* ------------------------ catalog inspection helpers ------------------- */

/** Unsafe: bypasses the network. Used by the profile screen to resolve ids
 * back to atoms without the artificial latency. */
export function findInCatalog(id: string): CommunityAtom | undefined {
  return catalog.find((it) => it.id === id);
}

/** For tests: reset all client-side state. */
export function _resetForTests(): void {
  Object.values(STORAGE_KEYS).forEach((key) => {
    try { localStorage.removeItem(key); } catch { /* no-op */ }
  });
}

/** For tests / SSR: read-only access to the seeded catalog. */
export function _catalogSnapshot(): CommunityAtom[] {
  return catalog.slice();
}

/** Convenience guard: bundle vs module. */
export function isBundle(atom: CommunityAtom): atom is Extract<CommunityAtom, { type: "bundle" }> {
  return atom.type === "bundle";
}

/** Convenience guard: module (not bundle). */
export function isModule(atom: CommunityAtom): atom is CommunityModule {
  return atom.type !== "bundle";
}

export { engineSatisfies };
