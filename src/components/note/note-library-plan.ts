/**
 * What a WP Note's `wp:library` button adds to the library, and how the
 * workflow is rebound afterwards. Pure: the library verdicts and fresh ids
 * come in as functions, so this runs in tests without the drift store.
 *
 * Every bundle and module on the WP Contexts in scope is sorted into:
 *   new        not in the library: added under its own id
 *   different  in the library with other content: Use mine (default),
 *              Replace or Keep both
 *   taken      its id holds a different kind of item: Keep both (default)
 *              or Leave out; never Replace
 *   same       already there; nothing to do
 * Rows with no library tie (made on the canvas, no `payload_hash`) stay out.
 */
import type { BundleInstance, ContextWidgetValue, ModuleEntry } from "../../widgets/_shared";
import { buildLibraryChildren } from "../context/bundles/save";
import { computeBundleFingerprint } from "../context/bundles/bundle-fingerprint";
import { walkRemap } from "../context/bundles/uuid-remap";

export interface ContextSource {
  /** The node's key: its id, or `<subgraph id>:<id>` inside a subgraph. */
  key: string;
  value: ContextWidgetValue;
}

export type ModuleVerdict = "missing" | "different" | "taken" | "same" | "local";
export type BundleVerdict = "missing" | "different" | "same";

export interface Verdicts {
  module(m: ModuleEntry): ModuleVerdict;
  bundle(b: BundleInstance): BundleVerdict;
}

export type ItemState = "new" | "different" | "taken";
export type Choice = "add" | "skip" | "replace" | "copy";

export interface PlanItem {
  kind: "module" | "bundle";
  /** The library id it goes in under (a bundle with none gets a fresh one). */
  id: string;
  /** Module kind, or "bundle". */
  type: string;
  name: string;
  example: boolean;
  state: ItemState;
  /** The engine row that goes into the import envelope. */
  entity: Record<string, unknown>;
}

export interface LibraryPlan {
  items: PlanItem[];
  /** Bundles and modules already in the library as they are. */
  already: number;
  /** Bundles with no library id, given one here: rebound after install. */
  minted: Array<{ context: string; uid: string; id: string }>;
}

/** The choices a row offers, the default first. */
export function choicesFor(state: ItemState): Choice[] {
  if (state === "new") return ["add"];
  if (state === "taken") return ["copy", "skip"];
  return ["skip", "replace", "copy"];
}

const KIND_ORDER = ["bundle", "wildcard", "fixed_values", "combine", "derivation", "constraint"];

function moduleName(m: ModuleEntry): string {
  return (m.meta?.library_name || m.meta?.name || m.type).trim() || m.type;
}

/**
 * Sort the Contexts' rows into a plan. Deduped by library id: the same
 * bundle or module on two Contexts is added once (the first one seen).
 */
export function buildPlan(sources: ContextSource[], verdicts: Verdicts, mint: () => string): LibraryPlan {
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  const minted: LibraryPlan["minted"] = [];
  let already = 0;

  for (const src of sources) {
    const modules = src.value.modules ?? [];
    // Unlinked bundles get an id first, so an outer bundle's children
    // point at the id its inner one goes in under.
    const bundles = (src.value.bundles ?? []).map((b) => {
      if (b.library_id) return b;
      const id = mint();
      minted.push({ context: src.key, uid: b._uid, id });
      return { ...b, library_id: id };
    });

    for (const b of bundles) {
      const key = `bundle:${b.library_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const verdict = b.library_id && minted.some((x) => x.id === b.library_id) ? "missing" : verdicts.bundle(b);
      if (verdict === "same") { already++; continue; }
      const entity: Record<string, unknown> = {
        id: b.library_id,
        name: b.name?.trim() || "Bundle",
        color: b.color ?? null,
        children: buildLibraryChildren(b, modules, bundles),
      };
      items.push({
        kind: "bundle", id: b.library_id, type: "bundle", name: String(entity.name),
        example: b.example === true, state: verdict === "missing" ? "new" : "different", entity,
      });
    }

    for (const m of modules) {
      const verdict = verdicts.module(m);
      if (verdict === "local") continue;
      const key = `module:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (verdict === "same") { already++; continue; }
      const entity: Record<string, unknown> = {
        id: m.id,
        type: m.type,
        name: moduleName(m),
        payload: m.payload ?? {},
      };
      if (m.meta?.description) entity.description = m.meta.description;
      if (m.meta?.tags?.length) entity.tags = [...m.meta.tags];
      items.push({
        kind: "module", id: m.id, type: m.type, name: moduleName(m), example: m.example === true,
        state: verdict === "missing" ? "new" : verdict, entity,
      });
    }
  }

  // Examples first, then by kind (bundles before modules), keeping the
  // canvas order inside each group.
  const rank = (i: PlanItem): number => (i.example ? 0 : 100) + Math.max(0, KIND_ORDER.indexOf(i.type));
  items.sort((a, b) => rank(a) - rank(b));
  return { items, already, minted };
}

/** "4 bundles and 12 modules", "1 module", "nothing". */
export function countLabel(items: Array<{ kind: "module" | "bundle" }>): string {
  const b = items.filter((i) => i.kind === "bundle").length;
  const m = items.length - b;
  const parts = [
    b ? `${b} bundle${b === 1 ? "" : "s"}` : "",
    m ? `${m} module${m === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : "nothing";
}

/** What the note's button says when hovered. */
export function buttonHint(plan: LibraryPlan, scope: "workflow" | "context"): string {
  const from = scope === "workflow" ? "this workflow" : "this WP Context";
  const fresh = plan.items.filter((i) => i.state === "new");
  const differ = plan.items.length - fresh.length;
  if (plan.items.length === 0) {
    return plan.already > 0 ? "Already in your library" : `Nothing in ${from} to add`;
  }
  const head = fresh.length ? `Add ${countLabel(fresh)} from ${from} to your library` : `Nothing new in ${from}`;
  return differ ? `${head}; ${differ} already there with other content` : head;
}

export interface InstallBuild {
  /** The engine-export envelope for `installEnvelope`. */
  envelope: Record<string, unknown[] | number>;
  /** Ids to install with Replace. */
  replace: string[];
  /** Old id → the fresh id a Keep both copy goes in under. */
  rename: Record<string, string>;
  /** What goes in, by library id (after renames): the module payloads the
   *  workflow rows must match to take the library's hash. */
  installedModules: Map<string, unknown>;
  installedBundles: Set<string>;
  count: number;
  /** The items going in, for the success message. */
  going: PlanItem[];
}

const VALID_ID = /^[0-9a-f]{8}$/;

const BUCKET: Record<string, string> = {
  wildcard: "wildcards",
  fixed_values: "fixed_values",
  combine: "combines",
  derivation: "derivations",
  constraint: "constraints",
};

/**
 * Apply the dialog's choices and build the envelope. Keep both copies get
 * a fresh id and "(copy)" on their name; every reference to them (bundle
 * children, constraint sources, `@{uuid}`) follows.
 */
export function buildInstall(
  plan: LibraryPlan,
  choices: Record<string, Choice>,
  mint: () => string,
  schemaVersion: number,
): InstallBuild {
  const keyOf = (i: PlanItem): string => `${i.kind}:${i.id}`;
  const going = plan.items.filter((i) => (choices[keyOf(i)] ?? choicesFor(i.state)[0]) !== "skip");
  const rename: Record<string, string> = {};
  const replace: string[] = [];
  const copies = new Set<string>();
  for (const i of going) {
    const c = choices[keyOf(i)] ?? choicesFor(i.state)[0];
    if (c === "copy") { rename[i.id] = mint(); copies.add(i.id); }
    else if (c === "replace" && i.state === "different") replace.push(i.id);
    // The import gives an id that isn't 8 hex digits a new one; do it here
    // so the workflow follows it.
    else if (!VALID_ID.test(i.id)) rename[i.id] = mint();
  }
  const envelope: Record<string, unknown[] | number> = {
    schema_version: schemaVersion,
    bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [],
    categories: [], templates: [],
  };
  const installedModules = new Map<string, unknown>();
  const installedBundles = new Set<string>();
  for (const i of going) {
    const entity = walkRemap(i.entity, rename) as Record<string, unknown>;
    // walkRemap rewrote the id already when it was renamed.
    if (copies.has(i.id)) entity.name = `${i.name} (copy)`;
    const id = rename[i.id] ?? i.id;
    if (i.kind === "bundle") {
      (envelope.bundles as unknown[]).push(entity);
      installedBundles.add(id);
    } else {
      const bucket = BUCKET[i.type];
      if (!bucket) continue;
      (envelope[bucket] as unknown[]).push(entity);
      installedModules.set(id, entity.payload);
    }
  }
  return { envelope, replace, rename, installedModules, installedBundles, count: going.length, going };
}

export interface RebindInput {
  rename: Record<string, string>;
  minted: LibraryPlan["minted"];
  installedModules: Map<string, unknown>;
  installedBundles: Set<string>;
  moduleHash(id: string): string | undefined;
  bundleHash(id: string): string | undefined;
}

/**
 * Point one Context's rows at what was just installed: Keep both copies
 * take their new ids, fresh bundles their minted ids, and every installed
 * row takes the library's hash and loses its EXAMPLE flag. A row whose
 * content differs from what went in keeps its own hash (it still reads as
 * changed). Null when nothing changes.
 */
export function rebindContext(key: string, value: ContextWidgetValue, input: RebindInput): ContextWidgetValue | null {
  const before = JSON.stringify(value);
  const hasRename = Object.keys(input.rename).length > 0;
  let modules = (hasRename ? walkRemap(value.modules, input.rename) : value.modules) as ModuleEntry[];
  modules = modules.map((m) => {
    if (!input.installedModules.has(m.id)) return m;
    if (JSON.stringify(m.payload ?? {}) !== JSON.stringify(input.installedModules.get(m.id) ?? {})) return m;
    const hash = input.moduleHash(m.id);
    const next: ModuleEntry = { ...m, ...(hash ? { payload_hash: hash } : {}) };
    delete next.example;
    return next;
  });
  const bundles = (value.bundles ?? []).map((b) => {
    const mint = input.minted.find((x) => x.context === key && x.uid === b._uid);
    const id = mint ? mint.id : input.rename[b.library_id] ?? b.library_id;
    const moved: BundleInstance = id === b.library_id ? b : { ...b, library_id: id };
    if (!input.installedBundles.has(id)) return moved;
    const hash = input.bundleHash(id);
    const next: BundleInstance = {
      ...moved,
      ...(hash ? { inserted_at_hash: hash } : {}),
      snapshot_fingerprint: computeBundleFingerprint(moved, modules),
    };
    delete next.example;
    return next;
  });
  const next: ContextWidgetValue = { ...value, modules, ...(value.bundles ? { bundles } : {}) };
  return JSON.stringify(next) === before ? null : next;
}
