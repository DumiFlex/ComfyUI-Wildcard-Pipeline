import { describe, it, expect } from "vitest";
import { highlightJson } from "./highlight";

describe("highlightJson", () => {
  it("wraps string keys in wp-jh-k spans", () => {
    const html = highlightJson('{"foo":"bar"}');
    expect(html).toContain('<span class="wp-jh-k">&quot;foo&quot;</span>');
  });

  it("wraps string values in wp-jh-s spans", () => {
    const html = highlightJson('{"k":"hello"}');
    expect(html).toContain('<span class="wp-jh-s">&quot;hello&quot;</span>');
  });

  it("wraps numbers in wp-jh-n spans", () => {
    const html = highlightJson('{"n":42}');
    expect(html).toContain('<span class="wp-jh-n">42</span>');
  });

  it("wraps booleans + null in wp-jh-b spans", () => {
    const html = highlightJson('{"a":true,"b":false,"c":null}');
    expect(html).toContain('<span class="wp-jh-b">true</span>');
    expect(html).toContain('<span class="wp-jh-b">false</span>');
    expect(html).toContain('<span class="wp-jh-b">null</span>');
  });

  it("escapes HTML-unsafe characters in string values", () => {
    const html = highlightJson('{"s":"<script>alert(1)</script>"}');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("preserves whitespace + indentation", () => {
    const pretty = JSON.stringify({ a: 1, b: 2 }, null, 2);
    const html = highlightJson(pretty);
    // Two-space indent must survive intact.
    expect(html).toContain("\n  ");
  });

  it("handles nested structures", () => {
    const html = highlightJson('{"arr":[1,"two",true]}');
    expect(html).toContain('<span class="wp-jh-n">1</span>');
    expect(html).toContain('<span class="wp-jh-s">&quot;two&quot;</span>');
    expect(html).toContain('<span class="wp-jh-b">true</span>');
  });
});
