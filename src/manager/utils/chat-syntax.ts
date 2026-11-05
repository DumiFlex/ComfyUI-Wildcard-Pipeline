/**
 * Prompt syntax coloured the way the editors colour it, for any text the
 * chat shows: a reply, an option on a card, a rule's test, a fixed value.
 * `$variables` get their own hashed colour, `{a|b}` picks, `{2$$, $$…}`
 * multi-picks, `@{…}` references, `<lora:…>` / `embedding:` runs and
 * `#tags` each their class. Plain words stay plain strings.
 *
 * References are chips on cards; a chat reply passes `{ chips: false }` and
 * gets them as coloured `@{Name:filter}` text instead, so a reply that
 * explains the syntax doesn't fill with chips.
 */
import { h, type VNode } from "vue";
import { splitRefFilter, tokenizeRich } from "@/widgets/richTokenize";
import { varColorIndex } from "../../components/shared/var-color";
import "./chat-syntax.css";

/** `<lora:…>`, `embedding:…` and `#tags`: not tokenizer kinds, so split first. */
const EXTRA = /<lora:[^>\s]*>|embedding:[^\s,]+|(?<![\w&#/])#[A-Za-z][\w-]*/g;

/** What `syntaxNodes` may colour; a quick gate for plain text. */
const ANY = /[$@{}<#\\]|embedding:/;

/** A `@{id#Name:filter!null}` reference as a chip: the name, then the
 *  filter and the no-empty marker, with the raw reference on hover. */
function refChip(raw: string, name: string | undefined): VNode {
  const body = /^@\{[^}:]*:([^}]*)\}$/.exec(raw)?.[1];
  const filter = body === undefined ? null : splitRefFilter(body);
  const id = /^@\{([0-9a-f]{8})/.exec(raw)?.[1] ?? "";
  return h("span", { class: "wp-ai-syn__ref", title: raw }, [
    h("i", { class: "pi pi-sparkles", "aria-hidden": "true" }),
    h("span", null, name?.trim() || id),
    ...(filter?.expr ? [h("span", { class: "wp-ai-syn__ref-filter" }, filter.expr)] : []),
    ...(filter?.excludeNull ? [h("span", { class: "wp-ai-syn__ref-filter", title: "Never empty" }, "!∅")] : []),
  ]);
}

/** A reference as coloured text, by name: `@{Name:filter!null}`. */
function refText(raw: string, name: string | undefined): VNode {
  const tail = /^@\{[^}:!]*([:!][^}]*)?\}$/.exec(raw)?.[1] ?? "";
  const label = name?.trim() || (/^@\{([^}#:!]*)/.exec(raw)?.[1] ?? "");
  return h("span", { class: "wp-ai-syn__ref-text", title: raw }, `@{${label}${tail}}`);
}

/** `@{Name}` / `@{Name:filter}`, the way a card's preview names a ref
 *  (the tokenizer only takes the `@{id…}` form). */
const NAME_REF = /@\{([^}#:{]+?)(?::[^}]*)?\}/g;

type Ref = (raw: string, name: string | undefined) => VNode;

function nameRefs(text: string, ref: Ref): Array<VNode | string> {
  if (!text.includes("@{")) return [text];
  const out: Array<VNode | string> = [];
  let last = 0;
  for (const m of text.matchAll(NAME_REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(ref(m[0], m[1]));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Set when the workflow runs (the Loop, WP Model Info), never by an item:
 *  rules read them, nothing in the library writes them. Mirrors
 *  `engine/ai/library_vars.py::RUNTIME_VARS`. */
const RUN_VARS: Record<string, string> = {
  iteration: "the Loop", iteration_total: "the Loop",
  model_family: "WP Model Info", model_variant: "WP Model Info", model_name: "WP Model Info",
};

/** A `$name` the way the editors draw it: the name in its own colour, an
 *  accessor (`.0`, `.SHOES`) in the accessor amber, `.neg` in red. A
 *  variable the run sets is marked read-only. */
function varNode(raw: string, name: string): VNode {
  const head = `$${name}`;
  const tail = raw.startsWith(head) ? raw.slice(head.length) : "";
  const by = RUN_VARS[name];
  return h("span", {
    class: by ? "wp-ai-syn__var wp-ai-syn__var--run" : "wp-ai-syn__var",
    style: { color: `var(--wp-var-${varColorIndex(name)})` },
    title: by ? `Set by ${by} when the workflow runs: rules can read it, nothing writes it` : undefined,
  }, tail ? [raw.slice(0, head.length), h("span", {
    class: tail === ".neg" || tail.endsWith(".neg") ? "wp-ai-syn__acc wp-ai-syn__acc--neg" : "wp-ai-syn__acc",
  }, tail)] : raw);
}

function tokens(text: string, ref: Ref): Array<VNode | string> {
  const out: Array<VNode | string> = [];
  for (const t of tokenizeRich(text)) {
    switch (t.kind) {
      case "var": out.push(varNode(t.raw, t.meta?.name ?? "")); break;
      case "ref": out.push(ref(t.raw, t.meta?.name)); break;
      case "dp-brace": out.push(h("span", { class: "wp-ai-syn__pick" }, t.raw)); break;
      case "dp-multi": out.push(h("span", { class: "wp-ai-syn__multi" }, t.raw)); break;
      case "escape": out.push(h("span", { class: "wp-ai-syn__esc" }, t.raw)); break;
      default: out.push(...nameRefs(t.raw, ref));
    }
  }
  return out;
}

/** `text` as strings and coloured spans. */
export function syntaxNodes(text: string, opts: { chips?: boolean } = {}): Array<VNode | string> {
  if (!text) return [];
  if (!ANY.test(text)) return [text];
  const ref = opts.chips === false ? refText : refChip;
  const out: Array<VNode | string> = [];
  let last = 0;
  for (const m of text.matchAll(EXTRA)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...tokens(text.slice(last, at), ref));
    const raw = m[0];
    const cls = raw[0] === "#" ? "wp-ai-syn__tag" : raw[0] === "<" ? "wp-ai-syn__lora" : "wp-ai-syn__emb";
    out.push(h("span", { class: cls }, raw));
    last = at + raw.length;
  }
  if (last < text.length) out.push(...tokens(text.slice(last), ref));
  return out;
}
