/**
 * forkModule — creates a new library entry from a draft module via
 * POST /wp/api/modules (the existing `create_module` endpoint). Used
 * by the save-to-library fork path when the draft's uuid has siblings
 * elsewhere in the workflow.
 *
 * Picks a non-colliding display name by appending " (copy)" /
 * " (copy 2)" / ... — caller provides the set of existing library
 * names so the collision check stays local (no server round-trip
 * for name lookup).
 *
 * Returns the new uuid + hash + suffixed name so the caller can
 * mutate the draft in place: `draft.id = newId`, `draft.payload_hash
 * = newHash`, `draft.meta.name = suffixedName`.
 */
export interface ForkInput {
  id: string;
  type: string;
  meta: { name?: string; [k: string]: unknown };
  payload: Record<string, unknown> | undefined;
}
export interface ForkResult {
  newId: string;
  newHash: string;
  suffixedName: string;
}

export async function forkModule(
  draft: ForkInput,
  existingLibraryNames: ReadonlySet<string>,
): Promise<ForkResult> {
  const baseName = stripCopySuffix(draft.meta?.name ?? draft.type);
  const suffixedName = pickCopyName(baseName, existingLibraryNames);

  const res = await fetch("/wp/api/modules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: draft.type,
      name: suffixedName,
      payload: draft.payload ?? {},
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json() as { id: string; payload_hash: string };
  return { newId: body.id, newHash: body.payload_hash, suffixedName };
}

function stripCopySuffix(name: string): string {
  return name.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/, "");
}

function pickCopyName(base: string, taken: ReadonlySet<string>): string {
  const first = `${base} (copy)`;
  if (!taken.has(first)) return first;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (copy ${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (copy ${Date.now()})`;
}
