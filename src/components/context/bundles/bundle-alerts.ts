import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

/** Bundle uid → parent bundle uid (null for a top-level bundle). */
function parentMap(bundles: readonly BundleInstance[] | undefined): Map<string, string | null> {
  const parent = new Map<string, string | null>();
  for (const b of bundles ?? []) {
    if (!b || typeof b._uid !== "string") continue;
    parent.set(b._uid, typeof b.parent_uid === "string" ? b.parent_uid : null);
  }
  return parent;
}

/** Every bundle uid a module sits in, innermost first. Depth-limited so a
 *  corrupt parent cycle can't loop. */
function bundleChain(module: ModuleEntry, parent: Map<string, string | null>): string[] {
  const origin = (module as ModuleEntry & { bundle_origin?: string | null }).bundle_origin;
  return chainFrom(typeof origin === "string" ? origin : null, parent);
}

/** `start` and every bundle above it, innermost first. */
function chainFrom(start: string | null | undefined, parent: Map<string, string | null>): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur && parent.has(cur) && !out.includes(cur) && out.length < 8) {
    out.push(cur);
    cur = parent.get(cur);
  }
  return out;
}

/** True when the module's row is out of sight because it, or one of its
 *  outer bundles, is collapsed. Its chips are hidden then, so they must not
 *  widen the node. */
export function isHiddenInCollapsedBundle(
  module: ModuleEntry,
  bundles: readonly BundleInstance[] | undefined,
): boolean {
  const parent = parentMap(bundles);
  const collapsed = new Set((bundles ?? []).filter((b) => b?.collapsed).map((b) => b._uid));
  if (!collapsed.size) return false;
  return bundleChain(module, parent).some((uid) => collapsed.has(uid));
}

/** The collapsed bundles that hide the module or bundle `uid` (a bundle's
 *  own fold is left alone: its header shows). Empty when nothing hides it. */
export function collapsedAround(
  uid: string,
  modules: readonly ModuleEntry[],
  bundles: readonly BundleInstance[] | undefined,
): string[] {
  const parent = parentMap(bundles);
  const collapsed = new Set((bundles ?? []).filter((b) => b?.collapsed).map((b) => b._uid));
  if (!collapsed.size) return [];
  const mod = modules.find((m) => m?._uid === uid);
  const chain = mod ? bundleChain(mod, parent) : parent.has(uid) ? chainFrom(parent.get(uid), parent) : [];
  return chain.filter((b) => collapsed.has(b));
}

/** The modules a bundle holds, its sub-bundles' modules included. */
export function bundleDescendants(
  bundle: BundleInstance,
  modules: readonly ModuleEntry[],
  bundles: readonly BundleInstance[] | undefined,
): ModuleEntry[] {
  const parent = parentMap(bundles);
  return modules.filter((m) => bundleChain(m, parent).includes(bundle._uid));
}

export type ConflictSeverity = "error" | "warning" | "info";
export type ChildState = "missing" | "clash";

export interface BundleAlertChecks {
  severityFor: (id: string) => string | null | undefined;
  conflictLabel: (id: string) => string | null | undefined;
  isMissingFromLibrary: (m: ModuleEntry) => boolean;
  isTypeConflict: (m: ModuleEntry) => boolean;
}

/** What a collapsed bundle's header shows about the rows it hides: the
 *  worst graph conflict and the worst library state among its modules, with
 *  a tooltip naming each module that has one. Drift and local edits are left
 *  out: the header already says those (the "N drifted" summary and the
 *  bundle's own modified chip). */
export interface BundleAlerts {
  conflict: ConflictSeverity | null;
  state: ChildState | null;
  title: string;
}

const RANK: Record<ConflictSeverity, number> = { error: 3, warning: 2, info: 1 };

export function bundleAlerts(
  children: readonly ModuleEntry[],
  checks: BundleAlertChecks,
): BundleAlerts {
  let conflict: ConflictSeverity | null = null;
  let state: ChildState | null = null;
  const lines: string[] = [];
  for (const m of children) {
    const name = m.meta?.name || "(unnamed)";
    const sev = checks.severityFor(m._uid ?? m.id);
    if (sev === "error" || sev === "warning" || sev === "info") {
      if (!conflict || RANK[sev] > RANK[conflict]) conflict = sev;
      lines.push(`${name}: ${checks.conflictLabel(m._uid ?? m.id) ?? sev}`);
    }
    if (checks.isTypeConflict(m)) {
      state = "clash";
      lines.push(`${name}: id clash`);
    } else if (checks.isMissingFromLibrary(m) && !m.example) {
      if (state !== "clash") state = "missing";
      lines.push(`${name}: not in library`);
    }
  }
  const title = lines.length
    ? `Inside this bundle:\n${lines.join("\n")}\nExpand it to see the rows.`
    : "";
  return { conflict, state, title };
}
