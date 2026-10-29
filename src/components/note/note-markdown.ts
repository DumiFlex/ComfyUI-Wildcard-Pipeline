import { defineComponent, h, type VNode } from "vue";
import { parseMarkdown, type Block, type Inline } from "../../manager/utils/chat-markdown";

/**
 * The note body: Markdown through the chat parser, drawn with plain
 * elements (no v-html). Links show their text only, like in the chat.
 * `$variables` in code spans keep the mono look.
 */
function inline(nodes: Inline[]): (VNode | string)[] {
  return nodes.map((n) => {
    switch (n.t) {
      case "text": return n.v;
      case "b": return h("strong", inline(n.c));
      case "i": return h("em", inline(n.c));
      case "s": return h("s", inline(n.c));
      case "code": return h("code", { class: "wp-note-md__code" }, n.v);
      case "ref": return h("span", n.v);
      case "link": return h("span", { class: "wp-note-md__link", title: n.href }, inline(n.c));
    }
  });
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
