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

/** What a wildcard is for in its pack, from the reference graph. */
export type PlanRole = "entry" | "composition" | "vocabulary" | "group";

/** How faithfully it came across, from the notes it raised. */
export type PlanFidelity = "exact" | "close" | "lossy";

/** One imported row in the conversion plan. */
export interface PlanItem {
  id: string;
  name: string;
  /** Top folder or YAML key; empty for loose files. */
  domain: string;
  role: PlanRole;
  options: number;
  /** References it makes (members, for a group). */
  refs: number;
  /** Wildcards in the pack that reference it. */
  referenced_by: number;
  fidelity: PlanFidelity;
  notes: Array<{ kind: string; detail: string }>;
  source: string;
}

export interface WildcardFilesReport {
  files: WildcardFileEntry[];
  notes: WildcardNote[];
  wildcards: number;
  groups: number;
  options: number;
  bundles: number;
  plan: PlanItem[];
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
  /** File the entry points into a pack bundle with one bundle per top
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
  duplicate_value: "Repeated values became one option with a higher weight",
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
  variable_kept_as_text: "Variables like ${name} stay as plain text: wildcards can't read variables, so rebuild that part with a Combine",
  wrap_kept_as_text: "Wrap commands %{…} stay as plain text",
  multi_pick_range_capped: "Open-ended repeating picks like __r2-$$name__ were capped at the list size",
  filter_dropped: "Some reference filters couldn't be kept",
};

export function describeNote(kind: string): string {
  return NOTE_TEXT[kind] ?? kind.replace(/_/g, " ");
}

/** Notes that mean an option may not render as it did in the source tool,
 *  so the user should look. The rest are housekeeping. */
const ATTENTION = new Set([
  "condition_dropped", "unresolved_reference", "template_args_dropped",
  "variable_kept_as_text",
  "wrap_kept_as_text", "filter_dropped",
  "default_params_dropped", "command_dropped",
]);

export function noteNeedsAttention(kind: string): boolean {
  return ATTENTION.has(kind);
}

export const ROLE_LABEL: Record<PlanRole, string> = {
  entry: "Entry point",
  composition: "Composition",
  vocabulary: "Vocabulary",
  group: "Group",
};

export const ROLE_HINT: Record<PlanRole, string> = {
  entry: "Builds a prompt from other wildcards and nothing else uses it. These go into bundles.",
  composition: "Builds on other wildcards and is used by one. Reached through references.",
  vocabulary: "A plain list of values. Stays in the library, reached through references.",
  group: "Made for a glob or folder reference: picks from every matching wildcard.",
};

export const FIDELITY_LABEL: Record<PlanFidelity, string> = {
  exact: "Exact",
  close: "Close",
  lossy: "Needs a look",
};

export const PLAN_ROLES: PlanRole[] = ["entry", "composition", "vocabulary", "group"];
export const PLAN_FIDELITIES: PlanFidelity[] = ["exact", "close", "lossy"];

export interface PlanSummary {
  roles: Record<PlanRole, number>;
  fidelity: Record<PlanFidelity, number>;
  /** Domains in order of size, loose files ("") last. */
  domains: Array<{ name: string; count: number; entries: number; lossy: number }>;
}

export function summarizePlan(plan: PlanItem[]): PlanSummary {
  const roles: Record<PlanRole, number> = { entry: 0, composition: 0, vocabulary: 0, group: 0 };
  const fidelity: Record<PlanFidelity, number> = { exact: 0, close: 0, lossy: 0 };
  const byDomain = new Map<string, { name: string; count: number; entries: number; lossy: number }>();
  for (const item of plan) {
    roles[item.role] += 1;
    fidelity[item.fidelity] += 1;
    let d = byDomain.get(item.domain);
    if (!d) {
      d = { name: item.domain, count: 0, entries: 0, lossy: 0 };
      byDomain.set(item.domain, d);
    }
    d.count += 1;
    if (item.role === "entry") d.entries += 1;
    if (item.fidelity === "lossy") d.lossy += 1;
  }
  const domains = [...byDomain.values()].sort((a, b) =>
    Number(a.name === "") - Number(b.name === "") || b.count - a.count || a.name.localeCompare(b.name));
  return { roles, fidelity, domains };
}

export interface PlanFilter {
  /** `null` for every domain. */
  domain: string | null;
  roles: Set<PlanRole>;
  fidelities: Set<PlanFidelity>;
  query: string;
}

/** Plan rows matching the filter. Entry points first, then the rows
 *  that need a look, then by name, so the parts a user acts on lead. */
export function filterPlan(plan: PlanItem[], f: PlanFilter): PlanItem[] {
  const q = f.query.trim().toLowerCase();
  const order: Record<PlanRole, number> = { entry: 0, composition: 1, group: 2, vocabulary: 3 };
  return plan
    .filter((p) =>
      (f.domain === null || p.domain === f.domain)
      && (f.roles.size === 0 || f.roles.has(p.role))
      && (f.fidelities.size === 0 || f.fidelities.has(p.fidelity))
      && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) =>
      order[a.role] - order[b.role]
      || Number(b.fidelity === "lossy") - Number(a.fidelity === "lossy")
      || a.name.localeCompare(b.name));
}
