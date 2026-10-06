/**
 * Wildcard file import (Dynamic Prompts / Prompt-PostProcessor / Impact
 * Pack): the browser side. Collects dropped or picked files and folders,
 * posts them to `/wp/api/import/wildcard-files`, and describes the report
 * that comes back. The server does the parsing (see
 * `engine/wildcard_files.py`); the payload it returns is an ordinary
 * import envelope that goes through the normal picker and commit.
 */
import type { RawPayload } from "./migrations";

/** Extensions the converter reads. `.zip` is unpacked server-side. */
export const WILDCARD_FILE_EXTENSIONS = [".txt", ".yaml", ".yml", ".json", ".zip"] as const;

export const WILDCARD_FILE_ACCEPT = WILDCARD_FILE_EXTENSIONS.join(",");

/** One upload: the file plus its path relative to what the user dropped. */
export interface WildcardSource {
  path: string;
  file: File;
}

export interface WildcardFileEntry {
  path: string;
  status: "ok" | "error" | "empty" | "excluded";
  wildcards: number;
  error?: string;
  duplicates?: number;
}

export interface WildcardNote {
  kind: string;
  count: number;
  examples: Array<{ wildcard: string; detail: string }>;
}

export interface WildcardFilesReport {
  files: WildcardFileEntry[];
  notes: WildcardNote[];
  wildcards: number;
  groups: number;
  options: number;
  bundles: number;
}

export interface WildcardFilesResult {
  payload: RawPayload;
  report: WildcardFilesReport;
}

export interface WildcardImportOptions {
  /** Library tag added to every imported wildcard. */
  packTag?: string;
  /** One category for everything, instead of one per top folder. */
  category?: string;
  /** Report paths of files to leave out. */
  exclude?: string[];
  /** File the wildcards into a pack bundle with one bundle per top
   *  folder. On unless set to false. */
  bundles?: boolean;
  /** Name of the pack bundle. */
  packName?: string;
}

export function isWildcardFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return WILDCARD_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True when `text` is a Wildcard Pipeline export rather than a
 *  Dynamic Prompts JSON wildcard file. Exports are objects carrying
 *  `schema_version` plus at least one known bucket. */
export function looksLikeWpExport(text: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  if (!("schema_version" in obj)) return false;
  return ["wildcards", "bundles", "fixed_values", "combines", "derivations", "constraints", "templates"]
    .some((k) => Array.isArray(obj[k]));
}

/** Files from an `<input type="file">`, keeping folder paths when the
 *  input was a folder picker (`webkitRelativePath`). */
export function sourcesFromFileList(list: FileList | File[]): WildcardSource[] {
  const out: WildcardSource[] = [];
  for (const file of Array.from(list)) {
    const path = file.webkitRelativePath || file.name;
    if (isWildcardFileName(path)) out.push({ path, file });
  }
  return out;
}

/** Minimal shapes of the File and Directory System entry API, which TS's
 *  DOM lib types loosely. */
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface FsFileEntry extends FsEntry {
  file(ok: (f: File) => void, fail: (e: unknown) => void): void;
}
interface FsDirEntry extends FsEntry {
  createReader(): { readEntries(ok: (e: FsEntry[]) => void, fail: (e: unknown) => void): void };
}

async function walkEntry(entry: FsEntry, prefix: string, out: WildcardSource[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    if (!isWildcardFileName(entry.name)) return;
    const file = await new Promise<File>((ok, fail) => (entry as FsFileEntry).file(ok, fail));
    out.push({ path, file });
    return;
  }
  if (!entry.isDirectory) return;
  if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
  const reader = (entry as FsDirEntry).createReader();
  // readEntries returns at most ~100 entries per call; read until empty.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) break;
    for (const child of batch) await walkEntry(child, path, out);
  }
}

/** Everything dropped on the drop zone, folders walked recursively. */
export async function sourcesFromDrop(dt: DataTransfer): Promise<WildcardSource[]> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const getEntry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FsEntry | null;
    }).webkitGetAsEntry;
    const entry = getEntry ? getEntry.call(item) : null;
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return sourcesFromFileList(dt.files);
  const out: WildcardSource[] = [];
  for (const entry of entries) await walkEntry(entry, "", out);
  return out;
}

export function buildWildcardForm(
  sources: WildcardSource[],
  opts: WildcardImportOptions = {},
): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify({
    paths: sources.map((s) => s.path),
    pack_tag: opts.packTag?.trim() || undefined,
    category: opts.category?.trim() || undefined,
    exclude: opts.exclude ?? [],
    bundles: opts.bundles !== false,
    pack_name: opts.packName?.trim() || undefined,
  }));
  for (const s of sources) form.append("file", s.file, s.file.name);
  return form;
}

/** The dropped folder or zip name, or nothing for loose files. Names
 *  the pack bundle. */
export function suggestPackName(sources: WildcardSource[]): string {
  if (sources.length === 0) return "";
  const first = sources[0].path;
  let top = "";
  if (first.includes("/")) top = first.split("/")[0];
  else if (first.toLowerCase().endsWith(".zip")) top = first;
  if (!top) return "";
  if (sources.some((s) => !s.path.startsWith(top))) return "";
  return top.replace(/\.zip$/i, "").trim();
}

/** The pack name as a library tag: lowercase, dashes for spaces. */
export function suggestPackTag(sources: WildcardSource[]): string {
  return suggestPackName(sources).toLowerCase().replace(/\s+/g, "-");
}

/** Plain-language label for each report note kind. */
const NOTE_TEXT: Record<string, string> = {
  inline_comment: "Text after # was treated as a comment and removed",
  duplicate_value: "Repeated values were dropped",
  duplicate_wildcard: "Wildcards defined twice kept their first file",
  empty_wildcard: "Empty wildcards were skipped",
  default_params_dropped: "Wildcard default settings (count, separator, prefix/suffix) were dropped",
  condition_dropped: "PPP if-conditions were removed (the choice was kept)",
  label_dropped: "Some labels couldn't become tags",
  extra_else_dropped: "Only the first else choice became the fallback",
  inline_else_dropped: "else inside {…} choices was ignored",
  unsupported_item: "Items that aren't text were skipped",
  command_dropped: "PPP commands other than include were dropped",
  unresolved_reference: "References to wildcards that weren't found stay as plain text",
  template_args_dropped: "Template arguments like __name(var=value)__ were dropped",
  variable_read_mapped: "${name} became the variable $name; set it with a Context",
  variable_default_dropped: "Variable defaults like ${name:value} were dropped",
  variable_kept_as_text: "Variable assignments like ${name=value} stay as plain text",
  wrap_kept_as_text: "Wrap commands %{…} stay as plain text",
  multi_pick_reference_approximated: "Multi-pick references like __2$$name__ became {2$$, $$…} (repeats possible)",
  filter_dropped: "Some reference filters couldn't be kept",
};

export function describeNote(kind: string): string {
  return NOTE_TEXT[kind] ?? kind.replace(/_/g, " ");
}

/** Notes that mean an option may not render as it did in the source tool,
 *  so the user should look. The rest are housekeeping. */
const ATTENTION = new Set([
  "condition_dropped", "unresolved_reference", "template_args_dropped",
  "variable_read_mapped", "variable_default_dropped", "variable_kept_as_text",
  "wrap_kept_as_text", "multi_pick_reference_approximated", "filter_dropped",
  "default_params_dropped", "command_dropped",
]);

export function noteNeedsAttention(kind: string): boolean {
  return ATTENTION.has(kind);
}
