import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_TOKENS, readAppearance, watchAppearance } from "./appearance";

const html = document.documentElement;

afterEach(() => {
  html.removeAttribute("style");
  html.removeAttribute("data-wp-look");
  html.removeAttribute("data-wp-palette");
  html.classList.remove("wp-theme-light");
});

describe("readAppearance", () => {
  it("reads scheme, look and the set tokens", () => {
    html.style.setProperty("--wp-bg", "#0d0a16");
    html.style.setProperty("--wp-accent-600", " #7c3aed ");
    html.style.setProperty("--wp-unlisted", "#fff");
    html.setAttribute("data-wp-look", "crisp");
    html.classList.add("wp-theme-light");
    const a = readAppearance();
    expect(a.scheme).toBe("light");
    expect(a.look).toBe("crisp");
    expect(a.tokens).toEqual({ "--wp-bg": "#0d0a16", "--wp-accent-600": "#7c3aed" });
  });

  it("defaults to dark Orbit", () => {
    expect(readAppearance()).toEqual({ scheme: "dark", look: "orbit", tokens: {} });
  });

  it("lists every token once", () => {
    expect(new Set(APPEARANCE_TOKENS).size).toBe(APPEARANCE_TOKENS.length);
  });
});

describe("watchAppearance", () => {
  it("reports each real change once and stops when asked", async () => {
    const onChange = vi.fn();
    const stop = watchAppearance(onChange);
    html.setAttribute("data-wp-look", "tui");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ look: "tui" }));
    html.setAttribute("data-wp-palette", "native"); // no CSS in jsdom: same values
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
    stop();
    html.classList.add("wp-theme-light");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
