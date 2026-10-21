/**
 * Prompt syntax coloured the way the editors colour it, for any text the
 * chat shows: a reply, an option on a card, a rule's test, a fixed value.
 * `$variables` get their own hashed colour, `{a|b}` picks, `{2$$, $$…}`
 * multi-picks, `@{…}` references, `<lora:…>` / `embedding:` runs and
 * `#tags` each their class. Plain words stay plain strings.
 */
import { h, type VNode } from "vue";
import { tokenizeRich } from "@/widgets/richTokenize";
import { varColorIndex } from "../../components/shared/var-color";
import "./chat-syntax.css";

/** `<lora:…>`, `embedding:…` and `#tags`: not tokenizer kinds, so split first. */
const EXTRA = /<lora:[^>\s]*>|embedding:[^\s,]+|(?<![\w&#/])#[A-Za-z][\w-]*/g;

/** What `syntaxNodes` may colour; a quick gate for plain text. */
const ANY = /[$@{}<#\\]|embedding:/;

function tokens(text: string): Array<VNode | string> {
  const out: Array<VNode | string> = [];
  for (const t of tokenizeRich(text)) {
    switch (t.kind) {
      case "var":
        out.push(h("span", {
          class: "wp-ai-syn__var", style: { color: `var(--wp-var-${varColorIndex(t.meta?.name ?? "")})` },
        }, t.raw));
        break;
      case "ref": out.push(h("span", { class: "wp-ai-syn__ref" }, t.raw)); break;
      case "dp-brace": out.push(h("span", { class: "wp-ai-syn__pick" }, t.raw)); break;
      case "dp-multi": out.push(h("span", { class: "wp-ai-syn__multi" }, t.raw)); break;
      case "escape": out.push(h("span", { class: "wp-ai-syn__esc" }, t.raw)); break;
      default: out.push(t.raw);
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
