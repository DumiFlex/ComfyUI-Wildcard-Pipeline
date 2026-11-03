// Firefox (WebRender, checked on 159) draws a BORDERED element whose corner
// radius reaches half its height (a full pill: `999px`) in pieces. Inside a
// canvas DOM widget ComfyUI scales it to the zoom (`transform: scale(s)`), and
// at zooms like 0.64 / 0.72 / 0.8 / 0.88 / 0.96 those pieces seam: a line
// through the pill's ends at mid-height and a vertical join near the right
// cap. A finite radius a little under half the height draws in one piece and
// looks the same (pr-drafts/zoom-glitches-2026-11-03.md; component-standard.md).
//
// So a canvas rule with a visible border may not use a bare pill radius.
// Overlays (modals, the editors that open in them, the picker) are drawn at
// scale 1 and are exempt.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "..");

/** Files drawn outside the scaled canvas (body-level overlays). */
const OVERLAY = [/Modal\.vue$/, /\/context\/editors\//, /\/image-filter\/PickerHost\.vue$/];

const PILL = /border-radius:\s*(?:var\(--wp-radius-cap,\s*999px\)|9{3,}px)\s*(?:;|$)/m;
const BORDER = /(?:^|[;{\s])border(?:-(?:top|bottom|left|right))?:\s*([^;}]+)/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(vue|css)$/.test(name) ? [p] : [];
  });
}

/** True when a `border` value draws something. */
function visible(value: string): boolean {
  const v = value.trim();
  if (/^(0|none)\b/.test(v)) return false;
  const parts = v.split(/\s+/);
  return parts[parts.length - 1] !== "transparent";
}

/** Rule blocks (selector, body) with no nested braces, enough for our CSS. */
function rules(css: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ sel: (m[1] ?? "").trim().split("\n").pop() ?? "", body: m[2] ?? "" });
  }
  return out;
}

function seamRisks(css: string): string[] {
  return rules(css)
    .filter(({ body }) => PILL.test(body) && [...body.matchAll(BORDER)].some((b) => visible(b[1] ?? "")))
    .map(({ sel }) => sel);
}

describe("canvas pills draw in one piece", () => {
  it("flags a bordered full pill and passes a finite radius", () => {
    expect(seamRisks(".a { border: 1px solid red; border-radius: var(--wp-radius-cap, 999px); }")).toEqual([".a"]);
    expect(seamRisks(".a { border: 1px solid red; border-radius: min(9px, var(--wp-radius-cap, 999px)); }")).toEqual([]);
    expect(seamRisks(".a { border: 0; border-radius: 999px; }")).toEqual([]);
    expect(seamRisks(".a { border: 1px solid transparent; border-radius: 999px; }")).toEqual([]);
  });

  it("no canvas widget rule pairs a visible border with a 999px radius", () => {
    const hits: string[] = [];
    for (const f of files(ROOT)) {
      const rel = relative(SRC, f).replace(/\\/g, "/");
      if (OVERLAY.some((re) => re.test(`/${rel}`))) continue;
      for (const sel of seamRisks(readFileSync(f, "utf8"))) hits.push(`${rel}: ${sel}`);
    }
    expect(hits).toEqual([]);
  });
});
