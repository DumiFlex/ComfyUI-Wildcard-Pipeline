import { nodeBadge, nodeBadgeSlot } from "./_stashes";

// ── Badge slot for Nodes 2.0 ───────────────────────────────────────────
// Nodes 2.0 (Vue nodes) draws `node.badges` from a Vue `computed` that reads
// the plain LiteGraph array. Pushing a badge into it later changes nothing
// Vue can see, so the subgraph conflict badge only showed after something
// else re-ran that computed (entering and leaving the subgraph, or switching
// to the legacy nodes and back).
//
// So each SubgraphNode gets ONE badge entry up front, from `nodeCreated` /
// `loadedGraphNode`, before its Vue node first renders: a getter, which both
// renderers call on every draw (`toValue` in Nodes 2.0, `badge()` in the
// legacy canvas). It returns the node's current badge, or an empty one
// (an empty LGraphBadge draws nothing in either renderer). Inside the Vue
// computed the getter also reads a revision number off a reactive object of
// ComfyUI's own (`app.extensionManager`, a Pinia store), so bumping that
// number is what tells Nodes 2.0 to read the badges again. Our bundled Vue
// is a separate copy, so a ref of ours would not be tracked there.

interface BadgeLike { text: string }
type BadgeCtor = new (opts: { text?: string }) => BadgeLike;
type BadgeHost = Record<string, unknown>;
type BadgeNode = { badges?: unknown[] };

/** Namespaced key on the host store; nothing else reads or writes it. */
export const BADGE_REVISION_KEY = "wpSubgraphBadgeRevision";

let hostOf: () => BadgeHost | null | undefined = () => null;
let empty: BadgeLike | null = null;

/** Where the revision lives. main.ts passes `() => app.extensionManager`. */
export function setBadgeHost(fn: () => unknown): void {
  hostOf = () => {
    const h = fn();
    return h && typeof h === "object" ? (h as BadgeHost) : null;
  };
}

function readRevision(): unknown {
  return hostOf()?.[BADGE_REVISION_KEY];
}

/** Tell Nodes 2.0 a badge changed. Harmless when no host is set. */
export function bumpBadgeRevision(): void {
  const host = hostOf();
  if (!host) return;
  const cur = host[BADGE_REVISION_KEY];
  host[BADGE_REVISION_KEY] = (typeof cur === "number" ? cur : 0) + 1;
}

function emptyBadge(): BadgeLike | null {
  if (empty) return empty;
  const Ctor = (window as unknown as { LGraphBadge?: BadgeCtor }).LGraphBadge;
  if (!Ctor) return null;
  empty = new Ctor({ text: "" });
  return empty;
}

/** Put the node's one badge getter in `node.badges`. Idempotent; false when
 *  LGraphBadge isn't on window (then the caller pushes badges itself). */
export function ensureBadgeSlot(node: BadgeNode): boolean {
  if (nodeBadgeSlot.has(node)) return true;
  const fallback = emptyBadge();
  if (!fallback) return false;
  const slot = (): BadgeLike => {
    void readRevision();
    return (nodeBadge.get(node) as BadgeLike | undefined) ?? fallback;
  };
  if (!Array.isArray(node.badges)) node.badges = [];
  node.badges.push(slot);
  nodeBadgeSlot.set(node, slot);
  return true;
}

export function hasBadgeSlot(node: BadgeNode): boolean {
  return nodeBadgeSlot.has(node);
}

/** Take the getter back out (node removed, badge torn down). */
export function removeBadgeSlot(node: BadgeNode): void {
  const slot = nodeBadgeSlot.get(node);
  if (!slot) return;
  const idx = Array.isArray(node.badges) ? node.badges.indexOf(slot) : -1;
  if (idx >= 0) node.badges?.splice(idx, 1);
  nodeBadgeSlot.delete(node);
  bumpBadgeRevision();
}

export function _resetBadgeSlotForTests(): void {
  empty = null;
  hostOf = () => null;
}
