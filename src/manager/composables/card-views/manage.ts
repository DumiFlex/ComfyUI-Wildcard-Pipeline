/**
 * Library cards: categories as their chips (new ones, renames and new
 * colours or icons as chip → chip), tag renames and merges as
 * `#old → #new` with how many items they touch, and a bulk change as one
 * row per item with its category, rating or tags old → new.
 */
import type { AiChatOp } from "../../api/types";
import { chipFor, infoRows, newChip } from "./info";
import type { CardView, CardViewContext, CatChipView } from "./types";
import type { Obj } from "./util";

function categoriesView(op: Extract<AiChatOp, { op: "categories" }>, ctx: CardViewContext): CardView {
  const styles = op.styles ?? [];
  const styleOf = (name: string) => styles.find((s) => !s.id && s.name === name);
  const create = op.create.map((name) => newChip(name, styleOf(name)));
  const renamed = new Set(op.rename.map((r) => r.id));
  const rename = op.rename.map((r) => {
    const had = chipFor(r.id, ctx);
    const from: CatChipView = { name: r.from, color: had?.color ?? null, icon: had?.icon ?? null };
    const s = styles.find((x) => x.id === r.id);
    return { from, to: { name: r.to, color: s?.color ?? from.color, icon: s?.icon ?? from.icon } };
  });
  const restyle = styles.filter((s) => s.id && !renamed.has(s.id)).map((s) => {
    const had = chipFor(s.id, ctx);
    const from: CatChipView = {
      name: s.name || had?.name || "",
      color: s.before ? s.before.color : had?.color ?? null,
      icon: s.before ? s.before.icon : had?.icon ?? null,
    };
    return { from, to: { name: from.name, color: s.color ?? from.color, icon: s.icon ?? from.icon } };
  });
  return { kind: "categories", create, rename, restyle };
}

function tagsView(op: Extract<AiChatOp, { op: "tags" }>): CardView {
  return { kind: "tags", rows: op.rename.map((r) => ({ from: r.from, to: r.to, merge: r.merge, count: r.members.length })) };
}

function bulkView(op: Extract<AiChatOp, { op: "bulk" }>, ctx: CardViewContext): CardView | null {
  const fresh = op.new_category ? newChip(op.new_category, op.new_category_style) : null;
  const rows = op.items.map((it) => ({
    name: it.name,
    itemKind: it.kind,
    changes: infoRows(it.body as Obj, it.before as Obj, ctx, it.to_new ? fresh : null),
  })).filter((r) => r.changes.length);
  return rows.length ? { kind: "bulk", rows } : null;
}

export function manageView(op: AiChatOp, ctx: CardViewContext): CardView | null {
  if (op.op === "categories") return categoriesView(op, ctx);
  if (op.op === "tags") return op.rename.length ? tagsView(op) : null;
  if (op.op === "bulk") return bulkView(op, ctx);
  return null;
}
