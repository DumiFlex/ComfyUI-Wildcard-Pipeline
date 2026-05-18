/**
 * Shared types for the command palette.
 *
 * Extracted to a dedicated .ts file so both `CommandPalette.vue` and
 * `utils/commandRank.ts` (and any future consumer) can import without
 * the IDE's plain-TS `*.vue` module shim warning about missing named
 * exports. Also breaks the circular import that would otherwise exist
 * between the component and the ranker.
 */
export interface CommandItem {
  id: string;
  label: string;
  kind: "module" | "bundle" | "category" | "route" | "action";
  icon: string;
  subtitle?: string;
  run: () => void;
}
