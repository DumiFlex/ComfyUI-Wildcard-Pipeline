/**
 * The card view registry: one builder per kind of change, tried in order.
 * Each returns a view or null; a card shows every view its builders give,
 * and one with none keeps the server's preview lines, so a card can never
 * draw blank. Data a builder doesn't understand makes it return null, and
 * a builder that throws counts as null too.
 */
import type { AiChatProposal } from "../../api/types";
import { createView } from "./create";
import { infoView } from "./info";
import { manageView } from "./manage";
import { rulesView } from "./rules";
import type { CardView, CardViewContext } from "./types";
import { wildcardView } from "./wildcard";

type Builder = (p: AiChatProposal, ctx: CardViewContext) => CardView | null;

const BUILDERS: Builder[] = [
  (p) => createView(p),
  (p, ctx) => infoView(p.op, ctx),
  (p) => wildcardView(p.op),
  (p) => rulesView(p),
  (p, ctx) => manageView(p.op, ctx),
];

/** Every view a card draws, in order (fields first, then content). */
export function cardViews(p: AiChatProposal, ctx: CardViewContext = {}): CardView[] {
  const out: CardView[] = [];
  for (const build of BUILDERS) {
    try {
      const v = build(p, ctx);
      if (v) out.push(v);
    } catch {
      // A builder that can't read this op leaves it to the others (or the lines).
    }
  }
  return out;
}

export { createView, testText } from "./create";
export type * from "./types";
