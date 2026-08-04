/**
 * D3a — content-aware library re-link matching (pure).
 *
 * A workflow module needs re-linking when its uuid is absent from the live
 * library. Two ways that happens:
 *
 *   - DETACHED — it was library-tracked (carries a payload_hash) but the
 *     library row now has a different uuid, because a re-import minted a fresh
 *     id on collision.
 *   - UNLINKED — it carries NO payload_hash at all. Originally read as "never
 *     library-tracked, nothing to re-link to", which is true for a module
 *     authored in the widget but wrong for the cases that actually bite: a
 *     workflow shared by someone else, or a row whose stored hash was lost.
 *     Those very likely correspond to a library entry.
 *
 * Identity signals, strongest first:
 *
 *   1. `payload_hash` equality — the server's content-derived hash. Available
 *      only when BOTH sides have one.
 *   2. `contentKey` equality — a fingerprint computed locally from the payload
 *      (see `localPayloadFingerprint`). Covers the hash-less case; both sides
 *      are computed here so no cross-language parity is needed.
 *   3. (type, name) equality — the weak signal. Surfaces as "content differs"
 *      and NEVER auto-links.
 *
 * Pure — no store, no fetch, no Vue.
 */

export interface RelinkDraft {
  id: string;
  type: string;
  payload_hash?: string;
  /** Locally computed payload fingerprint. Lets a hash-less draft still match
   *  on content. */
  contentKey?: string;
  name: string;
}

/** A live library row as the matcher sees it. */
export interface RelinkLiveEntry {
  type?: string;
  payload_hash: string;
  /** Locally computed fingerprint of this row's payload, when the caller has
   *  the payload in hand. Absent for callers that only hold the hash map. */
  contentKey?: string;
}

export interface RelinkCandidate {
  uuid: string;
  name: string;
  /** The library row's payload_hash — used to stamp the instance on confirm. */
  payloadHash: string;
  /** Same content: either payload_hash matched, or (for a hash-less draft) the
   *  locally computed payload fingerprint did. */
  contentIdentical: boolean;
  /** (type, name) match with DIFFERENT content — surface "content differs". */
  nameMatch: boolean;
  /** True when `contentIdentical` was established WITHOUT a server hash, i.e.
   *  by local payload fingerprint. The UI says so rather than implying the
   *  authoritative hash agreed. */
  matchedByContent?: boolean;
}

export function findRelinkCandidates(
  draft: RelinkDraft,
  live: Record<string, RelinkLiveEntry>,
  nameLookup: (uuid: string) => { name: string; type: string } | undefined,
): RelinkCandidate[] {
  const draftName = draft.name.trim().toLowerCase();
  const out: RelinkCandidate[] = [];
  for (const [uuid, entry] of Object.entries(live)) {
    if (uuid === draft.id) continue; // never the still-detached uuid
    // Type gate — the 8-hex id-space is shared across all 5 kinds, so a
    // cross-kind id must never be offered. Prefer the hash entry's type; fall
    // back to the name lookup's type when the optimistic hash entry omitted it.
    const meta = nameLookup(uuid);
    const rowType = entry.type ?? meta?.type;
    if (rowType !== undefined && rowType !== draft.type) continue;
    const name = meta?.name ?? uuid;
    const hashMatch =
      Boolean(draft.payload_hash) && entry.payload_hash === draft.payload_hash;
    // Fallback identity for a hash-less draft. Only consulted when the server
    // hash can't decide, so a present-but-different hash still wins as "differs".
    const contentMatch =
      !draft.payload_hash
      && Boolean(draft.contentKey)
      && entry.contentKey === draft.contentKey;
    const contentIdentical = hashMatch || contentMatch;
    const nameMatch =
      !contentIdentical && draftName.length > 0 && name.trim().toLowerCase() === draftName;
    if (!contentIdentical && !nameMatch) continue;
    out.push({
      uuid,
      name,
      payloadHash: entry.payload_hash,
      contentIdentical,
      nameMatch,
      ...(contentMatch ? { matchedByContent: true } : {}),
    });
  }
  return out.sort((a, b) => {
    if (a.contentIdentical !== b.contentIdentical) return a.contentIdentical ? -1 : 1;
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The single unambiguous auto-relink target: exactly ONE content-identical
 * candidate. Returns null when 0 or >1 identical candidates exist — those
 * require a deliberate pick. Non-identical name matches never gate an
 * otherwise-unique identical target.
 */
export function autoRelinkTarget(candidates: RelinkCandidate[]): RelinkCandidate | null {
  const identical = candidates.filter((c) => c.contentIdentical);
  return identical.length === 1 ? identical[0] : null;
}
