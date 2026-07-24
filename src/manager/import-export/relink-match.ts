/**
 * D3a — content-aware library re-link matching (pure).
 *
 * A workflow module instance is "detached" when it was library-tracked
 * (carries a payload_hash) but its uuid is absent from the live library
 * hashes — the library row got a different uuid (a re-import minted a fresh
 * id on collision). Re-link points the instance back at the existing
 * content-identical row instead of minting yet another duplicate.
 *
 * Identity signal: payload_hash is the server's content-derived hash, so the
 * detached instance and its re-imported twin share a payload_hash under
 * different uuids. A candidate is content-IDENTICAL when (type, payload_hash)
 * match; same (type, name) with a DIFFERENT payload_hash is a weaker
 * "content differs" candidate the user picks deliberately. Never auto-link on
 * name alone.
 *
 * Pure — no store, no fetch, no Vue.
 */

export interface RelinkDraft {
  id: string;
  type: string;
  payload_hash?: string;
  name: string;
}

export interface RelinkCandidate {
  uuid: string;
  name: string;
  /** The library row's payload_hash — used to stamp the instance on confirm. */
  payloadHash: string;
  /** (type, payload_hash) match — same content, just a detached uuid. */
  contentIdentical: boolean;
  /** (type, name) match but payload_hash differs — surface "content differs". */
  nameMatch: boolean;
}

export function findRelinkCandidates(
  draft: RelinkDraft,
  live: Record<string, { type?: string; payload_hash: string }>,
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
    const contentIdentical =
      Boolean(draft.payload_hash) && entry.payload_hash === draft.payload_hash;
    const nameMatch = draftName.length > 0 && name.trim().toLowerCase() === draftName;
    if (!contentIdentical && !nameMatch) continue;
    out.push({ uuid, name, payloadHash: entry.payload_hash, contentIdentical, nameMatch });
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
