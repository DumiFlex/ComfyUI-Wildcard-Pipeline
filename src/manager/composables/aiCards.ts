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
    return !options.some((o) => o.text && line.includes(o.text));
  });
}

/* ── Card views by kind ─────────────────────────────────────────────────
 * A create card shows what it makes the way its editor would, not as a
 * list of lines: a constraint's rules as source → target rows, a
 * derivation's rules as IF / ELIF / ELSE, fixed values as a table, a
 * combine or template as its text. Edits keep their before → after lines. */

export interface ConstraintRowView { from: string; to: string; byTag: boolean; effect: string; factor: number | null }
export interface BranchView { key: "IF" | "ELIF" | "ELSE"; test: string; actions: string[] }
export type CardView =
  | { kind: "constraint"; source: string; target: string; reach: string; rows: ConstraintRowView[] }
  | { kind: "derivation"; rules: BranchView[][] }
  | { kind: "values"; rows: Array<{ name: string; value: string; negative: string }> }
  | { kind: "text"; rows: Array<{ label: string; text: string }> };

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

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

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
export function cardView(p: AiChatProposal): CardView | null {
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
