import { defineComponent, h, type VNode } from "vue";
import { parseMarkdown, type Block, type Inline } from "../../manager/utils/chat-markdown";
import { parseTarget, readLinkAttrs, splitIcons, targetUrl } from "./note-format";

/**
 * The note body: Markdown through the chat parser, drawn with plain
 * elements (no v-html), plus the note syntax in note-format.ts: web and
 * docs links (opening in a new tab), `{button}` links and `:pi-name:` icons.
 * A link to anything but http(s) or docs: shows its text only.
 */
function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function text(v: string): (VNode | string)[] {
  return splitIcons(v).map((p) => (typeof p === "string"
    ? p
    : h("i", { class: ["pi", `pi-${p.icon}`, "wp-note-md__icon"], style: p.color ? { color: p.color } : undefined, "aria-hidden": "true" })));
}

function link(n: Extract<Inline, { t: "link" }>, button: boolean, icon: string): VNode {
  const target = parseTarget(n.href);
  const url = targetUrl(target, origin());
  if (!url) return h("span", { class: "wp-note-md__plain" }, inline(n.c));
  const external = { href: url, target: "_blank", rel: "noopener noreferrer", title: url, draggable: "false" };
  if (!button) return h("a", { class: "wp-note-md__link", ...external }, inline(n.c));
  return h("a", { class: "wp-note-md__btn", ...external }, [
    icon ? h("i", { class: ["pi", `pi-${icon}`], "aria-hidden": "true" }) : null,
    h("span", inline(n.c)),
    h("i", { class: "pi pi-arrow-up-right", "aria-hidden": "true" }),
  ]);
}

function inline(nodes: Inline[]): (VNode | string)[] {
  const out: (VNode | string)[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    switch (n.t) {
      case "text": out.push(...text(n.v)); break;
      case "b": out.push(h("strong", inline(n.c))); break;
      case "i": out.push(h("em", inline(n.c))); break;
      case "s": out.push(h("s", inline(n.c))); break;
      case "code": out.push(h("code", { class: "wp-note-md__code" }, n.v)); break;
      case "ref": out.push(h("span", n.v)); break;
      case "link": {
        // A `{button …}` right after the link is its attribute block.
        const next = nodes[i + 1];
        const attrs = next?.t === "text" ? readLinkAttrs(next.v) : null;
        out.push(link(n, !!attrs, attrs?.attrs.icon ?? ""));
        if (attrs && next?.t === "text") {
          const rest = next.v.slice(attrs.length);
          if (rest) out.push(...text(rest));
          i++;
        }
        break;
      }
    }
  }
  return out;
}

function block(b: Block): VNode {
  switch (b.t) {
    case "p": return h("p", inline(b.c));
    case "h": return h("p", { class: "wp-note-md__h" }, inline(b.c));
    case "list":
      return h(b.ordered ? "ol" : "ul", b.ordered && b.start !== 1 ? { start: b.start } : {},
        b.items.map((it) => h("li", it.blocks.map(block))));
    case "pre": return h("pre", { class: "wp-note-md__pre" }, b.v);
    case "quote": return h("blockquote", b.blocks.map(block));
    case "table":
      return h("table", [
        h("thead", [h("tr", b.head.map((c) => h("th", inline(c))))]),
        h("tbody", b.rows.map((r) => h("tr", r.map((c) => h("td", inline(c)))))),
      ]);
    case "hr": return h("hr");
  }
}

export default defineComponent({
  name: "NoteMarkdown",
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => h("div", { class: "wp-note-md" }, parseMarkdown(props.text).map(block));
  },
});
