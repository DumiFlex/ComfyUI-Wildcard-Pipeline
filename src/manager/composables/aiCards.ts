/**
 * What a chat proposal card shows beyond its preview lines, and the parts
 * the user can change before applying it.
 *
 * A card that creates an item lists what it gets besides its content: the
 * description, library tags, category and variable, so a missing description
 * shows as missing instead of not at all. A card that creates a wildcard or
 * adds options lists its new options with a tick each: the unticked ones are
 * left out when it is applied or opened in an editor.
 */
import type { AiChatOp, AiChatProposal } from "../api/types";
import { createView } from "./card-views";
import { onlyAdds } from "./card-views/wildcard";

export { cardViews, testText } from "./card-views";
export type * from "./card-views/types";

export interface CardOption {
  id: string;
  text: string;
  weight: number;
  tags: string[];
  negative: string;
  fallback: boolean;
  empty: boolean;
}

export interface CardMeta {
  variable: string;
  description: string;
  tags: string[];
  /** An existing category's id, or "" with `newCategory`. */
  categoryId: string;
  newCategory: string;
  rating: string;
}

type Options = Array<Record<string, unknown>>;

function payloadOf(body: unknown): Record<string, unknown> | null {
  const p = (body as { payload?: unknown } | undefined)?.payload;
  return p && typeof p === "object" ? p as Record<string, unknown> : null;
}

function optionsOf(payload: Record<string, unknown> | null): Options {
  const list = payload?.options;
  return Array.isArray(list) ? list.filter((o): o is Record<string, unknown> => !!o && typeof o === "object") : [];
}

function isWildcardOp(op: AiChatOp): boolean {
  if (op.op === "create") return op.kind === "module" && op.body.type === "wildcard";
  return op.op === "update" && op.kind === "module" && op.type === "wildcard";
}

/** The options a card adds, each pickable; null when the card doesn't add
 *  wildcard options (or changes existing ones, which aren't pickable). */
export function cardOptions(p: AiChatProposal): CardOption[] | null {
  const op = p.op;
  if (!isWildcardOp(op) || (op.op !== "create" && op.op !== "update")) return null;
  const now = optionsOf(payloadOf(op.body));
  const before = op.op === "update" ? optionsOf(payloadOf(op.before)) : [];
  // Only a card that adds options and leaves the rest as they were.
  if (op.op === "update" && !onlyAdds(before, now)) return null;
  const had = new Set(before.map((o) => String(o.id)));
  const fresh = now.filter((o) => !had.has(String(o.id)));
  if (!fresh.length) return null;
  return fresh.map((o) => ({
    id: String(o.id),
    text: typeof o.value === "string" ? o.value : "",
    weight: typeof o.weight === "number" ? o.weight : 1,
    tags: Array.isArray(o.sub_categories) ? o.sub_categories.filter((t): t is string => typeof t === "string") : [],
    negative: typeof o.negative === "string" ? o.negative : "",
    fallback: o.fallback === true,
    empty: o.is_null === true,
  }));
}

/** The card's op with the unticked options taken out. */
export function withoutOptions<T extends AiChatOp>(op: T, skip: ReadonlySet<string>): T {
  if (!skip.size || (op.op !== "create" && op.op !== "update")) return op;
  const payload = payloadOf(op.body);
  if (!payload) return op;
  const options = optionsOf(payload).filter((o) => !skip.has(String(o.id)));
  return { ...op, body: { ...op.body, payload: { ...payload, options } } };
}

/** Description, tags, category and variable of a card that creates an item. */
export function cardMeta(p: AiChatProposal): CardMeta | null {
  const op = p.op;
  if (op.op !== "create") return null;
  const body = op.body as unknown as Record<string, unknown>;
  const payload = payloadOf(body);
  const variable = typeof payload?.var_binding === "string" ? payload.var_binding
    : typeof payload?.output_var === "string" ? payload.output_var : "";
  return {
    variable,
    description: typeof body.description === "string" ? body.description : "",
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [],
    categoryId: typeof body.category_id === "string" ? body.category_id : "",
    newCategory: op.new_category || "",
    rating: typeof body.content_rating === "string" ? body.content_rating : "",
  };
}

/** The new-item route of each module type's editor. */
const NEW_ROUTES: Record<string, string> = {
  wildcard: "wildcards-new", derivation: "derivations-new", fixed_values: "fixed-values-new",
  combine: "combines-new", constraint: "constraints-new",
};

/** The new-item route a create card opens in, or "". */
export function draftRoute(p: AiChatProposal): string {
  const op = p.op;
  if (op.op !== "create") return "";
  if (op.kind === "bundle") return "bundles-new";
  if (op.kind === "template") return "templates-new";
  return NEW_ROUTES[op.body.type] ?? "";
}

/** The editor type a create card's draft is for. */
export function draftType(p: AiChatProposal): string {
  const op = p.op;
  if (op.op !== "create") return "";
  return op.kind === "module" ? op.body.type : op.kind;
}

/** The text of a card's preview minus the lines the structured view shows
 *  (the options and tag groups of a wildcard card). */
export function otherPreview(p: AiChatProposal, options: CardOption[] | null): string[] {
  if (!options) return p.preview;
  return p.preview.filter((line) => {
    if (line.startsWith("Group ")) return true;
    if (line.startsWith("∅")) return !options.some((o) => o.empty);
    const plain = withoutRefs(line);
    return !options.some((o) => o.text && plain.includes(withoutRefs(o.text)));
  });
}

/** Text with its `@{…}` references taken out: a card's option holds
 *  `@{id#Color}` where its preview line says `@{Color}`. */
function withoutRefs(text: string): string {
  return text.replace(/@\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
}

/** How a create card shows what it makes, or null for the plain lines
 *  (`cardViews` gives every view, change cards' too). */
export function cardView(p: AiChatProposal): ReturnType<typeof createView> {
  return createView(p);
}
