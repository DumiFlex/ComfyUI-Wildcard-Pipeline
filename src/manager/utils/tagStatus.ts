import { api } from "../api/client";

/**
 * Tag-list availability, fetched at most once per page.
 *
 * A real module, NOT a `let` inside RichTextInput's `<script setup>`. Anything
 * declared there compiles into `setup()` and is therefore per-instance — a
 * wildcard editor renders one input per option row, so the "shared" promise was
 * 135 identical requests on a 133-option wildcard. Measured, not guessed.
 *
 * Module scope is the only scope an SFC cannot accidentally duplicate.
 */
export interface TagAvailability {
  available: boolean;
  hasCategories: boolean;
}

const UNAVAILABLE: TagAvailability = { available: false, hasCategories: false };

let inflight: Promise<TagAvailability> | null = null;

export function loadTagAvailability(): Promise<TagAvailability> {
  inflight ??= api.tags
    .status()
    .then((s) => ({ available: s.available, hasCategories: s.has_categories }))
    // An optional convenience must never surface an error: not having a tag
    // list is the normal state, not a fault.
    .catch(() => UNAVAILABLE);
  return inflight;
}

/** Drop the cache so the next read re-asks — after a download installs one. */
export function resetTagAvailability(): void {
  inflight = null;
}
