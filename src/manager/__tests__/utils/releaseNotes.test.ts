import { describe, expect, it } from "vitest";
import { renderReleaseNotes, tailChangeCount } from "../../utils/releaseNotes";

describe("renderReleaseNotes", () => {
  it("escapes raw HTML so scripts cannot execute", () => {
    const html = renderReleaseNotes("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings", () => {
    expect(renderReleaseNotes("## Features")).toContain("<h2>Features</h2>");
  });

  it("renders unordered lists", () => {
    const html = renderReleaseNotes("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders bold and inline code", () => {
    const html = renderReleaseNotes("**big** and `code`");
    expect(html).toContain("<strong>big</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders links with safe rel/target and escapes the href", () => {
    const html = renderReleaseNotes("[docs](https://example.com/a)");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener nofollow"');
  });

  it("neutralizes an href that tries to break out of the attribute", () => {
    const html = renderReleaseNotes('[x](https://e.com/"><script>alert(1)</script>)');
    expect(html).not.toContain("<script>");
  });

  it("renders fenced code blocks as escaped preformatted text", () => {
    const html = renderReleaseNotes("```\nconst a = 1 < 2;\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("1 &lt; 2");
  });

  it("returns an empty-notes marker for blank input", () => {
    expect(renderReleaseNotes("")).toContain("No release notes");
  });

  it("cuts the full-changelog <details> block out of the preview", () => {
    // GitHub collapses it behind a click; unwrapped inline it dumped every
    // commit message into the dialog and buried the "What's new" section the
    // preview exists to show. The dialog links out to the full changelog.
    const md = [
      "## What's new",
      "Real notes here.",
      "",
      "---",
      "<details>",
      "<summary><b>📋 Full changelog</b> — click to expand the per-commit list</summary>",
      "",
      "- fix(engine): something (abc1234)",
      "</details>",
    ].join("\n");
    const html = renderReleaseNotes(md);
    expect(html).toContain("Real notes here.");
    expect(html).not.toContain("Full changelog");
    expect(html).not.toContain("abc1234");
    // The divider that introduced the block goes with it.
    expect(html).not.toContain("<hr");
  });

  it("still unwraps a NON-changelog <details>/<summary>/<b> block", () => {
    // Unwrapping stays the default — another collapsible in a future release
    // body is probably worth showing.
    const md = "<details>\n<summary><b>Upgrade notes</b></summary>\n\n- one\n</details>";
    const html = renderReleaseNotes(md);
    expect(html).not.toContain("&lt;details&gt;");
    expect(html).not.toContain("<details>");
    expect(html).toContain("<strong>");
    expect(html).toContain("Upgrade notes");
    expect(html).toContain("<li>one</li>");
  });

  it("still neutralizes non-allowlisted raw HTML", () => {
    const html = renderReleaseNotes("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders a · separated link header as links", () => {
    const html = renderReleaseNotes("[Docs](https://e.com/d) · [Discord](https://e.com/x)");
    expect(html).toContain('href="https://e.com/d"');
    expect(html).toContain('href="https://e.com/x"');
    expect(html).toContain("·");
  });
});

describe("renderReleaseNotes — modal cut", () => {
  // The release body is written for the release PAGE. The dialog has a 320px
  // scroll box and one job: answer "is this worth clicking Update now". Notes
  // carry a `<!-- /modal -->` marker after the highlights; the dialog stops
  // there, and the tail stays on the page where there is room for it.
  const body = [
    "Headline sentence.",
    "",
    "### Highlights",
    "",
    "- **First thing** that matters",
    "",
    "<!-- /modal -->",
    "",
    "### Also in this release",
    "",
    "- a smaller thing nobody upgrades for",
  ].join("\n");

  it("stops at the marker", () => {
    const html = renderReleaseNotes(body);
    expect(html).toContain("First thing");
    expect(html).not.toContain("Also in this release");
    expect(html).not.toContain("nobody upgrades for");
  });

  it("renders a body with no marker whole — every release before this one", () => {
    const html = renderReleaseNotes("### Highlights\n\n- one\n\n### Also\n\n- two");
    expect(html).toContain("one");
    expect(html).toContain("two");
  });

  it("never leaks a maintainer comment as visible text", () => {
    const html = renderReleaseNotes("Intro\n\n<!-- a note to maintainers -->\n\n- kept");
    expect(html).not.toContain("note to maintainers");
    expect(html).toContain("kept");
  });

  it("falls back to the empty state when nothing precedes the marker", () => {
    expect(renderReleaseNotes("<!-- /modal -->\n\n### Also\n\n- tail only"))
      .toContain("No release notes.");
  });
});

describe("tailChangeCount", () => {
  // The dialog shows highlights only, so without this it ends on a cliff — a
  // five-change release and an eighty-change one look identical.
  it("counts the bullets below the cut", () => {
    const body = [
      "Headline.",
      "",
      "### Highlights",
      "",
      "- kept one",
      "- kept two",
      "",
      "<!-- /modal -->",
      "",
      "**Group**",
      "",
      "- tail one",
      "- tail two",
      "- tail three",
    ].join("\n");
    expect(tailChangeCount(body)).toBe(3);
  });

  it("returns 0 with no marker, so older releases claim nothing", () => {
    expect(tailChangeCount("### Highlights\n\n- one\n- two")).toBe(0);
  });

  it("ignores bullets that only exist inside a maintainer comment", () => {
    const body = "a\n\n<!-- /modal -->\n\n- real\n\n<!--\n- not a change\n-->";
    expect(tailChangeCount(body)).toBe(1);
  });

  it("handles an empty body", () => {
    expect(tailChangeCount("")).toBe(0);
  });
});
