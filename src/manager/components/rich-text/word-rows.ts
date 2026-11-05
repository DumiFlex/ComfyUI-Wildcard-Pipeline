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

/** How a picked tag is written (Settings › Autocomplete). */
export interface TagInsertStyle {
  /** `blue_hair` → `blue hair`. */
  spaces: boolean;
  /** `(` → `\(`, `)` → `\)`, so the brackets are not read as a weight. */
  escape: boolean;
}

const NO_TAG_STYLE: TagInsertStyle = { spaces: false, escape: false };

/**
 * A tag name as a pick writes it.
 *
 * Tags of three characters or fewer keep their underscores: those are the
 * emoticon tags (`^_^`, `o_o`, `>_<`) where the underscore IS the face.
 * Brackets already escaped are left alone, so `\(` never becomes `\\(`.
 */
export function tagInsertText(name: string, style: TagInsertStyle): string {
  let out = name;
  if (style.spaces && out.length > 3) out = out.replace(/_/g, " ");
  if (style.escape) out = out.replace(/(?<!\\)([()])/g, "\\$1");
  return out;
}

/** The full syntax a model row writes when nothing of it is typed yet. A
 *  model inserts its FULL PATH, not its display name: two folders can hold the
 *  same filename and ComfyUI resolves by path, so inserting the short name
 *  would silently pick a different file from the one shown. The path is kept
 *  exactly as ComfyUI lists it (sub-folder separator and extension included):
 *  ComfyUI's embedding loader and the LoRA-tag loaders all accept it, and it is
 *  the only spelling that cannot be ambiguous. */
export function modelRefText(kind: ModelKind, path: string): string {
  return kind === "lora" ? `<lora:${path}:${DEFAULT_LORA_WEIGHT}>` : `embedding:${path}`;
}

/** The weight a fresh `<lora:…>` gets. */
export const DEFAULT_LORA_WEIGHT = "1.0";

/** What a committed tag or model row writes, outside any reference. */
export function wordRowTextFor(row: WordRow, style: TagInsertStyle = NO_TAG_STYLE): string {
  if (row.source === "tag") return tagInsertText(row.tag.name, style);
  return modelRefText(row.source, row.model.path);
}

/** A committed row as a raw-text replacement: `[start, end)` becomes `insert`
 *  and the caret lands at the end of `insert`. */
export interface WordCommit {
  start: number;
  end: number;
  insert: string;
}

const EMBED_MARKER = "embedding:";

/** True when what follows `at` is already a comma (spaces allowed before it),
 *  so a separator would only double it. */
function commaFollows(text: string, at: number): boolean {
  return /^[ \t]*,/.test(text.slice(at));
}

/**
 * What committing `row` does to the text, given the probe that opened the
 * popover (`start` = where the typed word or reference name begins, `refKind`
 * = the reference the caret is inside, if any).
 *
 * Every model commit leaves a COMPLETE reference behind: `<lora:PATH:1.0>` with
 * both brackets, or `embedding:PATH`. The cases:
 *
 * - **Bare word** (`sty|`): the whole syntax replaces the word. A `<` typed
 *   just before the word is the user starting the bracket themselves, so it is
 *   absorbed rather than doubled (`<sty|` → `<lora:…:1.0>`, not `<<lora:…`),
 *   along with a `>` an editor auto-closed after the caret.
 * - **Inside `<lora:`**: the rest of a name already there is replaced too, and
 *   what closes it is kept: an existing `:0.8>` stays as typed, a bare `>`
 *   gains the default weight, and an unclosed reference gets `:1.0>`.
 * - **Inside `embedding:`**: the name (up to a space, comma, colon, bracket)
 *   is replaced. `<embedding:…>` is not ComfyUI syntax (its loader only looks
 *   for words starting `embedding:`), so a `<` before the marker and a `>`
 *   after the name are dropped.
 *
 * The separator (Settings › Autocomplete) follows a reference just completed,
 * unless a comma already does.
 */
export function wordRowCommitFor(
  text: string,
  caret: number,
  start: number,
  row: WordRow,
  refKind: ModelKind | null,
  opts: { separator: boolean; style?: TagInsertStyle | undefined },
): WordCommit {
  const sep = (end: number): string => (opts.separator && !commaFollows(text, end) ? ", " : "");
  const from = start >= 0 ? Math.min(start, caret) : caret;

  if (row.source === "tag") {
    return { start: from, end: caret, insert: tagInsertText(row.tag.name, opts.style ?? NO_TAG_STYLE) + (opts.separator ? ", " : "") };
  }
  const path = row.model.path;

  if (refKind === "lora") {
    // The rest of the name after the caret, up to whatever ends it.
    let nameEnd = caret;
    while (nameEnd < text.length && !/[:<>,\n]/.test(text[nameEnd])) nameEnd += 1;
    const stop = text[nameEnd];
    if (stop === ":") {
      const close = text.indexOf(">", nameEnd);
      const between = close >= 0 ? text.slice(nameEnd, close) : "";
      if (close >= 0 && !/[,\n<]/.test(between)) {
        // `<lora:old:0.8>` — keep the weight and the bracket as typed.
        return { start: from, end: close + 1, insert: path + text.slice(nameEnd, close + 1) };
      }
    }
    if (stop === ">") {
      return { start: from, end: nameEnd + 1, insert: `${path}:${DEFAULT_LORA_WEIGHT}>` + sep(nameEnd + 1) };
    }
    // Unclosed: only what was typed up to the caret is the name being searched.
    return { start: from, end: caret, insert: `${path}:${DEFAULT_LORA_WEIGHT}>` + sep(caret) };
  }

  if (refKind === "embedding") {
    let nameEnd = caret;
    while (nameEnd < text.length && !/[\s,:<>()]/.test(text[nameEnd])) nameEnd += 1;
    let markerAt = from - EMBED_MARKER.length;
    if (markerAt < 0 || text.slice(markerAt, from).toLowerCase() !== EMBED_MARKER) markerAt = from;
    let end = nameEnd;
    let begin = markerAt;
    if (begin > 0 && text[begin - 1] === "<") {
      begin -= 1;
      if (text[end] === ">") end += 1;
    }
    return { start: begin, end, insert: modelRefText("embedding", path) + sep(end) };
  }

  // Bare word: absorb a `<` the user typed to open the reference themselves,
  // and the `>` an editor may have paired with it.
  let begin = from;
  let end = caret;
  if (begin > 0 && text[begin - 1] === "<") {
    begin -= 1;
    if (text[end] === ">") end += 1;
  }
  return { start: begin, end, insert: modelRefText(row.source, path) + sep(end) };
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
