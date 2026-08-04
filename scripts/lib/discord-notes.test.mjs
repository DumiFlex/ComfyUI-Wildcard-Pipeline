import { describe, it, expect } from "vitest";
import {
  DISPATCH_URL,
  normalizeRoleId,
  splitBody,
  toDiscordMarkdown,
  buildDescription,
  buildPayload,
  buildRollupPayload,
  clampToLimit,
  EMBED_DESCRIPTION_LIMIT,
} from "./discord-notes.mjs";

/**
 * The announcement is derived from notes that already exist, so the risk is not
 * "does it write good copy" — it is "does it mangle copy that was already
 * fine". Most of these pin a Discord-specific rendering gap.
 */

const REAL_SHAPE = `## 🎉 Wildcard Pipeline v2.11.0

📖 [Docs (wiki)](https://x/wiki) · 💬 [Discord](https://discord.gg/x) · 📦 [Install](https://x/q) · 🐛 [Issues](https://x/i)

### ✨ What's new

A correctness fix for held modules, plus tools for reconnecting workflow items.

- **Held modules stay held.** A module set to **Hold across run** could re-roll.
- **Search by id.** Pasting an 8-character id now finds the item.

<!-- /modal -->

### Also in this release

- Wire collapse survives a live renderer switch
- Modal keystrokes no longer escape

---

**Full changelog:** [v2.10.2…v2.11.0](https://x/compare)
`;

describe("splitBody", () => {
  it("cuts at the modal marker and counts what is left behind", () => {
    const { head, tailCount } = splitBody(REAL_SHAPE);
    expect(head).toContain("Held modules stay held");
    expect(head).not.toContain("Also in this release");
    expect(tailCount).toBe(2);
  });

  it("treats a body with no marker as all highlights", () => {
    const { head, tailCount } = splitBody("- one\n- two");
    expect(head).toBe("- one\n- two");
    expect(tailCount).toBe(0);
  });

  it("survives an empty or missing body", () => {
    expect(splitBody("").head).toBe("");
    expect(splitBody(undefined).head).toBe("");
  });
});

describe("toDiscordMarkdown", () => {
  it("drops the GitHub template header — the Discord link is noise on Discord", () => {
    const out = toDiscordMarkdown(REAL_SHAPE);
    expect(out).not.toContain("🎉 Wildcard Pipeline");
    expect(out).not.toContain("discord.gg");
    expect(out).not.toContain("Docs (wiki)");
  });

  it("keeps masked links, which DO render inside an embed", () => {
    expect(toDiscordMarkdown("see [the docs](https://x/d)")).toContain("[the docs](https://x/d)");
  });

  it("turns headings into bold — an embed h2 outsizes the embed title", () => {
    const out = toDiscordMarkdown("### What's new\nbody");
    expect(out).toContain("**What's new**");
    expect(out).not.toMatch(/^#/m);
  });

  it("converts tables to bullets, since Discord has none", () => {
    const out = toDiscordMarkdown("| Item | Result |\n| --- | --- |\n| #29 | shipped |");
    expect(out).toContain("- Item — Result");
    expect(out).toContain("- #29 — shipped");
    expect(out).not.toContain("|");
  });

  it("strips <details>, which renders as raw tags", () => {
    const out = toDiscordMarkdown("keep\n<details><summary>x</summary>\n- hidden\n</details>");
    expect(out).toContain("keep");
    expect(out).not.toContain("hidden");
    expect(out).not.toContain("<details>");
  });

  it("strips HTML comments and horizontal rules", () => {
    const out = toDiscordMarkdown("a\n\n<!-- note -->\n\n---\n\nb");
    expect(out).not.toContain("note");
    expect(out).not.toMatch(/^-{3,}$/m);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("leaves bold, italics and bullets alone", () => {
    const out = toDiscordMarkdown("- **bold** and *italic* and `code`");
    expect(out).toBe("- **bold** and *italic* and `code`");
  });
});

describe("buildDescription", () => {
  // A three-bullet highlights section over a forty-change release should not
  // read as a quiet week.
  it("says how much it is not showing", () => {
    const out = buildDescription(REAL_SHAPE);
    expect(out).toMatch(/plus 2 smaller changes/);
  });

  it("links the tail to the compare view when there is one", () => {
    const out = buildDescription(REAL_SHAPE, { compareUrl: "https://x/compare" });
    expect(out).toContain("](https://x/compare)");
  });

  // The "Also in this release" bullets live INSIDE a <details> block, and the
  // file ends with an authoring comment that contains bullets of its own.
  // Stripping details before counting reported a real 26-change release as 3.
  it("counts the bullets inside <details>, and ignores those in comments", () => {
    const body = [
      "- highlight",
      "<!-- /modal -->",
      "<details><summary>Also in this release — 3 smaller changes</summary>",
      "- one",
      "- two",
      "- three",
      "</details>",
      "<!--",
      "  - not a change, this is authoring guidance",
      "  - nor is this",
      "-->",
    ].join("\n");
    expect(splitBody(body).tailCount).toBe(3);
    expect(buildDescription(body)).toMatch(/plus 3 smaller changes/);
  });

  it("says nothing about a tail that does not exist", () => {
    expect(buildDescription("- only this")).not.toMatch(/smaller change/);
  });

  it("uses the singular for one", () => {
    expect(buildDescription("- a\n<!-- /modal -->\n- b")).toMatch(/1 smaller change\b/);
  });
});

describe("clampToLimit", () => {
  it("leaves anything under the cap untouched", () => {
    expect(clampToLimit("short")).toBe("short");
  });

  // A hard slice can land inside a link or a bold run, which Discord then
  // renders as broken markup — worse than saying less.
  it("cuts at a bullet boundary, not mid-markup", () => {
    const body = Array.from({ length: 400 }, (_, i) => `- item ${i} with some text`).join("\n");
    const out = clampToLimit(body);
    expect(out.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
    expect(out.endsWith("…")).toBe(true);
    expect(out.split("\n").at(-3)).toMatch(/^- item \d+ with some text$/);
  });
});

describe("buildPayload", () => {
  it("puts the notes in an embed, because masked links need one", () => {
    const p = buildPayload({ version: "v2.12.0", body: REAL_SHAPE, releaseUrl: "https://x/r" });
    expect(p.embeds).toHaveLength(1);
    expect(p.embeds[0].title).toBe("Wildcard Pipeline v2.12.0");
    expect(p.embeds[0].url).toBe("https://x/r");
    expect(p.embeds[0].footer.text).toMatch(/ComfyUI Manager/);
  });

  // Release notes are not written with @everyone in mind, and a webhook will
  // happily resolve one that slipped in.
  it("never lets the notes mention anyone by accident", () => {
    const p = buildPayload({ version: "v1", body: "ping @everyone please" });
    expect(p.allowed_mentions.parse).toEqual([]);
    expect(p.allowed_mentions.roles).toEqual([]);
  });

  /**
   * An unset secret was always safe. A MALFORMED one was not: any truthy string
   * went straight into `<@&…>`, so a stray space produced a literal `<@&   >`
   * at the top of the most public message the project sends.
   */
  describe("role ping", () => {
    const content = (roleId) => buildPayload({ version: "v1", body: "x", roleId }).content;

    it("stays silent for every flavour of absent", () => {
      expect(content(undefined)).toBe("");
      expect(content(null)).toBe("");
      expect(content("")).toBe("");
      expect(content("   ")).toBe("");
    });

    it("refuses anything that is not a snowflake, rather than guessing", () => {
      expect(content("not-an-id")).toBe("");
      expect(content("12345")).toBe("");          // too short
      expect(content("1234567890123456789012")).toBe(""); // too long
      expect(content("123abc456def78901")).toBe("");
    });

    it("never emits a half-formed mention", () => {
      for (const bad of ["   ", "not-an-id", "<@&>", "@everyone"]) {
        expect(content(bad)).not.toContain("<@&");
      }
    });

    // "Copy ID" and copying the mention text are equally easy mistakes.
    it("accepts a pasted mention as well as a bare id", () => {
      expect(content("123456789012345678")).toBe("<@&123456789012345678>");
      expect(content("<@&123456789012345678>")).toBe("<@&123456789012345678>");
      expect(content(" 123456789012345678 ")).toBe("<@&123456789012345678>");
    });

    it("keeps allowed_mentions in step with the content", () => {
      const bad = buildPayload({ version: "v1", body: "x", roleId: "junk" });
      expect(bad.allowed_mentions.roles).toEqual([]);
      const good = buildPayload({ version: "v1", body: "x", roleId: "123456789012345678" });
      expect(good.allowed_mentions.roles).toEqual(["123456789012345678"]);
      expect(good.allowed_mentions.parse).toEqual([]);
    });

    it("normalizeRoleId is the single decision point", () => {
      expect(normalizeRoleId("<@&123456789012345678>")).toBe("123456789012345678");
      expect(normalizeRoleId("nope")).toBeUndefined();
      expect(normalizeRoleId(undefined)).toBeUndefined();
    });
  });

  it("pings only the configured role, and only when configured", () => {
    expect(buildPayload({ version: "v1", body: "x" }).content).toBe("");
    const p = buildPayload({ version: "v1", body: "x", roleId: "123456789012345678" });
    expect(p.content).toBe("<@&123456789012345678>");
    expect(p.allowed_mentions.roles).toEqual(["123456789012345678"]);
  });

  // A webhook posts under whatever name and avatar it was created with —
  // Discord's default is a generic name ("Captain Hook") and a placeholder
  // image, which is exactly what v2.12.0 went out as.
  it("posts under the project's own name and avatar, not the webhook's", () => {
    const p = buildPayload({ version: "v1", body: "x" });
    expect(p.username).toBe("Wildcard Pipeline");
    expect(p.avatar_url).toMatch(/^https:\/\/.+\.png$/);
  });

  it("uses a raster avatar — Discord will not render an SVG", () => {
    expect(buildPayload({ version: "v1", body: "x" }).avatar_url).not.toMatch(/\.svg$/i);
  });

  it("lets a caller override the identity", () => {
    const p = buildPayload({
      version: "v1", body: "x", username: "WP Staff", avatarUrl: "https://x/a.png",
    });
    expect(p.username).toBe("WP Staff");
    expect(p.avatar_url).toBe("https://x/a.png");
  });

  /**
   * Two channels, deliberately asymmetric. The staff copy is the review step,
   * so it carries the button that publishes it onward; the public copy is the
   * announcement itself and must not tell readers how to re-send it.
   */
  it("gives the staff copy a publish link, so review and button are one thing", () => {
    const p = buildPayload({ version: "v1", body: "x", channel: "staff" });
    const field = p.embeds[0].fields[0];
    expect(field.value).toContain(DISPATCH_URL);
    expect(field.value).toMatch(/channel.*public/i);
  });

  it("defaults to the staff copy — the safe one to send by accident", () => {
    expect(buildPayload({ version: "v1", body: "x" }).embeds[0].fields).toBeTruthy();
  });

  it("leaves the public copy without the publish link", () => {
    const p = buildPayload({ version: "v1", body: "x", channel: "public" });
    // `undefined`, not `[]` — an empty field block renders as dead space.
    expect(p.embeds[0].fields).toBeUndefined();
  });

  it("stays inside the embed description cap", () => {
    const huge = Array.from({ length: 900 }, (_, i) => `- change ${i}`).join("\n");
    const p = buildPayload({ version: "v1", body: huge });
    expect(p.embeds[0].description.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
  });
});

describe("buildRollupPayload", () => {
  // The case that actually happens: several versions skipped, then one post.
  it("labels each version so readers can tell what came from where", () => {
    const p = buildRollupPayload({
      releases: [
        { version: "v2.12.0", body: "- newest thing" },
        { version: "v2.11.0", body: "- older thing" },
      ],
      sinceVersion: "v2.10.2",
      releaseUrl: "https://x/r",
    });
    expect(p.embeds[0].title).toBe("Wildcard Pipeline v2.12.0 — everything since v2.10.2");
    expect(p.embeds[0].description).toContain("**v2.12.0**");
    expect(p.embeds[0].description).toContain("**v2.11.0**");
  });

  it("carries the channel through a roll-up", () => {
    const staff = buildRollupPayload({
      releases: [{ version: "v2.12.0", body: "- x" }], sinceVersion: "v2.11.0", channel: "staff",
    });
    const pub = buildRollupPayload({
      releases: [{ version: "v2.12.0", body: "- x" }], sinceVersion: "v2.11.0", channel: "public",
    });
    expect(staff.embeds[0].fields).toBeTruthy();
    expect(pub.embeds[0].fields).toBeUndefined();
  });

  it("keeps the identity on a roll-up too", () => {
    const p = buildRollupPayload({
      releases: [{ version: "v2.12.0", body: "- x" }],
      sinceVersion: "v2.10.2",
    });
    expect(p.username).toBe("Wildcard Pipeline");
    expect(p.avatar_url).toMatch(/\.png$/);
  });

  it("leads with the newest, which is what people decide to install", () => {
    const p = buildRollupPayload({
      releases: [
        { version: "v2.12.0", body: "- newest" },
        { version: "v2.11.0", body: "- older" },
      ],
      sinceVersion: "v2.10.2",
    });
    const d = p.embeds[0].description;
    expect(d.indexOf("**v2.12.0**")).toBeLessThan(d.indexOf("**v2.11.0**"));
  });

  it("drops each release's own tail so a roll-up does not become a changelog", () => {
    const p = buildRollupPayload({
      releases: [{ version: "v2.12.0", body: "- kept\n<!-- /modal -->\n- dropped" }],
      sinceVersion: "v2.11.0",
    });
    expect(p.embeds[0].description).toContain("kept");
    expect(p.embeds[0].description).not.toContain("dropped");
  });
});
