/**
 * Value and text kinds old → new: fixed values as the editor's table with
 * each row marked, a combine's or template's text as a word diff (with
 * the variables it starts or stops reading), and a delete card as the
 * library rows it removes.
 */
import type { AiChatOp } from "../../api/types";
import { diffList, diffWords, readVars } from "../../utils/card-diff";
import { chipFor } from "./info";
import type { CardView, CardViewContext, ValueRowView } from "./types";
import { isObj, objects, str, type Obj } from "./util";

export function valuesDiff(op: AiChatOp): CardView | null {
  if (op.op !== "update" || op.kind !== "module" || op.type !== "fixed_values" || !isObj(op.body.payload)) return null;
  const now = objects(op.body.payload.values);
  const was = objects(isObj(op.before?.payload) ? op.before.payload.values : []);
  const key = (v: Obj) => str(v.id) || str(v.name);
  const pick = (v: Obj) => ({ name: str(v.name), value: str(v.value), negative: str(v.negative) });
  const rows = diffList(was.map(pick).map((v, i) => ({ ...v, k: key(was[i]) })),
    now.map(pick).map((v, i) => ({ ...v, k: key(now[i]) })), (v) => v.k,
    (a, b) => a.name === b.name && a.value === b.value && a.negative === b.negative)
    .map((r): ValueRowView => {
      const old = r.change === "changed" ? r.was : null;
      return {
        name: r.now.name, value: r.now.value, negative: r.now.negative, change: r.change,
        wasName: old && old.name !== r.now.name ? old.name : null,
        wasValue: old && old.value !== r.now.value ? old.value : null,
        wasNegative: old && old.negative !== r.now.negative ? old.negative : null,
      };
    });
  const same = rows.filter((r) => r.change === "same").length;
  return same === rows.length ? null : { kind: "values", rows, same };
}

/** The texts of a combine or template change, by label. */
function texts(op: AiChatOp): Array<[string, string, string]> | null {
  if (op.op !== "update") return null;
  if (op.kind === "template") {
    const was = op.before ?? {};
    const now = op.body;
    return [["Prompt", str(was.template_string), str(now.template_string)],
      ["Negative", str(was.negative_template), str(now.negative_template)]];
  }
  if (op.kind === "module" && op.type === "combine" && isObj(op.body.payload)) {
    const was = isObj(op.before?.payload) ? op.before.payload : {};
    const now = op.body.payload;
    const out = str(now.output_var) || str(was.output_var);
    return [["Sets", str(was.output_var) && `$${str(was.output_var)}`, out && `$${out}`],
      ["Text", str(was.template), str(now.template)], ["Negative", str(was.negative), str(now.negative)]];
  }
  return null;
}

export function textDiff(op: AiChatOp): CardView | null {
  const all = texts(op);
  if (!all) return null;
  const changed = all.filter(([, was, now]) => was !== now);
  if (!changed.length) return null;
  const before = new Set(all.slice(-2).flatMap(([, was]) => readVars(was)));
  const after = new Set(all.slice(-2).flatMap(([, , now]) => readVars(now)));
  return {
    kind: "text-diff",
    rows: changed.map(([label, was, now]) => ({ label, parts: diffWords(was, now) })),
    reads: { added: [...after].filter((v) => !before.has(v)), removed: [...before].filter((v) => !after.has(v)) },
  };
}

export function deleteView(op: AiChatOp, ctx: CardViewContext): CardView | null {
  if (op.op !== "delete") return null;
  return {
    kind: "delete",
    items: op.items.map((it) => {
      const row = isObj(it.row) ? it.row : {};
      return { name: it.name, type: it.kind === "module" ? it.type : it.kind,
        category: chipFor(row.category_id, ctx), rating: str(row.content_rating) === "nsfw" ? "NSFW" : "" };
    }),
    categories: op.categories.map((c) => ({ name: c.name, color: c.color, icon: c.icon, count: c.members.length })),
    tags: op.tags.map((t) => ({ tag: t.tag, count: t.members.length })),
  };
}
