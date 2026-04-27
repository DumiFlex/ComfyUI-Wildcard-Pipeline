/**
 * Community tab — type definitions for the mock registry.
 *
 * UI-only mock — no real backend. Types intentionally mirror what the real
 * /community/api would emit so a future hookup is a straight swap from
 * mockApi.ts → fetch.
 */

/** Public author identity. Real backend would derive this from GitHub OAuth. */
export interface CommunityUser {
  /** GitHub-style login handle (no @). */
  login: string;
  /** Avatar URL or emoji shorthand (mock allows either). */
  avatar_url: string;
  /** Verified author badge. */
  verified: boolean;
  /** Optional display name. */
  name?: string;
}

/** Module kinds the registry recognises. Maps 1:1 to local-library kinds. */
export type CommunityKind =
  | "wildcard"
  | "fixed_values"
  | "combine"
  | "derivation"
  | "constraint"
  | "pipeline";

export interface CommunityVersion {
  version: string;
  published_at: string;
  changelog?: string;
}

export interface CommunityComment {
  id: string;
  user: CommunityUser;
  body: string;
  at: string;
  rating?: number;
}

export interface CommunityPreviewOption {
  value: string;
  weight: number;
}

/** A single registry entry. */
export interface CommunityModule {
  id: string;
  type: CommunityKind;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: CommunityUser;
  versions: CommunityVersion[];
  stars: number;
  downloads: number;
  rating: number;
  rating_count: number;
  /** Histogram of 5..1 star counts (index 0 = 5★). */
  rating_dist: number[];
  nsfw: boolean;
  engine_min_version?: string;
  license: string;
  /** Hero gradient for cards / detail. */
  hero: string;
  /** Tagline shown under the title in cards. */
  tagline: string;
  readme: string;
  /** Last update timestamp (ISO). */
  updated_at: string;
  /** Optional opaque payload — engine wires this to the live module. */
  payload?: unknown;
  /** Preview shape — used by the kind-aware Preview tab. */
  preview_options?: CommunityPreviewOption[];
  /** Comments seeded for the Reviews tab. */
  comments?: CommunityComment[];
}

/** A bundle (a.k.a. pack) — a collection of related modules. */
export interface CommunityBundle {
  id: string;
  type: "bundle";
  name: string;
  description: string;
  tagline: string;
  category: string;
  tags: string[];
  author: CommunityUser;
  versions: CommunityVersion[];
  stars: number;
  downloads: number;
  rating: number;
  rating_count: number;
  rating_dist: number[];
  nsfw: boolean;
  engine_min_version?: string;
  license: string;
  hero: string;
  readme: string;
  updated_at: string;
  modules: CommunityModule[];
  /** Sub-kinds preview list (e.g. ["wildcard", "combine"]). */
  sub_kinds: CommunityKind[];
  /** Sample resolutions (for preview tab). */
  preview_samples?: string[];
  comments?: CommunityComment[];
}

/** Discriminated union for catalog entries. */
export type CommunityAtom = CommunityModule | CommunityBundle;

export type CommunityApiStatus = "online" | "degraded" | "offline";

export type CommunitySortKey =
  | "trending"
  | "recent"
  | "downloads"
  | "stars"
  | "rating";

export interface CommunitySearchQuery {
  q?: string;
  kind?: CommunityKind | "bundle" | "all";
  tag?: string | null;
  sort?: CommunitySortKey;
  verified_only?: boolean;
  include_nsfw?: boolean;
  compatible_only?: boolean;
  engine?: string;
}

export interface CommunityUploadPayload {
  atom: "single" | "bundle";
  type: CommunityKind;
  name: string;
  tagline: string;
  description: string;
  category: string;
  license: string;
  engine_min_version: string;
  nsfw: boolean;
  tags: string[];
  readme: string;
  version: string;
}

export interface CommunityInstallEntry {
  id: string;
  at: string;
}
