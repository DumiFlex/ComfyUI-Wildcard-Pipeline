/**
 * The sections of the docs page on screen, for its "On this page" list and
 * section links (`/docs/<page>#<slug>`). Docs.vue provides it; each
 * DocSection adds itself in setup, so the list is in page order.
 */
import type { InjectionKey } from "vue";

export interface DocOutlineEntry { id: string; title: string }

export interface DocOutline {
  /** Adds a section and returns its unique anchor id. */
  add(title: string): string;
  remove(id: string): void;
}

export const DOC_OUTLINE: InjectionKey<DocOutline> = Symbol("wp-doc-outline");

/** "Inputs & outputs" → "inputs-outputs". Search results link with it too. */
export function sectionSlug(title: string): string {
  const s = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "section";
}

/** Keeps a list of entries with unique ids ("rules", "rules-2", …). */
export function createOutline(onChange: (entries: DocOutlineEntry[]) => void): DocOutline & { clear(): void } {
  let entries: DocOutlineEntry[] = [];
  return {
    add(title) {
      const base = `s-${sectionSlug(title)}`;
      let id = base;
      for (let n = 2; entries.some((e) => e.id === id); n++) id = `${base}-${n}`;
      entries = [...entries, { id, title }];
      onChange(entries);
      return id;
    },
    remove(id) {
      entries = entries.filter((e) => e.id !== id);
      onChange(entries);
    },
    clear() {
      entries = [];
      onChange(entries);
    },
  };
}
