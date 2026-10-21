/**
 * Chat card groups: the cards of one answer that do the same kind of thing
 * (fourteen "Create wildcard" cards, eight "Add options" cards) shown as one
 * group card with a row per item, so a big answer reads as one change you
 * can tick through instead of a wall of cards. Each row still opens its own
 * full card, and applying a group applies its ticked cards one by one, the
 * way their own Apply buttons would.
 *
 * Pure: the drawer (`AiChatDrawer.vue`) and `AiCardGroup.vue` use it.
 */
import type { AiChatProposal } from "../api/types";

/** Fewer cards of a kind than this stay as they are. */
export const MIN_GROUP = 3;

export interface CardGroup {
  /** What the cards do, e.g. `create:wildcard` or `update:add_options`. */
  key: string;
  /** The cards, in the answer's order. */
  pids: string[];
}

/** The kind a card groups by, or null for one that never groups: links,
 *  deletes (each keeps its own confirm) and the library-wide ones, which
 *  are already one card for many items. */
export function groupKey(p: AiChatProposal): string | null {
  const op = p.op;
  if (op.op === "create") {
    return `create:${op.kind === "module" ? String(op.body.type ?? "module") : op.kind}`;
  }
  if (op.op === "update") return `update:${p.tool}`;
  return null;
}

/** The groups of an answer's cards: every kind with at least MIN_GROUP
 *  cards, in the order its first card comes. */
export function cardGroups(proposals: AiChatProposal[]): CardGroup[] {
  const by = new Map<string, string[]>();
  for (const p of proposals) {
    const k = groupKey(p);
    if (!k) continue;
    const list = by.get(k);
    if (list) list.push(p.pid);
    else by.set(k, [p.pid]);
  }
  return [...by.entries()].filter(([, pids]) => pids.length >= MIN_GROUP)
    .map(([key, pids]) => ({ key, pids }));
}

/** Each grouped card's group, by card id. */
export function groupOf(groups: CardGroup[]): Map<string, CardGroup> {
  const out = new Map<string, CardGroup>();
  for (const g of groups) for (const pid of g.pids) out.set(pid, g);
  return out;
}

const NOUNS: Record<string, [string, string]> = {
  wildcard: ["wildcard", "wildcards"], derivation: ["derivation", "derivations"],
  constraint: ["constraint", "constraints"], fixed_values: ["fixed values", "fixed values"],
  combine: ["combine", "combines"], template: ["template", "templates"], bundle: ["bundle", "bundles"],
};

const UPDATES: Record<string, string> = {
  add_options: "Add options to", edit_options: "Change options in", update_info: "Describe",
  add_rules: "Add rules to", edit_rules: "Change rules in", edit_constraint: "Change",
  edit_values: "Change values in", edit_combine: "Change", edit_template: "Change",
  edit_bundle: "Change",
};

/** The group card's title: "Create 14 wildcards", "Add options to 8 items". */
export function groupTitle(key: string, n: number): string {
  const [op, what] = key.split(":");
  if (op === "create") {
    const noun = NOUNS[what] ?? [what, `${what}s`];
    return `Create ${n} ${n === 1 ? noun[0] : noun[1]}`;
  }
  return `${UPDATES[what] ?? "Change"} ${n} item${n === 1 ? "" : "s"}`;
}
