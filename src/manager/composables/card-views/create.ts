/**
 * Create cards: what the card makes, the way its editor shows it. A
 * constraint's rules as source → target rows, a derivation's rules as
 * IF / ELIF / ELSE, fixed values as a table, a combine or template as its
 * text. (A new wildcard's options are the card's tick list, not a view.)
 */
import type { AiChatProposal } from "../../api/types";
import type { BranchView, CardView, ConstraintRowView } from "./types";
import { isObj, str, type Obj } from "./util";

const OPS: Record<string, string> = {
  equals: "is", not_equals: "is not", contains: "contains", not_contains: "does not contain",
  matches: "matches", not_matches: "does not match", exists: "exists",
  not_exists: "does not exist", is_set: "has a value", is_unset: "has no value",
  is_empty: "is empty", is_not_empty: "has a value",
};
const NO_VALUE = new Set(["exists", "not_exists", "is_set", "is_unset", "is_empty", "is_not_empty"]);
const MODES: Record<string, string> = {
  replace: "set", append: "add after", prepend: "add before",
  negative: "add to the negative of", negative_replace: "replace the negative of",
};

/** One condition (or nested group) as words: `$class is "mage" and ($a or $b)`. */
export function testText(c: unknown, top = true): string {
  if (!isObj(c)) return "";
  if (Array.isArray(c.conditions)) {
    const join = c.match === "any" ? " or " : " and ";
    const inner = c.conditions.map((x) => testText(x, false)).filter(Boolean).join(join);
    return top ? inner : `(${inner})`;
  }
  const op = str(c.op);
  const head = `$${str(c.var)} ${OPS[op] ?? op}`;
  return NO_VALUE.has(op) ? head : `${head} "${str(c.value)}"`;
}

function actionText(a: unknown): string {
  if (!isObj(a)) return "";
  const mode = str(a.mode) || "replace";
  const target = `$${str(a.target_var)}`;
  const value = `"${str(a.value)}"`;
  if (mode === "replace") return `set ${target} to ${value}`;
  if (mode === "append" || mode === "prepend") return `${MODES[mode]} ${target}: ${value}`;
  return `${MODES[mode] ?? mode} ${target}: ${value}`;
}

function clause(c: unknown): string[] {
  if (!isObj(c)) return [];
  const extra = Array.isArray(c.extra_actions) ? c.extra_actions : [];
  return [c.action, ...extra].map(actionText).filter(Boolean);
}

function reachText(sel: unknown): string {
  if (!isObj(sel)) return "";
  const mode = str(sel.mode);
  if (mode === "first") return "the first one after it";
  if (mode === "next") return `the next ${typeof sel.count === "number" ? sel.count : 1}`;
  if (mode === "pick") return "picked uses";
  return "";
}

/** How a create card shows what it makes, or null for the plain lines. */
export function createView(p: AiChatProposal): CardView | null {
  const op = p.op;
  if (op.op !== "create") return null;
  const body = op.body as unknown as Obj;
  const payload = isObj(body.payload) ? body.payload : null;
  const type = op.kind === "module" ? str(body.type) : op.kind;
  const names = p.names ?? {};
  if (type === "constraint" && payload) {
    const rows: ConstraintRowView[] = [];
    const matrix = isObj(payload.matrix) ? payload.matrix : {};
    for (const [from, cells] of Object.entries(matrix)) {
      if (!isObj(cells)) continue;
      for (const [to, cell] of Object.entries(cells)) {
        if (!isObj(cell)) continue;
        rows.push({ from: `#${from}`, to: `#${to}`, byTag: true, effect: str(cell.mode),
          factor: typeof cell.factor === "number" ? cell.factor : null });
      }
    }
    for (const e of Array.isArray(payload.exceptions) ? payload.exceptions : []) {
      if (!isObj(e)) continue;
      rows.push({ from: str(e.source), to: str(e.target), byTag: false, effect: str(e.mode),
        factor: typeof e.factor === "number" ? e.factor : null });
    }
    const src = str(payload.source_wildcard_id);
    const tgt = str(payload.target_wildcard_id);
    return { kind: "constraint", source: names[src] || src, target: names[tgt] || tgt,
      reach: reachText(payload.target_select), rows };
  }
  if (type === "derivation" && payload) {
    const rules = (Array.isArray(payload.rules) ? payload.rules : []).filter(isObj).map((r) => {
      const out: BranchView[] = (Array.isArray(r.branches) ? r.branches : []).filter(isObj)
        .map((b, i) => ({ key: i === 0 ? "IF" as const : "ELIF" as const, test: testText(b.condition), actions: clause(b) }));
      if (isObj(r.else)) out.push({ key: "ELSE", test: "", actions: clause(r.else) });
      return out;
    });
    return { kind: "derivation", rules };
  }
  if (type === "fixed_values" && payload) {
    const rows = (Array.isArray(payload.values) ? payload.values : []).filter(isObj)
      .map((v) => ({ name: str(v.name), value: str(v.value), negative: str(v.negative) }));
    return { kind: "values", rows };
  }
  if (type === "combine" && payload) {
    const rows = [{ label: `$${str(payload.output_var)} =`, text: str(payload.template) }];
    if (str(payload.negative)) rows.push({ label: "Negative", text: str(payload.negative) });
    return { kind: "text", rows };
  }
  if (type === "template") {
    const rows = [{ label: "Prompt", text: str(body.template_string) }];
    if (str(body.negative_template)) rows.push({ label: "Negative", text: str(body.negative_template) });
    return { kind: "text", rows };
  }
  return null;
}
