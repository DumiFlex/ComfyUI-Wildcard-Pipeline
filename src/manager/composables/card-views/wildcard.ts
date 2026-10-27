/**
 * A wildcard edit as an option diff, the way the wildcard editor lists
 * options: added rows marked new, removed rows struck through, changed
 * rows old → new (text, share of the draw, tags, negative, fallback), and
 * the options left alone folded into a count.
 *
 * A card that only adds options keeps its tick list (`aiCards.cardOptions`)
 * instead, so its new options stay pickable.
 */
import type { AiChatOp } from "../../api/types";
import { diffList, diffTags, shares, tagsChanged } from "../../utils/card-diff";
import type { CardView, InfoRowView, OptionDiffRow } from "./types";
import { isObj, objects, str, strings, type Obj } from "./util";

/** The options of an op body's payload. */
export function optionsIn(body: unknown): Obj[] {
  const payload = isObj(body) && isObj(body.payload) ? body.payload : null;
  return objects(payload?.options);
}

/** Whether `after` is `before` with options added and nothing else changed. */
export function onlyAdds(before: readonly Obj[], after: readonly Obj[]): boolean {
  const old = new Map(before.map((o) => [String(o.id), JSON.stringify(o)]));
  const kept = after.filter((o) => old.has(String(o.id)));
  return kept.length === before.length && kept.every((o) => old.get(String(o.id)) === JSON.stringify(o))
    && after.length > before.length;
}

const weightOf = (o: Obj): number => (typeof o.weight === "number" ? o.weight : 1);

function fieldRows(was: Obj, now: Obj): InfoRowView[] {
  const rows: InfoRowView[] = [];
  if ("var_binding" in now && str(now.var_binding) !== str(was.var_binding)) {
    rows.push({ field: "text", label: "Variable", from: str(was.var_binding) && `$${str(was.var_binding)}`,
      to: str(now.var_binding) && `$${str(now.var_binding)}` });
  }
  if ("sub_categories" in now) {
    const tags = diffTags(strings(was.sub_categories), strings(now.sub_categories));
    if (tagsChanged(tags)) rows.push({ field: "tags", label: "Option tags", tags });
  }
  return rows;
}

export function wildcardView(op: AiChatOp): CardView | null {
  if (op.op !== "update" || op.kind !== "module" || op.type !== "wildcard") return null;
  const nowPayload = isObj(op.body.payload) ? op.body.payload : null;
  if (!nowPayload) return null;
  const wasPayload = isObj(op.before?.payload) ? op.before.payload : {};
  const before = optionsIn(op.before);
  const after = optionsIn(op.body);
  const fields = fieldRows(wasPayload, nowPayload);
  if (onlyAdds(before, after)) {
    return fields.length ? { kind: "options", rows: [], same: 0, before: before.length, after: after.length, fields } : null;
  }
  const wasShare = new Map(shares(before.map(weightOf)).map((s, i) => [String(before[i].id), s]));
  const nowShare = new Map(shares(after.map(weightOf)).map((s, i) => [String(after[i].id), s]));
  const rows = diffList(before, after, (o) => String(o.id)).map((r): OptionDiffRow => {
    const id = String(r.now.id);
    const was = r.change === "changed" ? r.was : null;
    const differs = <T>(a: T, b: T): T | null => (was && a !== b ? b : null);
    const tags = diffTags(strings((r.was ?? r.now).sub_categories), strings(r.now.sub_categories));
    return {
      id,
      change: r.change,
      text: str(r.now.value),
      wasText: was ? differs(str(r.now.value), str(was.value)) : null,
      empty: r.now.is_null === true,
      share: (r.change === "removed" ? wasShare.get(id) : nowShare.get(id)) ?? 0,
      wasShare: r.change === "same" || r.change === "changed" ? wasShare.get(id) ?? null : null,
      weight: weightOf(r.now),
      wasWeight: was ? differs(weightOf(r.now), weightOf(was)) : null,
      tags: r.change === "changed" ? tags : tags.filter((t) => t.change !== "removed"),
      negative: str(r.now.negative),
      wasNegative: was ? differs(str(r.now.negative), str(was.negative)) : null,
      fallback: r.now.fallback === true,
      wasFallback: was ? differs(r.now.fallback === true, was.fallback === true) : null,
    };
  });
  const same = rows.filter((r) => r.change === "same").length;
  if (same === rows.length && !fields.length) return null;
  return { kind: "options", rows, same, before: before.length, after: after.length, fields };
}
