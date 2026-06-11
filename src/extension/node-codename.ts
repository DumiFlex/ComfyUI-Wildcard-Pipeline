/**
 * Stable, unique, human-readable codenames for WP_Context nodes.
 *
 * A WP_Context node needs a name the cross-node constraint UI (reach
 * pick-list, pair popovers) can use to say WHICH node a target instance
 * lives in. The pre-2026 design used an editable label with an auto
 * `A`/`B`/`C` fallback assigned by upstream→downstream WALK POSITION — but
 * that was (a) computed from each viewing node's own perspective, so the
 * same physical node showed different letters to different viewers and two
 * chain heads both became "A", and (b) editable, so not a stable identifier.
 *
 * This module replaces it with a fixed `adjective-noun` codename derived
 * deterministically from the litegraph `node.id` (stable for a node's
 * lifetime, unique per canvas, preserved across save/load). The name never
 * depends on graph topology or viewer, and is not user-editable.
 *
 * `assignCodenames` adds a hard uniqueness guarantee: if two nodes' base
 * codenames ever collide (≈4096-combo namespace makes this rare), the
 * collision is broken with a deterministic numeric suffix by id order, so a
 * canvas NEVER shows two identical node names.
 *
 * Pure data — no Vue / DOM / litegraph imports. Mirrors the engine-side
 * isolation discipline of the other `extension/*` helpers.
 */

// 64 adjectives × 64 nouns = 4096 base combinations. Lowercase single
// words, neutral/calm palette (colours, textures, moods) so a codename
// reads cleanly in a chip. Lengths are intentionally powers of two so the
// hash split below distributes evenly across both lists.
const ADJECTIVES: readonly string[] = [
  "amber", "azure", "brisk", "calm", "cedar", "clay", "cobalt", "copper",
  "coral", "crimson", "dusk", "dawn", "ember", "fern", "frost", "gilded",
  "golden", "gray", "hazel", "indigo", "ivory", "jade", "lilac", "lunar",
  "maple", "misty", "mossy", "navy", "ochre", "olive", "onyx", "opal",
  "pearl", "plum", "quiet", "rapid", "rosy", "ruby", "rust", "sage",
  "sandy", "scarlet", "silent", "silver", "slate", "snowy", "solar", "spruce",
  "stark", "steel", "stone", "sunny", "swift", "teal", "tidal", "umber",
  "velvet", "vivid", "warm", "willow", "windy", "wren", "zephyr", "zinc",
];

const NOUNS: readonly string[] = [
  "otter", "fox", "heron", "lynx", "marten", "raven", "finch", "falcon",
  "badger", "beaver", "bison", "crane", "dove", "eagle", "egret", "gecko",
  "hare", "ibis", "jay", "kestrel", "koi", "lark", "lemur", "marmot",
  "mink", "moth", "newt", "oriole", "osprey", "owl", "panther", "puffin",
  "quail", "rabbit", "robin", "sable", "salmon", "shrike", "sparrow", "stoat",
  "stork", "swan", "tanager", "thrush", "toad", "vole", "weasel", "wolf",
  "brook", "canyon", "cliff", "cove", "delta", "dune", "fjord", "glade",
  "grove", "harbor", "hollow", "knoll", "marsh", "mesa", "ridge", "summit",
];

/** djb2 string hash → unsigned 32-bit. Same family as `varColorIndex`'s
 *  token hash; kept local so this module stays dependency-free. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic `adjective-noun` codename for a litegraph node id. Numeric
 * and string forms of the same id hash identically (call sites mix them).
 * Adjective is taken from the low part of the hash, noun from the high
 * part, so the two vary independently across ids.
 */
export function baseCodename(nodeId: string | number): string {
  const h = djb2(String(nodeId));
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  return `${adj}-${noun}`;
}

/**
 * Assign a UNIQUE codename to every node id on the canvas. Returns a Map
 * keyed by the STRING form of each id. Base codenames come straight from
 * {@link baseCodename}; the rare collision (two ids → same base) is broken
 * deterministically — sort the colliding ids ascending and append `-2`,
 * `-3`, … to all but the first. This is order-independent (the result for
 * a given id doesn't depend on input order) and stable (a node keeps its
 * name unless its lower-id collision partner is removed), while making
 * duplicate names on one canvas impossible.
 */
export function assignCodenames(nodeIds: Array<string | number>): Map<string, string> {
  // Sort by numeric id when both are numeric (the litegraph norm), else
  // lexicographically — gives a stable, input-order-independent ordering
  // so dedup suffixes are assigned consistently.
  const sorted = [...nodeIds].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  });
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const id of sorted) {
    const base = baseCodename(id);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(String(id), n === 0 ? base : `${base}-${n + 1}`);
  }
  return out;
}
