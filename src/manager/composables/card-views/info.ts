/**
 * An item's own fields old → new: name, description, tags, category and
 * rating, the fields an "Update" card or a bulk change touches. The
 * category is a chip in its colour and icon, the tags are chips with the
 * dropped ones struck through and the added ones marked.
 */
import type { AiChatOp, AiNewCategoryStyle } from "../../api/types";
import { diffTags, tagsChanged } from "../../utils/card-diff";
import type { CardView, CardViewContext, CatChipView, InfoRowView } from "./types";
import { isObj, str, strings, type Obj } from "./util";

const RATINGS: Record<string, string> = { safe: "Safe", nsfw: "NSFW" };

/** A category id as a chip; null for none. */
export function chipFor(id: unknown, ctx: CardViewContext): CatChipView | null {
  if (typeof id !== "string" || !id) return null;
  return ctx.category?.(id) ?? { name: id, color: null, icon: null };
}

/** The category a card makes, as a chip. */
export function newChip(name: string, style?: AiNewCategoryStyle): CatChipView {
  return { name, color: style?.color ?? null, icon: style?.icon ?? null, isNew: true };
}

/**
 * The fields `body` changes against `before`. `newCategory`: the card
 * puts the item in a category it makes.
 */
export function infoRows(body: Obj, before: Obj, ctx: CardViewContext,
  newCategory?: CatChipView | null): InfoRowView[] {
  const rows: InfoRowView[] = [];
  if ("name" in body && str(body.name) !== str(before.name)) {
    rows.push({ field: "text", label: "Name", from: str(before.name), to: str(body.name) });
  }
  if ("description" in body && str(body.description) !== str(before.description)) {
    rows.push({ field: "text", label: "Description", from: str(before.description), to: str(body.description) });
  }
  if ("tags" in body) {
    const tags = diffTags(strings(before.tags), strings(body.tags));
    if (tagsChanged(tags)) rows.push({ field: "tags", label: "Tags", tags });
  }
  if (newCategory || ("category_id" in body && body.category_id !== before.category_id)) {
    rows.push({ field: "category", label: "Category", from: chipFor(before.category_id, ctx),
      to: newCategory ?? chipFor(body.category_id, ctx) });
  }
  if ("content_rating" in body && str(body.content_rating) !== (str(before.content_rating) || "safe")) {
    const label = (r: string) => RATINGS[r] ?? r;
    rows.push({ field: "rating", label: "Rating", from: label(str(before.content_rating) || "safe"),
      to: label(str(body.content_rating)) });
  }
  return rows;
}

/** An update card's field changes (beside whatever its payload changes). */
export function infoView(op: AiChatOp, ctx: CardViewContext): CardView | null {
  if (op.op !== "update") return null;
  const body = op.body as unknown as Obj;
  const before = isObj(op.before) ? op.before as Obj : {};
  const fresh = op.new_category ? newChip(op.new_category, op.new_category_style) : null;
  const rows = infoRows(body, before, ctx, fresh);
  return rows.length ? { kind: "info", rows } : null;
}
