/**
 * Curated PrimeIcons glyphs offered by `IconPicker.vue`.
 *
 * PrimeIcons ships ~314 glyphs; this is a subset. The full set would need its
 * own search UI, and most of it (chevrons, spinners, media transport, brand
 * logos) means nothing as a library label. The groups below follow the kinds
 * of things people actually categorise prompt modules by.
 *
 * Names are PrimeIcons ids MINUS the `pi-` prefix (`"user"`, not `"pi-user"`)
 * — that is what the engine's `icon` column holds and what `Icon.vue` expects.
 *
 * In a plain module rather than inside the SFC so `icon-catalog.test.ts` can
 * check every name against the installed `primeicons.css` without mounting a
 * component. That test is the point: a name with no matching glyph renders as
 * an EMPTY CELL, which looks like a layout bug rather than a typo, and `brush`
 * shipped that way because nothing verified the list.
 */
export interface IconGroup {
  label: string;
  icons: string[];
}

export const ICON_GROUPS: IconGroup[] = [
  {
    label: "Subject",
    icons: ["user", "users", "heart", "star", "eye", "face-smile", "crown", "id-card"],
  },
  {
    // `sliders-h` stands in for the art-supply glyph PrimeIcons doesn't have —
    // there is no brush/paint icon in the set, and `palette` already carries
    // "art style". Sliders read as "tune the look".
    label: "Style & look",
    icons: ["palette", "pencil", "sliders-h", "camera", "image", "sparkles", "sun", "moon"],
  },
  {
    label: "Scene",
    icons: ["home", "building", "map", "map-marker", "globe", "compass", "car", "cloud"],
  },
  {
    label: "Structure",
    icons: ["box", "folder", "book", "tag", "tags", "list", "sitemap", "objects-column"],
  },
  {
    label: "Signals",
    icons: ["bolt", "flag", "bell", "shield", "lock", "wrench", "filter", "info-circle"],
  },
];

/** Every offered glyph, flattened — for tests and any future search box. */
export function allCuratedIcons(): string[] {
  return ICON_GROUPS.flatMap((g) => g.icons);
}
