/**
 * Reading a slot's links on any frontend.
 *
 * Frontend 1.58 turned `input.link` and `output.links` into getters that
 * log a deprecation warning, look the link up in the graph's link store on
 * every read, and (`output.links`) rebuild a legacy array each time. The
 * node's own `getInputLink(slot)` and the graph's links are the supported
 * way in. Older frontends (and the plain objects in tests) keep the links
 * as data on the slot, so read them there.
 */

/** Typed as the graph types key links (numbers); a frontend may hand strings at runtime, which index the same. */
export type LinkId = number;

export interface SlotLinkLike {
  link?: LinkId | null;
  links?: readonly LinkId[] | null;
}

interface LinkRecord {
  id: LinkId;
  origin_id: unknown;
  origin_slot: number;
}

interface SlotOwner {
  id?: unknown;
  inputs?: readonly unknown[] | null;
  outputs?: readonly unknown[] | null;
  graph?: { links?: unknown } | null;
  getInputLink?: (slot: number) => { id: LinkId } | null | undefined;
}

/** Is `key` an accessor (a getter) on `obj` or its prototypes? */
function isGetter(obj: object, key: string): boolean {
  for (let p: object | null = obj; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as object | null) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return typeof d.get === "function";
  }
  return false;
}

function ownerOf(slot: object): SlotOwner | null {
  const node = (slot as { node?: unknown }).node;
  return node && typeof node === "object" ? (node as SlotOwner) : null;
}

function linkRecords(links: unknown): Iterable<unknown> {
  if (links instanceof Map) return links.values();
  if (links && typeof links === "object") return Object.values(links);
  return [];
}

/** The id of the link into an input slot, or null when it isn't wired. */
export function inputLinkId(slot: SlotLinkLike | null | undefined): LinkId | null {
  if (!slot) return null;
  if (!isGetter(slot, "link")) return slot.link ?? null;
  const node = ownerOf(slot);
  const index = node?.inputs?.indexOf(slot) ?? -1;
  if (!node?.graph || index < 0 || typeof node.getInputLink !== "function") return null;
  try {
    return node.getInputLink(index)?.id ?? null;
  } catch {
    return null;
  }
}

/** Is an input slot wired? */
export function isInputWired(slot: SlotLinkLike | null | undefined): boolean {
  return inputLinkId(slot) != null;
}

/** The ids of the links out of an output slot (empty when none). */
export function outputLinkIds(slot: SlotLinkLike | null | undefined): readonly LinkId[] {
  if (!slot) return [];
  if (!isGetter(slot, "links")) return slot.links ?? [];
  const node = ownerOf(slot);
  const index = node?.outputs?.indexOf(slot) ?? -1;
  if (!node?.graph || index < 0) return [];
  const ids: LinkId[] = [];
  for (const raw of linkRecords(node.graph.links)) {
    const link = raw as Partial<LinkRecord> | null;
    if (link?.id == null || link.origin_slot !== index || String(link.origin_id) !== String(node.id)) continue;
    ids.push(link.id);
  }
  return ids.sort((a, b) => Number(a) - Number(b));
}
