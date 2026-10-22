/**
 * Prompt syntax coloured the way the editors colour it, for any text the
 * chat shows: a reply, an option on a card, a rule's test, a fixed value.
 * `$variables` get their own hashed colour, `{a|b}` picks, `{2$$, $$…}`
 * multi-picks, `@{…}` references, `<lora:…>` / `embedding:` runs and
 * `#tags` each their class. Plain words stay plain strings.
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

/** `@{Name}` / `@{Name:filter}`, the way a card's preview names a ref
 *  (the tokenizer only takes the `@{id…}` form). */
const NAME_REF = /@\{([^}#:{]+?)(?::[^}]*)?\}/g;

function nameRefs(text: string): Array<VNode | string> {
  if (!text.includes("@{")) return [text];
  const out: Array<VNode | string> = [];
  let last = 0;
  for (const m of text.matchAll(NAME_REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(refChip(m[0], m[1]));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function tokens(text: string): Array<VNode | string> {
  const out: Array<VNode | string> = [];
  for (const t of tokenizeRich(text)) {
    switch (t.kind) {
      case "var":
        out.push(h("span", {
          class: "wp-ai-syn__var", style: { color: `var(--wp-var-${varColorIndex(t.meta?.name ?? "")})` },
        }, t.raw));
        break;
      case "ref": out.push(refChip(t.raw, t.meta?.name)); break;
      case "dp-brace": out.push(h("span", { class: "wp-ai-syn__pick" }, t.raw)); break;
      case "dp-multi": out.push(h("span", { class: "wp-ai-syn__multi" }, t.raw)); break;
      case "escape": out.push(h("span", { class: "wp-ai-syn__esc" }, t.raw)); break;
      default: out.push(...nameRefs(t.raw));
    }
  }
  return out;
}

/** `text` as strings and coloured spans. */
export function syntaxNodes(text: string): Array<VNode | string> {
  if (!text) return [];
  if (!ANY.test(text)) return [text];
  const out: Array<VNode | string> = [];
  let last = 0;
  for (const m of text.matchAll(EXTRA)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...tokens(text.slice(last, at)));
    const raw = m[0];
    const cls = raw[0] === "#" ? "wp-ai-syn__tag" : raw[0] === "<" ? "wp-ai-syn__lora" : "wp-ai-syn__emb";
    out.push(h("span", { class: cls }, raw));
    last = at + raw.length;
  }
  if (last < text.length) out.push(...tokens(text.slice(last)));
  return out;
}
