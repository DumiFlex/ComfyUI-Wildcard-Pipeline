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
  /** `axes`: an Umi AI `Yaml Tags.txt`, read as tag groups. */
  status: "ok" | "error" | "empty" | "excluded" | "axes";
  wildcards: number;
  error?: string;
  duplicates?: number;
}

export interface WildcardNote {
  kind: string;
  count: number;
  examples: Array<{ wildcard: string; detail: string }>;
}

/** What a wildcard is for in its pack, from the reference graph.
 *  `stack`: modules the import built to run together (a bundle);
 *  `stack part`: a wildcard built for a stack; `copy`: a list filled in
 *  for one set of template arguments. */
export type PlanRole =
  | "entry" | "composition" | "vocabulary" | "group" | "stack" | "copy" | "stack part";

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
  /** Set when several lists were merged into this one tagged wildcard:
   *  the folder they came from (what `keepSeparate` takes) … */
  merge_root?: string;
  /** … each list, by its path under that folder, with its tag … */
  merged_from?: Array<{ name: string; tag: string; options: number }>;
  /** … and the tag groups the folder levels became. */
  tag_groups?: Array<{ name: string; tags: number }>;
  /** What `keepSeparate` takes to undo the merge (`root/<star>/leaf` for a
   *  table, the folder otherwise). */
  separate_key?: string;
  /** `table`: one list name repeated across subfolders; `folder`: the
   *  lists of one folder. */
  structure?: "table" | "folder";
  /** Module type; `bundle` for a stack. */
  type?: string;
  /** For a stack: what built it, the variable it renders and its
   *  modules in run order. */
  stack_kind?: "variables" | "model" | "copies";
  output?: string;
  children?: Array<{ id: string; name: string; type: string; instance?: Record<string, unknown> }>;
  /** A few engine rolls of the entry point or stack. */
  samples?: string[];
  /** Warnings those rolls raised (they make the row lossy). */
  roll_warnings?: Array<{ type: string; message: string }>;
}

export interface WildcardFilesReport {
  files: WildcardFileEntry[];
  notes: WildcardNote[];
  wildcards: number;
  groups: number;
  options: number;
  bundles: number;
  /** Merged wildcards, and how many lists went into them. */
  merged?: number;
  merged_lists?: number;
  /** The tool the pack was converted for (detected unless forced) … */
  dialect?: WildcardDialect;
  /** … what detection alone found … */
  dialect_detected?: WildcardDialect;
  /** … and how many items gave each tool away. */
  dialect_evidence?: Partial<Record<WildcardDialect, number>>;
  /** Stacks built, and the logic modules in them. */
  stacks?: number;
  constraints?: number;
  combines?: number;
  bundle_mode?: BundleMode;
  plan: PlanItem[];
}

/** Which bundles the import makes. */
export type BundleMode = "stacks" | "entries" | "none";

export const BUNDLE_MODE_LABELS: Record<BundleMode, string> = {
  stacks: "Stacks only",
  entries: "Stacks + entry points by folder",
  none: "None",
};

/** A wildcard folder of another extension found on this machine. */
export interface WildcardFolder {
  id: string;
  label: string;
  path: string;
  files: number;
}

/** Source tools the converter knows. `mixed` = plain lists every tool
 *  reads the same way. */
export type WildcardDialect = "dynamicprompts" | "ppp" | "impact" | "umi" | "mixed";

export const DIALECT_LABELS: Record<WildcardDialect, string> = {
  dynamicprompts: "Dynamic Prompts",
  ppp: "Prompt-PostProcessor",
  impact: "Impact Pack / LoRA Manager",
  umi: "Umi AI",
  mixed: "Plain lists (any tool)",
};

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
  /** Fold folders of related lists into one tagged wildcard each. On
   *  unless set to false. */
  merge?: boolean;
  /** Folders (a plan row's `merge_root`) whose lists stay separate. */
  keepSeparate?: string[];
  /** Read the pack as this tool does instead of detecting it. */
  dialect?: WildcardDialect;
  /** Which bundles to make (default `stacks`). */
  bundleMode?: BundleMode;
  /** Tag group renames per merged wildcard: `{name: {old: new}}`. */
  axisNames?: Record<string, Record<string, string>>;
  /** Fold entry points that differ by one tag. On unless false. */
  foldCopies?: boolean;
  /** Read this folder on the machine (a `WildcardFolder.id`) instead of
   *  uploaded files. */
  folder?: string;
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
    merge: opts.merge !== false,
    keep_separate: opts.keepSeparate ?? [],
    dialect: opts.dialect,
    bundle_mode: opts.bundleMode,
    axis_names: opts.axisNames && Object.keys(opts.axisNames).length ? opts.axisNames : undefined,
    fold_copies: opts.foldCopies !== false,
    folder: opts.folder,
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
  default_params_dropped: "Wildcard default settings with no home here (cyclical sampler, container) were dropped",
  affixes_per_pick: "A multi-pick reference now puts the wildcard's prefix/suffix around each value instead of around all of them",
  suffix_pooled: "A bare name found in several folders picks from all of them, as Impact Pack does",
  resolved_from_library: "References to wildcards from an earlier import of this pack link to the library copy",
  ppp_directive_kept_as_text: "PPP commands with no match here stay as plain text",
  tag_query_kept_as_text: "Umi tag queries like <[tag]> stay as plain text (no Umi YAML in the pack)",
  tag_query_no_match: "Umi tag queries that match no entry render nothing",
  condition_dropped: "PPP if-conditions that test something nothing in the pack rolls once were removed (the choice was kept)",
  negative_moved_to_option: "Send-to-negative text inside a {…} choice now applies whenever the option is picked",
  negative_dropped: "Send-to-negative text that holds a reference was dropped from a stack's Combine",
  immediate_variable_as_macro: "A variable rolled once (${x=!…}) outside an entry point rolls again at each read",
  variable_read_in_nested_list: "A list reads a variable rolled once in the line that uses it: it rolls its own value",
  specialised_copy: "Template arguments made filled-in copies of the lists that read them",
  too_many_copies: "Too many filled-in copies: later template references use the plain list",
  template_slot: "A variable nothing in the pack sets: give it a value upstream of the stack",
  line_became_stack: "Lines that roll a variable once became stacks (setters + a Combine)",
  copies_folded: "Entry points that differ by one tag became one wildcard steered by a choice",
  label_dropped: "Some labels couldn't become tags",
  extra_else_dropped: "Only the first else choice became the fallback",
  inline_else_dropped: "else inside {…} choices was ignored",
  unsupported_item: "Items that aren't text were skipped",
  command_dropped: "PPP commands other than include were dropped",
  unresolved_reference: "References to wildcards that weren't found stay as plain text",
  template_args_dropped: "Template arguments for a list that reads no variables were ignored",
  variable_kept_as_text: "Variables nothing sets stay as plain text",
  wrap_kept_as_text: "Wrap commands %{…} stay as plain text",
  multi_pick_range_capped: "Open-ended repeating picks like __r2-$$name__ were capped at the list size",
  filter_dropped: "Some reference filters couldn't be kept",
  merged_fallback_dropped: "A merged wildcard keeps one fallback: the other lists' else choices became normal options",
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
  "ppp_directive_kept_as_text", "tag_query_kept_as_text",
  "tag_query_no_match", "negative_dropped", "variable_read_in_nested_list",
  "too_many_copies",
]);

export function noteNeedsAttention(kind: string): boolean {
  return ATTENTION.has(kind);
}

export const ROLE_LABEL: Record<PlanRole, string> = {
  entry: "Entry point",
  composition: "Composition",
  vocabulary: "Vocabulary",
  group: "Group",
  stack: "Stack",
  copy: "Filled-in copy",
  "stack part": "Stack part",
};

export const ROLE_HINT: Record<PlanRole, string> = {
  entry: "Builds a prompt from other wildcards and nothing else uses it. Drop it on a Context.",
  composition: "Builds on other wildcards and is used by one. Reached through references.",
  vocabulary: "A plain list of values. Stays in the library, reached through references.",
  group: "Made for a glob or folder reference: picks from every matching wildcard.",
  stack: "Modules that run together, in order, as one bundle: what rolls a variable once, the constraints that follow it, and what renders the prompt.",
  copy: "A list with its variables filled in, made for a template reference like __name(var=value)__.",
  "stack part": "A small wildcard the import built for a stack: it rolls a variable or holds a piece of the prompt.",
};

export const FIDELITY_LABEL: Record<PlanFidelity, string> = {
  exact: "Exact",
  close: "Close",
  lossy: "Needs a look",
};

export const PLAN_ROLES: PlanRole[] = [
  "entry", "stack", "composition", "vocabulary", "group", "copy", "stack part",
];
/** Roles explained on the empty drop zone. */
export const MAIN_ROLES: PlanRole[] = ["entry", "stack", "composition", "vocabulary", "group"];
export const PLAN_FIDELITIES: PlanFidelity[] = ["exact", "close", "lossy"];

export interface PlanSummary {
  roles: Record<PlanRole, number>;
  fidelity: Record<PlanFidelity, number>;
  /** Domains in order of size, loose files ("") last. */
  domains: Array<{ name: string; count: number; entries: number; lossy: number }>;
}

export function summarizePlan(plan: PlanItem[]): PlanSummary {
  const roles: Record<PlanRole, number> = {
    entry: 0, composition: 0, vocabulary: 0, group: 0, stack: 0, copy: 0, "stack part": 0,
  };
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
    if (item.role === "entry" || item.role === "stack") d.entries += 1;
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
  const order: Record<PlanRole, number> = {
    stack: 0, entry: 1, composition: 2, group: 3, copy: 4, vocabulary: 5, "stack part": 6,
  };
  return plan
    .filter((p) =>
      (f.domain === null || p.domain === f.domain)
      && (f.roles.size === 0 || f.roles.has(p.role))
      && (f.fidelities.size === 0 || f.fidelities.has(p.fidelity))
      && (!q || p.name.toLowerCase().includes(q)
        || (p.merged_from ?? []).some((m) => m.name.toLowerCase().includes(q))
        || (p.children ?? []).some((c) => c.name.toLowerCase().includes(q))))
    .sort((a, b) =>
      order[a.role] - order[b.role]
      || Number(b.fidelity === "lossy") - Number(a.fidelity === "lossy")
      || a.name.localeCompare(b.name));
}

/** The original (server-generated) name of a tag group currently shown
 *  as `current`, given the renames already asked for. */
export function originalAxisName(renames: Record<string, string> | undefined, current: string): string {
  for (const [orig, now] of Object.entries(renames ?? {})) if (now === current) return orig;
  return current;
}

/** Ask for tag group `current` of wildcard `name` to be called `next`.
 *  Renaming back to the generated name drops the entry. */
export function renameAxis(
  all: Record<string, Record<string, string>>, name: string, current: string, next: string,
): Record<string, Record<string, string>> {
  const mine = { ...(all[name] ?? {}) };
  const orig = originalAxisName(mine, current);
  const want = next.trim();
  if (!want || want === orig) delete mine[orig];
  else mine[orig] = want;
  const out = { ...all };
  if (Object.keys(mine).length) out[name] = mine;
  else delete out[name];
  return out;
}

/** How a kept-separate key reads: `clothes/<star>/top` → "clothes/…/top". */
export function separateKeyLabel(key: string): string {
  return key.includes("/*/") ? key.replace("/*/", "/…/") : `${key}/`;
}
