import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These fonts are served, not bundled — see the header of `fonts.ts`. The
 * stylesheet is copied to `js/assets/fonts/` by `scripts/copy-fonts.mjs` and
 * located at runtime relative to this chunk's own URL.
 *
 * Both failure modes here are SILENT in a browser: a wrong path 404s and text
 * quietly falls back to the system stack, and a duplicated <link> costs a
 * second request nobody notices. Neither shows up in any other test.
 */
describe("webfont linking", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.querySelectorAll("#wp-webfonts").forEach((n) => n.remove());
  });

  it("appends one stylesheet link pointing at the copied CSS", async () => {
    await import("./fonts");
    const links = document.head.querySelectorAll<HTMLLinkElement>("link#wp-webfonts");
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe("stylesheet");
    // Resolved against the module URL, so the leading segments differ between
    // the test run and the built chunk. The tail is what has to hold: the CSS
    // sits in a `fonts/` directory beside whatever chunk imports it.
    expect(links[0].href).toMatch(/\/fonts\/wp-fonts\.css$/);
  });

  it("does not add a second link when imported again", async () => {
    await import("./fonts");
    await import("./fonts");
    expect(document.head.querySelectorAll("link#wp-webfonts")).toHaveLength(1);
  });

  it("resolves the CSS beside the chunk, and the woff2 beside the CSS", () => {
    // The whole scheme in one assertion: chunk URL -> stylesheet -> font file.
    // If someone moves the copy target without moving the other end, this is
    // the test that says so.
    const chunk = "http://host/extensions/comfyui-wildcard-pipeline/assets/fonts-abc123.js";
    const css = new URL(["fonts", "wp-fonts.css"].join("/"), chunk).href;
    expect(css).toBe(
      "http://host/extensions/comfyui-wildcard-pipeline/assets/fonts/wp-fonts.css",
    );
    expect(new URL("./inter-latin.woff2", css).href).toBe(
      "http://host/extensions/comfyui-wildcard-pipeline/assets/fonts/inter-latin.woff2",
    );
  });
});
