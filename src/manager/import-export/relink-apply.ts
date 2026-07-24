/**
 * D3a — apply a library re-link across a workflow module set (pure).
 *
 * Re-pointing a detached instance is TWO edits done together:
 *   1. the instance's own `id` (+ payload_hash) swap to the library uuid;
 *   2. a walkRemap over EVERY module's payload + instance so any
 *      `@{oldUuid}` nested ref and constraint source/target that pointed at
 *      the old uuid follows to the new one.
 *
 * Reuses `walkRemap` verbatim — the same 1:1, segment-preserving uuid swap
 * the import friend->local remap uses. Pure: inputs are never mutated.
 */
import { walkRemap } from "../../components/context/bundles/uuid-remap";

export interface RelinkTarget {
  oldId: string;
  newId: string;
  /** Library payload_hash for the re-linked row (clears the missing dot). */
  newPayloadHash: string;
}

export function applyRelink<T extends Record<string, unknown>>(
  modules: readonly T[],
  target: RelinkTarget,
): T[] {
  const { oldId, newId, newPayloadHash } = target;
  const table = oldId && newId && oldId !== newId ? { [oldId]: newId } : {};
  return modules.map((m) => {
    const next: Record<string, unknown> = { ...m };
    if (next.payload && typeof next.payload === "object") {
      next.payload = walkRemap(next.payload, table);
    }
    if (next.instance && typeof next.instance === "object") {
      next.instance = walkRemap(next.instance, table);
    }
    if (next.id === oldId && oldId !== newId) {
      next.id = newId;
      next.payload_hash = newPayloadHash;
    }
    return next as T;
  });
}
