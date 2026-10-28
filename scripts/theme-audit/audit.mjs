#!/usr/bin/env node
/**
 * Theme audit — opens every manager screen in every look (and the palettes in
 * dark + light) and checks the layout in a real browser:
 *
 *   - nothing spills out of the box it sits in (the bulk bar's Delete did),
 *   - the page never scrolls sideways,
 *   - one-line controls (buttons, chips, nav, counts) never wrap,
 *   - a checkbox draws its state once: the tick in boxed looks, only the
 *     "[x]" text in TUI, and the text matches the box's real state,
 *   - text keeps 3:1 contrast against what it sits on.
 *
 * Needs a built manager (`pnpm build:manager`) and serve.py's API:
 *
 *   python scripts/theme-audit/serve.py --port 8199 &
 *   node scripts/theme-audit/audit.mjs [--base http://127.0.0.1:8199]
 *     [--out theme-audit-out] [--shots] [--looks tui,soft] [--screens all]
 *
 * Writes <out>/report.json and, with --shots, one PNG per look x screen.
 * Exits 1 when any check fails. CI runs it as the theme-audit job.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
const BASE = opt("base", "http://127.0.0.1:8199").replace(/\/$/, "");
const OUT = opt("out", "theme-audit-out");
const SHOTS = args.includes("--shots");
const ONLY_LOOKS = opt("looks", "")?.split(",").filter(Boolean);
const ONLY_SCREENS = opt("screens", "")?.split(",").filter(Boolean);
const ONLY_PALETTES = opt("palettes", "")?.split(",").filter(Boolean);

// Kept in step with LOOK_OPTIONS / PALETTE_OPTIONS (tweaksStore.ts); the
// vitest guard theme-audit-ids.test.ts fails when they drift.
export const LOOKS = ["orbit", "crisp", "soft", "terminal", "editorial", "compact", "tui"];
export const PALETTES = ["orbit", "native", "nebula", "tide", "ember", "contrast"];

/** Ids from bench/bench-library.json, which serve.py seeds. */
const SCREENS = [
  { id: "dashboard", path: "dashboard" },
  { id: "all", path: "all" },
  { id: "all-selected", path: "all", act: "selectAll" },
  { id: "all-filters", path: "all", act: "openFilters" },
  { id: "all-filters-selected", path: "all", act: ["openFilters", "favoritesOnly", "selectAll"] },
  { id: "wildcards", path: "wildcards" },
  { id: "wildcards-selected", path: "wildcards", act: "selectAll" },
  { id: "wildcards-filters", path: "wildcards", act: ["openFilters", "favoritesOnly"] },
  { id: "fixed-values", path: "fixed-values" },
  { id: "combines", path: "combines" },
  { id: "derivations", path: "derivations" },
  { id: "constraints", path: "constraints" },
  { id: "bundles", path: "bundles" },
  { id: "bundles-selected", path: "bundles", act: "selectAll" },
  { id: "templates", path: "templates" },
  { id: "templates-selected", path: "templates", act: "selectAll" },
  { id: "wildcard-editor", path: "wildcards/b0000001/edit" },
  { id: "fixed-editor", path: "fixed-values/b0000021/edit" },
  { id: "combine-editor", path: "combines/b0000031/edit" },
  { id: "derivation-editor", path: "derivations/b0000041/edit" },
  { id: "constraint-editor", path: "constraints/b0000043/edit" },
  { id: "bundle-editor", path: "bundles/b00000b1/edit" },
  { id: "template-editor", path: "templates/b00000c1/edit" },
  { id: "categories", path: "categories" },
  { id: "tags", path: "tags" },
  { id: "import-export", path: "import-export" },
  { id: "test-runner", path: "test" },
  { id: "pack-builder", path: "pack-builder" },
  { id: "settings-general", path: "settings/general" },
  { id: "settings-appearance", path: "settings/appearance" },
  { id: "settings-editing", path: "settings/editing" },
  { id: "settings-canvas", path: "settings/canvas" },
  { id: "settings-ai", path: "settings/ai" },
  { id: "settings-library", path: "settings/library" },
  { id: "settings-advanced", path: "settings/advanced" },
  { id: "whats-new", path: "whats-new" },
  { id: "docs", path: "docs" },
  { id: "kit", path: "kit" },
];

/** Screens the palette pass (colour only) walks in dark and light. */
const PALETTE_SCREENS = ["all-selected", "all-filters", "wildcard-editor", "constraint-editor", "settings-appearance", "kit"];

const ACTIONS = {
  async selectAll(page) {
    const head = page.locator("thead [role=checkbox], thead .wp-check").first();
    if (await head.count()) await head.click();
  },
  async openFilters(page) {
    const btn = page.getByRole("button", { name: /filters/i }).first();
    if (await btn.count()) await btn.click();
  },
  async favoritesOnly(page) {
    const btn = page.locator('[data-test="favorites-filter"]').first();
    if (await btn.count()) await btn.click();
  },
};

/* ---------------------------------------------------------------------- */
/* In-page checks. One function so Playwright ships it in one evaluate.   */
/* ---------------------------------------------------------------------- */
function pageChecks({ look }) {
  const issues = [];
  const root = document.querySelector(".wp-content") ?? document.body;
  const vw = document.documentElement.clientWidth;

  function visible(el) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function label(el) {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((c) => c.startsWith("wp-")).slice(0, 2).join(".") : "";
    const test = el.getAttribute("data-test");
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${test ? `[data-test=${test}]` : ""}${text ? ` "${text}"` : ""}`;
  }
  // Something inside a closed <details>, a clipped scroller or a popover
  // layer is not part of the page flow we are judging.
  function outOfFlow(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === "fixed" || cs.position === "sticky") return true;
      if (n.matches?.("[role=dialog], [role=menu], [role=listbox], [role=tooltip], .wp-popover")) return true;
    }
    return false;
  }

  // 1. Page scrolls sideways.
  const doc = document.scrollingElement;
  if (doc && doc.scrollWidth > vw + 1) {
    issues.push({ check: "page-hscroll", detail: `page is ${doc.scrollWidth}px wide in a ${vw}px window` });
  }

  // 2. Children escaping a drawn box (border or own background), when the box
  //    does not clip. Reports the escaping child once, against its nearest box.
  const boxes = [...root.querySelectorAll("*")].filter((el) => {
    if (!visible(el) || outOfFlow(el)) return false;
    const cs = getComputedStyle(el);
    const bordered = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none");
    const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    return bordered || filled;
  });
  const boxSet = new Set(boxes);
  for (const el of root.querySelectorAll("*")) {
    if (!visible(el) || outOfFlow(el) || el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "absolute") continue;
    let box = el.parentElement;
    let clipped = false;
    while (box && box !== root.parentElement && !boxSet.has(box)) {
      const bcs = getComputedStyle(box);
      if (bcs.overflowX !== "visible" || bcs.overflowY !== "visible") { clipped = true; break; }
      box = box.parentElement;
    }
    if (!box || clipped || !boxSet.has(box)) continue;
    const bcs = getComputedStyle(box);
    if (bcs.overflowX !== "visible") continue;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const out = Math.max(b.left - r.left, r.right - b.right);
    if (out > 2) {
      issues.push({ check: "escapes-box", detail: `${label(el)} sticks ${Math.round(out)}px out of ${label(box)}` });
    }
  }

  // 3. One-line controls that wrapped.
  const ONE_LINE = ".wp-btn, .wp-chip, .wp-nav__label, .wp-nav__count, .wp-segmented__opt, .wp-tabset__tab, [data-one-line]";
  for (const el of root.querySelectorAll(ONE_LINE)) {
    if (!visible(el) || outOfFlow(el)) continue;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    // Line boxes of the text itself (icons sit on their own baseline).
    const tops = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      if (!t.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const rr of range.getClientRects()) if (rr.width > 0) tops.push(rr.top);
    }
    tops.sort((x, y) => x - y);
    let lines = tops.length ? 1 : 0;
    for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > lh * 0.6) lines++;
    if (lines > 1) {
      issues.push({ check: "wraps", detail: `${label(el)} wraps onto ${lines} lines` });
    }
  }

  // 4. Checkboxes draw their state once, and the right one.
  for (const el of document.querySelectorAll(".wp-check, [role=checkbox]")) {
    if (!visible(el)) continue;
    const state = el.getAttribute("aria-checked") ?? el.getAttribute("data-checked") ?? "false";
    const mixed = el.getAttribute("data-indeterminate") === "true" || state === "mixed";
    const on = state === "true";
    const glyphs = [...el.querySelectorAll("svg, .pi")].filter(visible);
    const before = getComputedStyle(el, "::before").content;
    const text = before && before !== "none" && before !== "normal" ? before.replace(/^"|"$/g, "") : "";
    if (look === "tui" && el.classList.contains("wp-check")) {
      if (glyphs.length) issues.push({ check: "check-double", detail: `${label(el)} shows a drawn tick beside its text mark` });
      const want = on ? "[x]" : mixed ? "[-]" : "[ ]";
      if (text !== want) issues.push({ check: "check-state", detail: `${label(el)} reads ${text || "nothing"}, should read ${want}` });
    } else if (on || mixed) {
      if (glyphs.length + (text ? 1 : 0) > 1) issues.push({ check: "check-double", detail: `${label(el)} draws its state ${glyphs.length + 1} times` });
    }
  }

  // 5. Pieces that ignore the look: corners rounder than the look allows
  //    (circles and dots excepted) and, in the all-mono looks, text that is
  //    not mono. A hit means a component hard-codes a radius or a font
  //    instead of reading --wp-radius* / --wp-font.
  const MAX_RADIUS = { crisp: 4, terminal: 0, tui: 0 };
  const maxR = MAX_RADIUS[look];
  const rootCs = getComputedStyle(document.documentElement);
  const mono = rootCs.getPropertyValue("--wp-font-mono").split(",")[0].trim().replace(/["']/g, "").toLowerCase();
  const allMono = look === "terminal" || look === "tui";
  const seenRule = new Set();
  for (const el of document.querySelectorAll(".wp-app *, .wp-content *")) {
    if (!visible(el) || el instanceof SVGElement) continue;
    // Previews of other looks and of the canvas draw someone else's corners.
    if (el.closest("[data-look-exempt], .wp-pg-mockup")) continue;
    const cs = getComputedStyle(el);
    if (maxR !== undefined) {
      const r = el.getBoundingClientRect();
      const rad = Math.max(...["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((k) => {
        const v = cs[`border${k}Radius`];
        return v.endsWith("%") ? (parseFloat(v) / 100) * Math.min(r.width, r.height) : parseFloat(v) || 0;
      }));
      const drawn = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 || cs.boxShadow !== "none";
      const round = Math.abs(r.width - r.height) <= 2 && rad >= Math.min(r.width, r.height) / 2 - 1;
      const tiny = Math.min(r.width, r.height) <= 10; // dots, knobs, scrollbar thumbs
      if (drawn && !round && !tiny && rad > maxR + 0.5) {
        const key = `radius|${label(el).split(" ")[0]}`;
        if (!seenRule.has(key)) {
          seenRule.add(key);
          issues.push({ check: "look-radius", detail: `${label(el)} has ${Math.round(rad)}px corners, ${look} allows ${maxR}px` });
        }
      }
    }
    if (allMono && mono && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const fam = cs.fontFamily.split(",")[0].trim().replace(/["']/g, "").toLowerCase();
      if (fam !== mono && !/monospace|mono|primeicons/.test(fam) && !el.closest(".pi, [data-font-exempt]")) {
        const key = `font|${label(el).split(" ")[0]}`;
        if (!seenRule.has(key)) {
          seenRule.add(key);
          issues.push({ check: "look-font", detail: `${label(el)} is set in ${cs.fontFamily.split(",")[0]}, ${look} is all mono` });
        }
      }
    }
  }

  // 6. Contrast of text against the first opaque background behind it.
  function rgba(str) {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  function lum([r, g, b]) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function bgOf(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none") return null; // gradients/images: skip
      const c = rgba(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
    }
    let out = [255, 255, 255];
    for (const c of layers.reverse()) out = out.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
    return out;
  }
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent?.trim()) continue;
    const el = t.parentElement;
    if (!el || seen.has(el) || !visible(el) || outOfFlow(el)) continue;
    seen.add(el);
    if (el.closest("[disabled], [aria-disabled=true], .is-disabled, [aria-hidden=true], .wp-kit-swatch, [data-contrast-exempt]")) continue;
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color);
    const bg = bgOf(el);
    if (!fg || !bg || fg[3] < 0.5) continue;
    let o = Number(cs.opacity);
    for (let n = el.parentElement; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    if (o < 0.95) continue; // faded on purpose (disabled-looking hints)
    const mixed = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
    const [a, b] = [lum(mixed), lum(bg)];
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 3) issues.push({ check: "contrast", detail: `${label(el)} is ${ratio.toFixed(2)}:1` });
  }

  return issues;
}

/* ---------------------------------------------------------------------- */

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  const runs = [];
  for (const look of LOOKS) {
    if (ONLY_LOOKS?.length && !ONLY_LOOKS.includes(look)) continue;
    for (const s of SCREENS) {
      if (ONLY_SCREENS?.length && !ONLY_SCREENS.includes(s.id)) continue;
      runs.push({ look, palette: "orbit", mode: "dark", screen: s });
    }
  }
  for (const palette of PALETTES) {
    if (ONLY_PALETTES?.length && !ONLY_PALETTES.includes(palette)) continue;
    if (ONLY_LOOKS?.length && !ONLY_PALETTES?.length) break;
    for (const mode of ["dark", "light"]) {
      for (const look of ["orbit", "tui"]) {
        for (const sid of PALETTE_SCREENS) {
          if (palette === "orbit" && mode === "dark") continue; // covered above
          const s = SCREENS.find((x) => x.id === sid);
          if (ONLY_SCREENS?.length && !ONLY_SCREENS.includes(s.id)) continue;
          runs.push({ look, palette, mode, screen: s });
        }
      }
    }
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  let current = "";
  const page = await context.newPage();
  for (const r of runs) {
    const key = `${r.look}|${r.palette}|${r.mode}`;
    if (key !== current) {
      current = key;
      await context.clearCookies();
      await page.goto(`${BASE}/wp/kit`);
      await page.evaluate(({ look, palette, mode }) => {
        localStorage.clear();
        localStorage.setItem("wp-tweaks-v1", JSON.stringify({ look, palette, accent: "theme" }));
        localStorage.setItem("wp-theme-mode", mode);
        // Picking Compact folds the sidebar to its icon rail; audit it that way.
        localStorage.setItem("wp-sidebar-collapsed", look === "compact" ? "1" : "0");
        localStorage.setItem("wp-whats-new-after-update", "0");
        localStorage.setItem("wp-last-seen-version", "999.0.0");
      }, r);
    }
    await page.goto(`${BASE}/wp/${r.screen.path}`);
    await page.waitForLoadState("networkidle");
    await page.locator(".wp-content").first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}" });
    for (const a of [r.screen.act ?? []].flat()) {
      await ACTIONS[a](page);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(250);
    const issues = await page.evaluate(pageChecks, { look: r.look });
    const name = `${r.look}--${r.palette}-${r.mode}--${r.screen.id}`;
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    report.push({ name, ...r, screen: r.screen.id, issues });
    const tag = issues.length ? `FAIL ${issues.length}` : "ok";
    console.log(`${tag.padEnd(8)} ${name}`);
    for (const i of issues.slice(0, 12)) console.log(`         ${i.check}: ${i.detail}`);
    if (issues.length > 12) console.log(`         … ${issues.length - 12} more`);
  }

  await browser.close();
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const failed = report.filter((r) => r.issues.length);
  console.log(`\n${report.length - failed.length}/${report.length} screens clean`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) run();
