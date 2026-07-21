/**
 * Minimal, safe Markdown → HTML for GitHub release notes.
 *
 * Deliberately NOT a general markdown engine — we avoid a `marked`
 * dependency to keep the manager bundle within the size gate. It supports
 * the subset GitHub release bodies actually use: ATX headings (#..###),
 * `-`/`*` bullet lists, **bold**, `inline code`, fenced ```code``` blocks,
 * and [text](url) links.
 *
 * Safety model: EVERY line is HTML-escaped FIRST, then a small set of
 * transforms re-introduce a whitelisted tag set on the already-escaped
 * text. Raw HTML in the source therefore renders as inert text; the only
 * tags in the output are the ones this function emits. The result is the
 * sole sanctioned input to a `v-html` (the `.wpc-relnotes` container).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Inline transforms applied to an already-escaped line. */
function renderInline(escaped: string): string {
  // Links: [text](url). `url` is validated to http(s) only; because the
  // whole line is pre-escaped, a `"` in the source is already `&quot;`,
  // so it cannot terminate the href attribute.
  let out = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener nofollow">${text}</a>`,
  );
  // Inline code (before bold so ** inside code isn't bolded).
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold.
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

/**
 * Normalize the small set of HTML tags that GitHub release bodies use —
 * `<details>`/`<summary>` collapsibles and `<b>` — into markdown BEFORE the
 * escape pass, so they render instead of appearing as literal `<details>`
 * text. Everything else still falls through to escaping (rendered inert), so
 * this stays safe: it only recognises a fixed allow-list of formatting tags.
 */
function normalizeReleaseHtml(md: string): string {
  return md
    // <summary>…</summary> → a bold lead line (drop any inner tags).
    .replace(/<summary>([\s\S]*?)<\/summary>/gi, (_m, s: string) =>
      `**${s.replace(/<\/?[a-z][^>]*>/gi, "").trim()}**\n`)
    // Drop the <details> wrapper markers — the content flows inline.
    .replace(/<\/?details[^>]*>/gi, "")
    // Bold.
    .replace(/<\/?(?:b|strong)>/gi, "**");
}

export function renderReleaseNotes(md: string): string {
  if (!md || !md.trim()) {
    return '<p class="wpc-relnotes__empty">No release notes.</p>';
  }
  const lines = normalizeReleaseHtml(md).replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  const codeBuf: string[] = [];

  const closeList = () => { if (inList) { html.push("</ul>"); inList = false; } };

  for (const rawLine of lines) {
    // Fenced code toggles.
    if (/^```/.test(rawLine.trim())) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf.length = 0;
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(rawLine); continue; }

    const line = rawLine.trimEnd();
    const escaped = escapeHtml(line);

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${renderInline(escapeHtml(bullet[1]))}</li>`);
      continue;
    }

    if (line.trim() === "") { closeList(); continue; }

    closeList();
    html.push(`<p>${renderInline(escaped)}</p>`);
  }
  if (inCode) { html.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`); }
  closeList();
  return html.join("\n");
}
