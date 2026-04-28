/**
 * Tiny markdown-ish renderer used by the Community detail README tab.
 *
 * The Community tab is mock-only and we don't ship `marked`, so this
 * mirrors the renderer the React prototype uses (community-data.jsx).
 * Handles: H1/H2, lists, **bold**, `code`, and naive @mention coloring.
 *
 * Output is escaped before any inline rule runs, so the only HTML that
 * ever leaves this function is what we generate ourselves.
 */
export function renderMarkdown(src: string): string {
  const lines = String(src ?? "").split("\n");
  const out: string[] = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  const inline = (text: string): string =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/(\B@[a-z0-9_.\-]+)/gi, '<span class="wp-mention">$1</span>');

  for (const ln of lines) {
    if (/^# /.test(ln))   { flushList(); out.push(`<h2>${inline(ln.slice(2))}</h2>`); continue; }
    if (/^## /.test(ln))  { flushList(); out.push(`<h3>${inline(ln.slice(3))}</h3>`); continue; }
    if (/^- /.test(ln))   {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(ln.slice(2))}</li>`);
      continue;
    }
    if (!ln.trim()) { flushList(); out.push('<p class="wp-md-spacer"></p>'); continue; }
    flushList();
    out.push(`<p>${inline(ln)}</p>`);
  }
  flushList();
  return out.join("");
}
