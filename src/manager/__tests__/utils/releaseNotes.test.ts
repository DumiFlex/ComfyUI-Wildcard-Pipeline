import { describe, expect, it } from "vitest";
import { renderReleaseNotes } from "../../utils/releaseNotes";

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

  it("unwraps <details>/<summary>/<b> instead of showing literal tags", () => {
    const md = "<details>\n<summary><b>📋 Full changelog</b> — details</summary>\n\n- one\n</details>";
    const html = renderReleaseNotes(md);
    expect(html).not.toContain("&lt;details&gt;");
    expect(html).not.toContain("&lt;summary&gt;");
    expect(html).not.toContain("<details>");
    // Summary becomes a bold lead line; the list still renders.
    expect(html).toContain("<strong>");
    expect(html).toContain("Full changelog");
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
