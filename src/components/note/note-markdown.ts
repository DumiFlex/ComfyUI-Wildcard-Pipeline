import { defineComponent, h, type VNode } from "vue";
import { parseMarkdown, type Align, type Block, type Inline, type ListItem } from "../../manager/utils/chat-markdown";
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

function link(n: Extract<Inline, { t: "link" }>, button: boolean, icon: string, color: string): VNode {
  const target = parseTarget(n.href);
  const url = targetUrl(target, origin());
  if (!url) return h("span", { class: "wp-note-md__plain" }, inline(n.c));
  // Its own colour, or the note's tone (the CSS falls back to it).
  const style = color ? { "--wp-note-link": color } : undefined;
  const external = { href: url, target: "_blank", rel: "noopener noreferrer", title: url, draggable: "false", style };
  if (!button) return h("a", { class: ["wp-note-md__link", { "wp-note-md__link--color": !!color }], ...external }, inline(n.c));
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
        // A `{button …}` / `{#hex}` right after the link is its attribute block.
        const next = nodes[i + 1];
        const attrs = next?.t === "text" ? readLinkAttrs(next.v) : null;
        out.push(link(n, !!attrs?.attrs.button, attrs?.attrs.icon ?? "", attrs?.attrs.color ?? ""));
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

function cellStyle(align: Align): Record<string, string> | undefined {
  return align ? { textAlign: align } : undefined;
}

function item(it: ListItem): VNode {
  if (it.task === null) return h("li", it.blocks.map(block));
  // A task: a read-only box (an icon, not an input: the note is read-only).
  return h("li", { class: ["wp-note-md__task", { "wp-note-md__task--done": it.task }] }, [
    h("i", { class: ["pi", it.task ? "pi-check-square" : "pi-stop", "wp-note-md__box"], "aria-hidden": "true" }),
    h("span", { class: "wp-note-md__sr" }, it.task ? "Done: " : "To do: "),
    ...it.blocks.map(block),
  ]);
}

function block(b: Block): VNode {
  switch (b.t) {
    case "p": return h("p", inline(b.c));
    case "h": return h("p", { class: ["wp-note-md__h", `wp-note-md__h--${Math.min(b.level, 4)}`], role: "heading", "aria-level": b.level }, inline(b.c));
    case "list":
      return h(b.ordered ? "ol" : "ul", {
        class: { "wp-note-md__tasks": b.items.some((it) => it.task !== null) },
        ...(b.ordered && b.start !== 1 ? { start: b.start } : {}),
      }, b.items.map(item));
    case "pre": return h("pre", { class: "wp-note-md__pre", "data-lang": b.lang || undefined }, b.v);
    case "quote":
      return h("blockquote", { class: b.tone ? ["wp-note-md__callout", `wp-note-md__callout--${b.tone}`] : undefined }, [
        b.tone ? h("i", { class: ["pi", b.tone === "warn" ? "pi-exclamation-triangle" : "pi-info-circle", "wp-note-md__callout-icon"], "aria-hidden": "true" }) : null,
        h("div", b.blocks.map(block)),
      ]);
    case "table":
      // Fits the note's width and wraps its cells (the note lets the
      // pointer through to the canvas, so it can't scroll sideways).
      return h("div", { class: "wp-note-md__table" }, [
        h("table", [
          h("thead", [h("tr", b.head.map((c, i) => h("th", { style: cellStyle(b.align[i] ?? null) }, inline(c))))]),
          h("tbody", b.rows.map((r) => h("tr", r.map((c, i) => h("td", { style: cellStyle(b.align[i] ?? null) }, inline(c)))))),
        ]),
      ]);
    case "hr": return h("hr", { class: "wp-note-md__hr" });
  }
}

export default defineComponent({
  name: "NoteMarkdown",
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => h("div", { class: "wp-note-md" }, parseMarkdown(props.text).map(block));
  },
});
