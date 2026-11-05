import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

// Top-level render list: standalone modules + bundle wrappers, in
// document order. Each bundle entry packs its child rows so the
// template can iterate once + nest children inside a real .wp-bundle
// div (no more absolute-positioned overlay).
//
// Tier-2 nesting: a bundle's `children[]` may include a NESTED bundle
// wrapper (an inner BundleInstance whose parent_uid points at the
// outer). The renderer recurses one level — the API cap forbids
// deeper chains so a single `BundleChild` recursion is enough.
export type BundleChild =
  | { kind: "mod"; key: string; module: ModuleEntry; idx: number }
  | { kind: "bundle"; key: string; bundle: BundleInstance; children: BundleChild[] };

export interface TopLevelItem {
  kind: "mod" | "bundle";
  key: string;
  module?: ModuleEntry;
  idx?: number;
  bundle?: BundleInstance;
  children?: BundleChild[];
}

export function buildTopLevelItems(
  modules: ModuleEntry[],
  bundles: BundleInstance[],
): TopLevelItem[] {
  // Group inner bundles by parent_uid for O(1) lookup during the walk.
  const innersByParent = new Map<string, BundleInstance[]>();
  for (const b of bundles) {
    const parent = typeof b.parent_uid === "string" ? b.parent_uid : null;
    if (!parent) continue;
    const list = innersByParent.get(parent) ?? [];
    list.push(b);
    innersByParent.set(parent, list);
  }

  // Build the child list for a bundle range [start, end]. Walks the
  // module positions; when a position matches an inner bundle's
  // start_idx, emits a nested bundle wrapper covering that inner's
  // span. Other positions emit leaf module sub-items.
  function bundleChildren(parentUid: string, start: number, end: number): BundleChild[] {
    const inners = (innersByParent.get(parentUid) ?? []).slice().sort(
      (a, b) => a.start_idx - b.start_idx,
    );
    const out: BundleChild[] = [];
    let j = start;
    while (j <= end) {
      const inner = inners.find((ii) => ii.start_idx === j && ii.end_idx >= ii.start_idx);
      if (inner) {
        // Inner bundle: recurse into its grandchildren. Tier-2 cap →
        // the recursive call will find no further inners under this
        // inner, but the structure stays uniform for the template.
        out.push({
          kind: "bundle",
          key: `b-${inner._uid}`,
          bundle: inner,
          children: bundleChildren(inner._uid, inner.start_idx, inner.end_idx),
        });
        j = inner.end_idx + 1;
        continue;
      }
      const m = modules[j];
      if (m) {
        out.push({ kind: "mod", key: m._uid ?? `m-${j}`, module: m, idx: j });
      }
      j++;
    }
    return out;
  }

  const out: TopLevelItem[] = [];
  let i = 0;
  while (i < modules.length) {
    // Top-level bundles only — bundles with a parent_uid render inside
    // their parent's children list via bundleChildren, not at the top.
    const b = bundles.find((bb) => bb.start_idx === i && !bb.parent_uid);
    if (b && b.end_idx >= b.start_idx) {
      out.push({
        kind: "bundle",
        key: `b-${b._uid}`,
        bundle: b,
        children: bundleChildren(b._uid, b.start_idx, b.end_idx),
      });
      i = b.end_idx + 1;
    } else {
      const m = modules[i];
      out.push({ kind: "mod", key: m._uid ?? `m-${i}`, module: m, idx: i });
      i++;
    }
  }
  return out;
}
