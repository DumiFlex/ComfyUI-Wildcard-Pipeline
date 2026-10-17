/**
 * Bare-word (booru tag / LoRA / embedding) popover rows for `RichTextInput`.
 * Pure: grouping, capping, labels and the text a committed row inserts.
 */
import type { ModelKind, ModelSuggestion, TagCategoryName, TagSuggestion } from "../../api/types";

/** 855605 -> "856k". The exact figure is noise; the order of magnitude is the
 *  whole signal, and a full number would dominate a 12px row. */
export function formatTagCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * One row of the bare-word popover, whatever source it came from.
 *
 * Kept as ONE FLAT ARRAY even though the popover renders sections, because
 * `acActive` indexes it. Grouping the state instead would put the keyboard
 * selection in charge of two coordinates and make "skip the header" a case to
 * handle; flat, a header is simply not in the array and cannot be selected.
 */
export type WordRow =
  | { source: "tag"; tag: TagSuggestion }
  | { source: ModelKind; model: ModelSuggestion };

/**
 * Sections, not one ranked list.
 *
 * The sources have no common ranking key: a tag ranks by post count in the tens
 * of thousands, a LoRA has no count at all — you either have the file or you do
 * not. Any flat ordering has to invent a comparison between "12,000 posts" and
 * "a file on disk", and whichever is invented, tags win on weight of numbers
 * and the user's own models sink below the fold. Sections also let each source
 * cap its own rows, so 20 tags cannot crowd out 3 matching LoRAs.
 *
 * Tags lead because that is what a prompt is mostly made of.
 */
/** Tag rows kept when a model also matched.
 *
 *  Sections alone did not deliver what they promised. Tags lead, and a query
 *  like `lazy` matches twenty of them, so the embedding section existed but sat
 *  entirely below the fold — the user could not filter to their own models
 *  without scrolling a list they were not looking for. Capping the leading
 *  section is what actually makes the others reachable.
 *
 *  Only applied when there IS something to protect: a query matching nothing
 *  but tags still gets the full list (the "max suggestions" setting). */
export const TAGS_WHEN_MODELS_MATCH = 6;

/** The flat row list: tags (capped when a model matched), then LoRAs, then
 *  embeddings. */
export function buildWordRows(
  tagRows: TagSuggestion[],
  modelRows: Partial<Record<ModelKind, ModelSuggestion[]>>,
): WordRow[] {
  const loras = modelRows.lora ?? [];
  const embeddings = modelRows.embedding ?? [];
  const modelsPresent = loras.length > 0 || embeddings.length > 0;
  const tags = modelsPresent
    ? tagRows.slice(0, TAGS_WHEN_MODELS_MATCH)
    : tagRows;
  return [
    ...tags.map((tag) => ({ source: "tag" as const, tag })),
    ...loras.map((model) => ({ source: "lora" as const, model })),
    ...embeddings.map((model) => ({ source: "embedding" as const, model })),
  ];
}

export interface WordSection {
  source: WordRow["source"];
  label: string;
  rows: Array<{ row: WordRow; index: number }>;
}

/** Rows grouped for rendering, in the same order as the flat list, with the
 *  flat index carried along so a click knows what it selected. */
export function groupWordSections(rows: WordRow[]): WordSection[] {
  const order: Array<WordRow["source"]> = ["tag", "lora", "embedding"];
  const labels: Record<WordRow["source"], string> = {
    tag: "tags", lora: "loras", embedding: "embeddings",
  };
  const out: WordSection[] = [];
  for (const source of order) {
    const sectionRows = rows
      .map((row, index) => ({ row, index }))
      .filter((e) => e.row.source === source);
    if (sectionRows.length) out.push({ source, label: labels[source], rows: sectionRows });
  }
  return out;
}

/** PrimeIcon per source. `pi-tags` plural is the booru tag — `pi-tag` singular
 *  is already the fixed_values module kind. `pi-asterisk` and `pi-code` were
 *  the only two candidates with no existing use anywhere in `src/`. */
export const SOURCE_ICON: Record<WordRow["source"], string> = {
  tag: "pi pi-tags",
  lora: "pi pi-asterisk",
  embedding: "pi pi-code",
};

/**
 * What follows a committed completion.
 *
 * Opt-in `", "`, so the next tag can be typed straight away. Suppressed inside
 * a `<lora:…>` or `embedding:…` reference: there the caret is mid-syntax and a
 * comma would terminate the very reference being completed — the LoRA still
 * needs its `:weight>`.
 */
export function committedSuffixFor(insideModelRef: boolean, separatorEnabled: boolean): string {
  if (insideModelRef) return "";
  return separatorEnabled ? ", " : "";
}

/** What a committed row puts in the document. A model inserts its FULL PATH,
 *  not its display name: two folders can hold the same filename and ComfyUI
 *  resolves by path, so inserting the short name would silently pick a
 *  different file from the one shown. */
export function wordRowTextFor(row: WordRow, insideModelRef: boolean): string {
  if (row.source === "tag") return row.tag.name;
  // Inside an existing reference the caller already typed the marker, and
  // `acStart` points at the path — so emitting the whole syntax again would
  // produce `<lora:<lora:name:1.0>:1.0>`.
  if (insideModelRef) return row.model.path;
  if (row.source === "lora") return `<lora:${row.model.path}:1.0>`;
  return `embedding:${row.model.path}`;
}

/** Categories present in the CURRENT results, in Danbooru's own order.
 *
 *  The legend appears only when more than one kind is on screen. On an
 *  all-general query every bar is the same neutral grey, and a legend naming
 *  four colours none of which are visible explains nothing — it is decoration
 *  that costs a row of height. */
export function tagLegendFor(tagRows: TagSuggestion[], hasCategories: boolean): TagCategoryName[] {
  if (!hasCategories) return [];
  const order: TagCategoryName[] = [
    "character", "copyright", "artist", "meta", "general",
  ];
  const present = new Set(
    tagRows
      .map((t) => t.category_name)
      .filter((c): c is TagCategoryName => c !== null),
  );
  const shown = order.filter((c) => present.has(c));
  return shown.length > 1 ? shown : [];
}
