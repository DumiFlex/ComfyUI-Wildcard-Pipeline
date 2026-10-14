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
  if (op.op === "update") {
    // Only a card that adds options and leaves the rest as they were.
    const old = new Map(before.map((o) => [String(o.id), JSON.stringify(o)]));
    const kept = now.filter((o) => old.has(String(o.id)));
    if (kept.length !== before.length || kept.some((o) => old.get(String(o.id)) !== JSON.stringify(o))) return null;
  }
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
    : typeof payload?.var === "string" ? payload.var : "";
  return {
    variable,
    description: typeof body.description === "string" ? body.description : "",
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [],
    categoryId: typeof body.category_id === "string" ? body.category_id : "",
    newCategory: op.new_category || "",
    rating: typeof body.content_rating === "string" ? body.content_rating : "",
  };
}

/** Types whose editor can open a proposed new item, unsaved. */
const DRAFT_TYPES = new Set(["wildcard", "derivation"]);

/** The new-item route a create card opens in, or "". */
export function draftRoute(p: AiChatProposal): string {
  const op = p.op;
  if (op.op !== "create" || op.kind !== "module" || !DRAFT_TYPES.has(op.body.type)) return "";
  return `${op.body.type}s-new`;
}

/** The text of a card's preview minus the lines the structured view shows
 *  (the options and tag groups of a wildcard card). */
export function otherPreview(p: AiChatProposal, options: CardOption[] | null): string[] {
  if (!options) return p.preview;
  return p.preview.filter((line) => {
    if (line.startsWith("Group ")) return true;
    if (line.startsWith("∅")) return !options.some((o) => o.empty);
    return !options.some((o) => o.text && line.includes(o.text));
  });
}
