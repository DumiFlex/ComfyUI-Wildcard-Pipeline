/**
 * What a chat card draws, by kind. Each builder in this folder turns a
 * proposal's op into one of these; `components/ai/AiCardView.vue` draws
 * them the way the item's editor would. A card with no view keeps the
 * server's preview lines.
 */
import type { Change, TagDiff } from "../../utils/card-diff";

export interface ConstraintRowView { from: string; to: string; byTag: boolean; effect: string; factor: number | null }
export interface BranchView { key: "IF" | "ELIF" | "ELSE"; test: string; actions: string[] }

/** A category the way `CategoryChip` draws it. `isNew`: the card makes it. */
export interface CatChipView { name: string; color: string | null; icon: string | null; isNew?: boolean }

/** One field of an item, old → new. */
export type InfoRowView =
  | { field: "text"; label: string; from: string; to: string }
  | { field: "tags"; label: string; tags: TagDiff[] }
  | { field: "category"; label: string; from: CatChipView | null; to: CatChipView | null }
  | { field: "rating"; label: string; from: string; to: string };

/** One wildcard option, old → new. The `was*` fields are null when that
 *  part didn't change (or the option is new). */
export interface OptionDiffRow {
  id: string;
  change: Change;
  text: string;
  wasText: string | null;
  empty: boolean;
  /** Share of the draw, 0–100, after the change (before, for a removed one). */
  share: number;
  wasShare: number | null;
  weight: number;
  wasWeight: number | null;
  tags: TagDiff[];
  negative: string;
  wasNegative: string | null;
  fallback: boolean;
  wasFallback: boolean | null;
}

export type CardView =
  | { kind: "constraint"; source: string; target: string; reach: string; rows: ConstraintRowView[] }
  | { kind: "derivation"; rules: BranchView[][] }
  | { kind: "values"; rows: Array<{ name: string; value: string; negative: string }> }
  | { kind: "text"; rows: Array<{ label: string; text: string }> }
  | { kind: "info"; rows: InfoRowView[] }
  | {
      kind: "options";
      rows: OptionDiffRow[];
      /** Options left as they were (folded in the chat). */
      same: number;
      before: number;
      after: number;
      /** Other wildcard settings that change (the variable, tag groups). */
      fields: InfoRowView[];
    }
  | {
      kind: "categories";
      create: CatChipView[];
      rename: Array<{ from: CatChipView; to: CatChipView }>;
      restyle: Array<{ from: CatChipView; to: CatChipView }>;
    }
  | { kind: "tags"; rows: Array<{ from: string; to: string; merge: boolean; count: number }> }
  | { kind: "bulk"; rows: Array<{ name: string; itemKind: string; changes: InfoRowView[] }> };

/** What the builders may look up: the library's categories, for colours
 *  and icons the op itself doesn't carry. */
export interface CardViewContext {
  category?: (id: string) => CatChipView | null;
}
