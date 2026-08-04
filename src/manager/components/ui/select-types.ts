/**
 * `Select.vue`'s option shape, in a plain module.
 *
 * It was declared inside `<script setup>`, which works for `.vue` importers
 * (vue-tsc resolves SFC exports) but not for plain `.ts` ones — those see the
 * `*.vue` ambient shim, whose only export is the default component. Building
 * option lists in a `.ts` helper needs the type, so it lives here and
 * `Select.vue` re-exports it; every existing
 * `import type { SelectOption } from "./Select.vue"` keeps working.
 */
export interface SelectOption {
  value: string | number | null;
  label: string;
  /** Optional color dot shown before the label (e.g. category color). Used
   *  on its own when the option has no `icon`. */
  dot?: string;
  /** Optional PrimeIcons slug (no `pi-` prefix) shown before the label. When
   *  set it REPLACES the dot rather than sitting next to it, tinted with
   *  `dot` so the colour survives — a category is far easier to recognise by
   *  its glyph than by an 8px circle, especially once a library holds more
   *  categories than there are distinguishable hues. */
  icon?: string;
  /** Optional native tooltip surfaced via `title` on the option row.
   *  Used by derivation op dropdown to explain semantics — e.g.
   *  "matches" shows "Python regex via re.search". */
  title?: string;
  /** Optional dim right-aligned detail that DISAMBIGUATES rows sharing a
   *  label — e.g. a wildcard's option count + short uuid, when a library
   *  holds five entries all named "Outfit". Also matched by the type-to-
   *  filter query, so typing a uuid finds its row. */
  meta?: string;
}
