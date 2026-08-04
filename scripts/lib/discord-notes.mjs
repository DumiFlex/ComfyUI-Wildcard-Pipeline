/**
 * Release notes → Discord message.
 *
 * The announcement is DERIVED, never authored. `docs/release-notes/next.md` is
 * already written by hand for every release and already is the GitHub release
 * body — so the only reason a Discord post was a separate chore is that nothing
 * transformed one into the other. Nothing here asks for new prose.
 *
 * Discord is not a markdown renderer in the way GitHub is, and the gaps are
 * specific rather than general:
 *
 *   - Masked links `[text](url)` render ONLY inside an embed. In plain message
 *     content they show as literal brackets, which is why the notes go in an
 *     embed and the message content stays a bare ping.
 *   - There are no tables. A pipe table degrades into unreadable pipes.
 *   - `<details>` is HTML; it shows as raw tags.
 *   - Embed description caps at 4096 characters, and the whole payload at 6000.
 */

/** Everything below this marker is the long tail; the SPA modal cuts here too. */
const MODAL_CUT = /<!--\s*\/modal\s*-->/i;

/** Discord's hard cap on a single embed description. */
export const EMBED_DESCRIPTION_LIMIT = 4096;

/** Accent purple, matching `--wp-accent-500` in the manager. */
export const BRAND_COLOR = 0x8b5cf6;

/**
 * Who the post appears to be from.
 *
 * A webhook posts under whatever name and avatar it was created with — the
 * Discord default is a generic name like "Captain Hook" and a placeholder
 * image, which is what an announcement went out as. `username` and
 * `avatar_url` override that PER MESSAGE, so the identity lives here rather
 * than in a webhook's settings: it stays right if the webhook is ever rotated
 * or recreated, and it is the same in every channel the automation posts to.
 */
export const WEBHOOK_USERNAME = "Wildcard Pipeline";

/**
 * Discord fetches this server-side, so it has to be a public raster URL — an
 * SVG will not render, which rules out the repo's `favicon.svg`. Pinned to
 * `main` rather than a tag so replacing the logo does not need a code change.
 */
export const WEBHOOK_AVATAR_URL =
  "https://raw.githubusercontent.com/DumiFlex/ComfyUI-Wildcard-Pipeline/main/public/images/web-app-manifest-512x512.png";

/** Where the manual "publish to the public channel" run is started. */
export const DISPATCH_URL =
  "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/actions/workflows/discord-announce.yml";

/**
 * Split a release body into the part worth announcing and what is left behind.
 *
 * The cut is the same one the in-app update dialog makes, for the same reason:
 * an announcement is an interruption and should stay short. The tail is not
 * discarded silently — `tailCount` lets the message say how much it is not
 * showing, so a big release does not read as a small one.
 */
export function splitBody(md) {
  const at = String(md ?? "").search(MODAL_CUT);
  if (at === -1) return { head: String(md ?? ""), tail: "", tailCount: 0 };
  const head = md.slice(0, at);
  // Count against comment-stripped text, NOT details-stripped text. The
  // "Also in this release" bullets live INSIDE the <details> block, so
  // stripping it first counts nothing real — while the authoring guidance in
  // the trailing HTML comment contains bullets of its own that must not be
  // counted. Getting this backwards reported a 26-change release as 3.
  const tail = stripComments(md.slice(at));
  const tailCount = (tail.match(/^\s*[-*]\s+\S/gm) ?? []).length;
  return { head, tail, tailCount };
}

function stripDetails(md) {
  return md.replace(/<details[\s\S]*?<\/details>/gi, "");
}

function stripComments(md) {
  return md.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Drop the header block the GitHub template prepends.
 *
 * It is a row of links to the wiki, Discord and the issue tracker. On Discord
 * the Discord link is noise, and the rest belong in the embed's own fields
 * rather than buried in the body.
 */
function stripTemplateHeader(md) {
  return md
    .replace(/^\s*##\s*🎉[^\n]*\n/, "")
    .replace(/^\s*(?:📖|💬|📦|🐛)[^\n]*\n/gm, "");
}

/** Pipe tables have no Discord equivalent; each row becomes a bullet. */
function tablesToBullets(md) {
  const lines = md.split("\n");
  const out = [];
  for (const line of lines) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) { out.push(line); continue; }
    // Separator row (|---|---|) carries no content.
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
    const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
    if (!cells.some(Boolean)) continue;
    out.push(`- ${cells.filter(Boolean).join(" — ")}`);
  }
  return out.join("\n");
}

/**
 * Headings become bold lines.
 *
 * Discord does render `#`-style headings now, but at sizes chosen for chat
 * rather than for a dense embed — an `##` inside an embed is larger than the
 * embed title above it. Bold keeps the hierarchy legible without competing.
 */
function headingsToBold(md) {
  return md.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_m, text) => `**${text.trim()}**`);
}

/** Horizontal rules have no embed equivalent and read as stray dashes. */
function stripRules(md) {
  return md.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");
}

/** Collapse the blank lines the earlier passes leave behind. */
function tidy(md) {
  return md.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
}

/**
 * Truncate at a bullet boundary rather than mid-sentence.
 *
 * A hard slice at 4096 can cut inside a link or a bold run, which Discord then
 * renders as broken markup — worse than saying less.
 */
export function clampToLimit(text, limit = EMBED_DESCRIPTION_LIMIT, suffix = "\n\n…") {
  if (text.length <= limit) return text;
  const room = limit - suffix.length;
  const slice = text.slice(0, room);
  const cut = Math.max(slice.lastIndexOf("\n- "), slice.lastIndexOf("\n\n"));
  return (cut > room * 0.5 ? slice.slice(0, cut) : slice).trimEnd() + suffix;
}

/** Full markdown → Discord-embed markdown. */
export function toDiscordMarkdown(md) {
  return tidy(
    stripRules(
      headingsToBold(
        tablesToBullets(
          stripTemplateHeader(stripComments(stripDetails(String(md ?? "")))),
        ),
      ),
    ),
  );
}

/**
 * Build the description for one release.
 *
 * `tailCount` is appended rather than dropped: a release whose highlights are
 * three bullets and whose tail is forty changes should not look like a quiet
 * week.
 */
export function buildDescription(body, { compareUrl } = {}) {
  const { head, tailCount } = splitBody(body);
  let out = toDiscordMarkdown(head);
  if (tailCount > 0) {
    const line = `*…plus ${tailCount} smaller change${tailCount === 1 ? "" : "s"}*`;
    out += `\n\n${compareUrl ? `[${line.slice(1, -1)}](${compareUrl})` : line}`;
  }
  return clampToLimit(out);
}

/**
 * One release → a Discord webhook payload.
 *
 * `allowed_mentions` is always explicit. A webhook with no restriction will
 * happily resolve an `@everyone` that happened to appear in release notes, and
 * the notes are not written with that in mind.
 */
export function buildPayload({
  version,
  body,
  releaseUrl,
  compareUrl,
  roleId,
  username = WEBHOOK_USERNAME,
  avatarUrl = WEBHOOK_AVATAR_URL,
  channel = "staff",
  installHint = 'ComfyUI Manager → search "Wildcard Pipeline" → Update → restart ComfyUI',
}) {
  const description = buildDescription(body, { compareUrl });
  return {
    username,
    avatar_url: avatarUrl,
    content: roleId ? `<@&${roleId}>` : "",
    allowed_mentions: { parse: [], roles: roleId ? [roleId] : [] },
    embeds: [
      {
        title: `Wildcard Pipeline ${version}`,
        url: releaseUrl || undefined,
        description,
        color: BRAND_COLOR,
        fields: reviewFields(channel),
        footer: { text: installHint },
      },
    ],
  };
}

/**
 * The staff copy carries its own publish button; the public copy does not.
 *
 * This is what makes the staff channel a review step rather than a duplicate
 * feed: the post you are reading is the post that will go out, and the link to
 * send it is attached to it. Without that, "go and publish it" is a separate
 * instruction living in someone's head.
 *
 * Returned as `undefined` for the public channel rather than an empty array —
 * Discord rejects `fields: []` on some client versions, and an empty field
 * block would render as dead space in the announcement everyone sees.
 */
function reviewFields(channel) {
  if (channel !== "staff") return undefined;
  return [
    {
      name: "Ready to go public?",
      value:
        `[Run the workflow](${DISPATCH_URL}) with **channel: public** and ` +
        "**dry_run: false** to post this to the announcement channel.",
    },
  ];
}

/**
 * Several releases → one catch-up payload.
 *
 * For the case that actually happens: announcements skipped for a few versions,
 * then one post covering the gap. Each release keeps its own heading so readers
 * can tell which version brought what, and the newest goes first because that is
 * the one people are deciding whether to install.
 *
 * `releases` is newest-first: `{ version, body }`.
 */
export function buildRollupPayload({
  releases, sinceVersion, releaseUrl, roleId, installHint, username, avatarUrl,
  channel = "staff",
}) {
  const latest = releases[0];
  const sections = releases.map((r) => {
    const { head } = splitBody(r.body);
    const text = toDiscordMarkdown(head);
    return `**${r.version}**\n${text}`;
  });
  const joined = sections.join("\n\n");
  const base = buildPayload({
    version: latest?.version ?? "",
    body: "",
    releaseUrl,
    roleId,
    installHint,
    username,
    avatarUrl,
    channel,
  });
  base.embeds[0].title = sinceVersion
    ? `Wildcard Pipeline ${latest?.version ?? ""} — everything since ${sinceVersion}`
    : `Wildcard Pipeline ${latest?.version ?? ""}`;
  base.embeds[0].description = clampToLimit(joined);
  return base;
}
