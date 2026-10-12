/**
 * After a wildcard pack import: the ask the assistant gets when the user
 * hands it the freshly imported wildcards to tidy up. Converted packs come
 * in as flat lists; the assistant tags their options, groups the tags into
 * axes, links the lists with constraints (with a fallback where a rule could
 * leave a list empty), gathers them into a bundle and checks the result
 * with a test run. Every change comes back as a proposal to apply or skip.
 */
import type { CommitPayload } from "./commit";

/** Names of the wildcards a commit added, replaced or renamed in. */
export function committedWildcardNames(payload: CommitPayload): string[] {
  const names: string[] = [];
  const add = (kind: string, entity: Record<string, unknown>): void => {
    if (kind === "wildcard" && typeof entity.name === "string" && entity.name.trim()) {
      names.push(entity.name.trim());
    }
  };
  for (const a of payload.adds) add(a.kind, a.entity);
  for (const r of payload.replaces) add(r.kind, r.new_content);
  for (const r of payload.renames) add(r.kind, r.content);
  return [...new Set(names)];
}

/** Most wildcards named in the ask; the assistant finds the rest itself. */
export const MAX_NAMED = 40;

export function upgradeAsk(names: string[]): string {
  const shown = names.slice(0, MAX_NAMED).map((n) => `"${n}"`).join(", ");
  const more = names.length > MAX_NAMED ? ` and ${names.length - MAX_NAMED} more` : "";
  return [
    `I just imported these wildcards from a wildcard pack: ${shown}${more}.`,
    "Make them work together:",
    "1. Tag their options where a tag would help a rule pick them (season, mood, body part, and so on), and group the tags into tag groups when a wildcard has more than one kind.",
    "2. Propose constraints where one pick should steer another, with a fallback option on any target a rule could leave empty.",
    "3. Gather the ones that belong together into a bundle in a sensible order.",
    "4. Run a test of the result and tell me what looks off.",
    "Keep the option text as it is unless it's broken, and skip lists that are fine alone.",
  ].join("\n");
}
