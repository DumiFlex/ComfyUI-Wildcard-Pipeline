/**
 * Generate the README flow figures.
 *
 * The SPA draws these as Vue + CSS with PrimeIcons webfont glyphs
 * (`src/manager/components/docs/PipelineDiagram.vue`, framed by
 * `DocFigure.vue`). A README can run neither: GitHub serves the file through
 * `<img>`, so there is no component runtime and no icon font.
 *
 * So this reproduces that figure in SVG, deriving every value from the real
 * component rather than approximating it by eye:
 *
 *   frame      --wp-bg-1 / --wp-border, radius --wp-radius-lg (12)
 *   card       --wp-bg-2, --wp-border-strong, radius 10, min-width 120,
 *              column layout: icon 16 / name 12 semibold / id 9.5 mono dim
 *   WP card    border tinted with --wp-node, icon in --wp-node
 *   feeders    pills, --wp-bg-2 + --wp-border, 10.5px, icon in the kind colour
 *   labels     9.5px uppercase, letter-spacing .04em, --wp-text-dim
 *   var chips  mono 10.5px, pill, per-chip accent border
 *
 * Icons are the REAL PrimeIcons paths from `primeicons/raw-svg` — the same
 * source the webfont is built from — so the README shows the same glyphs the
 * app does.
 *
 * Both themes ship in one file: GitHub honours `prefers-color-scheme` inside
 * an SVG served to `<img>`, so the light block below mirrors the SPA's light
 * theme rather than washing the dark one out.
 *
 * Run: node scripts/build-flow-figures.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ICON_DIR = "node_modules/primeicons/raw-svg";
const OUT_DIR = "public/images/docs";

/* ── tokens, lifted from src/components/shared/theme.css + manager tokens ── */
const DARK = {
  frameBg: "#1e1e1e", frameBd: "#3a3a3a",
  cardBg: "#232323", cardBd: "#4a4a4a",
  node: "#2dd4bf",
  text: "#dddddd", muted: "#aaaaaa", dim: "#666666",
  wildcard: "#a78bfa", fixed: "#22d3ee", combine: "#34d399",
  derivation: "#fbbf24", constraint: "#f472b6",
  chipA: "#c4b5fd", chipAb: "#8b5cf6",
  chipB: "#67e8f9", chipBb: "#22d3ee",
  chipC: "#86efac", chipCb: "#34d399",
};
const LIGHT = {
  frameBg: "#f5f5f5", frameBd: "#b0b0b0",
  cardBg: "#ffffff", cardBd: "#999999",
  node: "#0f766e",
  text: "#1a1a1a", muted: "#555555", dim: "#888888",
  wildcard: "#6d28d9", fixed: "#1d4ed8", combine: "#065f46",
  derivation: "#92400e", constraint: "#9d174d",
  chipA: "#6d28d9", chipAb: "#8b5cf6",
  chipB: "#1d4ed8", chipBb: "#22d3ee",
  chipC: "#065f46", chipCb: "#34d399",
};

const SANS = "'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const MONO = "'JetBrains Mono', Consolas, Monaco, 'Courier New', monospace";

/** Rough advance width. Good enough to size pills; every label is centred, so
 *  a few px of slop never misaligns text against its box. */
const textW = (s, px, mono = false) => s.length * px * (mono ? 0.6 : 0.52);

/** Inner markup of a PrimeIcon, scaled to `size` and centred on (cx, cy).
 *  Fills become `currentColor` so the wrapping `<g>`'s colour drives it. */
function icon(name, cx, cy, size) {
  const raw = fs.readFileSync(path.join(ICON_DIR, `${name}.svg`), "utf8");
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/\s(?:width|height)="[^"]*"/g, "")
    .replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"')
    .replace(/stroke="(?!none)[^"]*"/g, 'stroke="currentColor"')
    .trim();
  const s = size / 24;
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})">${inner}</g>`;
}

/** A node card. Vertical, centred: icon, name, mono subtitle — the SPA's
 *  `.wp-doc-diagram__node-box`. `wp` cards take the teal node accent. */
function card(cx, top, label, sub, iconName, kind = "wp") {
  const w = Math.max(124, textW(label, 12) + 34, textW(sub, 9.5, true) + 26);
  const h = 66;
  const x = cx - w / 2;
  return {
    w, h,
    svg: [
      `<rect class="card card--${kind}" x="${x}" y="${top}" width="${w}" height="${h}" rx="10"/>`,
      `<g class="ico ico--${kind}">${icon(iconName, cx, top + 19, 16)}</g>`,
      `<text class="nm" x="${cx}" y="${top + 43}" text-anchor="middle">${label}</text>`,
      `<text class="id" x="${cx}" y="${top + 57}" text-anchor="middle">${sub}</text>`,
    ].join("\n  "),
  };
}

/** Labelled connector, matching `.wp-doc-diagram__arrow`: uppercase label
 *  above a hairline that ends in a small solid head. */
function connector(x1, x2, y, label) {
  const mid = (x1 + x2) / 2;
  return [
    label ? `<text class="lbl" x="${mid}" y="${y - 9}" text-anchor="middle">${label}</text>` : "",
    `<line class="ln" x1="${x1}" y1="${y}" x2="${x2 - 6}" y2="${y}"/>`,
    `<path class="head" d="M${x2 - 6} ${y - 4} L${x2} ${y} L${x2 - 6} ${y + 4} Z"/>`,
  ].join("\n  ");
}

/** Pill row of the five module kinds — `.wp-doc-diagram__feeder`. */
function feeders(cx, y) {
  const items = [
    ["sparkles", "Wildcard", "wildcard"],
    ["tag", "Fixed Values", "fixed"],
    ["link", "Combine", "combine"],
    ["arrow-right-arrow-left", "Derivation", "derivation"],
    ["filter", "Constraint", "constraint"],
  ];
  const gap = 6;
  const pills = items.map(([ico, label, kind]) => {
    const w = 9 + 10 + 6 + textW(label, 10.5) + 9;
    return { ico, label, kind, w };
  });
  const total = pills.reduce((a, p) => a + p.w, 0) + gap * (pills.length - 1);
  let x = cx - total / 2;
  const out = pills.map((p) => {
    const s = [
      `<rect class="pill" x="${x}" y="${y}" width="${p.w}" height="21" rx="10.5"/>`,
      `<g class="ico--${p.kind}">${icon(p.ico, x + 15, y + 10.5, 10)}</g>`,
      `<text class="feeder" x="${x + 24}" y="${y + 14}">${p.label}</text>`,
    ].join("\n  ");
    x += p.w + gap;
    return s;
  });
  return out.join("\n  ");
}

/** The `$vars` stage: chips over a small uppercase caption. */
function varBag(cx, top) {
  const chips = [["$subject", "a"], ["$style", "b"], ["$lighting", "c"]];
  const gap = 5;
  const sized = chips.map(([t, v]) => ({ t, v, w: textW(t, 10.5, true) + 14 }));
  // Two rows, mirroring the SPA's 150px-capped wrapping bag.
  const row1 = sized.slice(0, 2);
  const row2 = sized.slice(2);
  const line = (items, y) => {
    const total = items.reduce((a, c) => a + c.w, 0) + gap * (items.length - 1);
    let x = cx - total / 2;
    return items.map((c) => {
      const s = [
        `<rect class="chip chip--${c.v}" x="${x}" y="${y}" width="${c.w}" height="19" rx="9.5"/>`,
        `<text class="chipt chipt--${c.v}" x="${x + c.w / 2}" y="${y + 13}" text-anchor="middle">${c.t}</text>`,
      ].join("\n  ");
      x += c.w + gap;
      return s;
    }).join("\n  ");
  };
  return [
    line(row1, top),
    line(row2, top + 24),
    `<text class="varcap" x="${cx}" y="${top + 62}" text-anchor="middle">RESOLVED $VARS</text>`,
  ].join("\n  ");
}

function themeBlock(t, prefix = "") {
  return `
    ${prefix}.frame { fill: ${t.frameBg}; stroke: ${t.frameBd}; }
    ${prefix}.card { fill: ${t.cardBg}; stroke: ${t.cardBd}; }
    ${prefix}.card--wp { stroke: ${t.node}; stroke-opacity: .55; }
    ${prefix}.ico--wp { color: ${t.node}; }
    ${prefix}.ico--ext { color: ${t.muted}; }
    ${prefix}.ico--wildcard { color: ${t.wildcard}; }
    ${prefix}.ico--fixed { color: ${t.fixed}; }
    ${prefix}.ico--combine { color: ${t.combine}; }
    ${prefix}.ico--derivation { color: ${t.derivation}; }
    ${prefix}.ico--constraint { color: ${t.constraint}; }
    ${prefix}.pill { fill: ${t.cardBg}; stroke: ${t.frameBd}; }
    ${prefix}.feeder { fill: ${t.muted}; }
    ${prefix}.nm { fill: ${t.text}; }
    ${prefix}.id, ${prefix}.lbl, ${prefix}.cap, ${prefix}.varcap { fill: ${t.dim}; }
    ${prefix}.ln { stroke: ${t.cardBd}; }
    ${prefix}.head { fill: ${t.cardBd}; }
    ${prefix}.chip { fill: ${t.cardBg}; }
    ${prefix}.chip--a { stroke: ${t.chipAb}; stroke-opacity: .4; }
    ${prefix}.chip--b { stroke: ${t.chipBb}; stroke-opacity: .4; }
    ${prefix}.chip--c { stroke: ${t.chipCb}; stroke-opacity: .4; }
    ${prefix}.chipt--a { fill: ${t.chipA}; }
    ${prefix}.chipt--b { fill: ${t.chipB}; }
    ${prefix}.chipt--c { fill: ${t.chipC}; }`;
}

function shell(w, h, label, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">
  <style><![CDATA[
    .frame, .card, .pill, .chip { stroke-width: 1; }
    .cap { font: 400 10px ${SANS}; letter-spacing: .06em; }
    .feeder { font: 400 10.5px ${SANS}; }
    .nm { font: 600 12px ${SANS}; }
    .id { font: 400 9.5px ${MONO}; }
    .lbl, .varcap { font: 400 9.5px ${SANS}; letter-spacing: .05em; }
    .chipt { font: 400 10.5px ${MONO}; }
${themeBlock(DARK)}
    @media (prefers-color-scheme: light) {${themeBlock(LIGHT, "  ")}
    }
  ]]></style>
  <rect class="frame" x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12"/>
  ${body}
</svg>
`;
}

/* ── figure 1 — what the pipeline does ─────────────────────────────────── */
function buildIntro() {
  const W = 880;
  const H = 202;
  const cx = W / 2;
  const rowTop = 104;
  const midY = rowTop + 33;

  const ctx = card(112, rowTop, "WP Context", "rolls + resolves", "sitemap");
  const asm = card(566, rowTop, "Prompt Assembler", '"A $style portrait…"', "align-left");
  const clip = card(772, rowTop, "CLIP Encode", "conditioning", "bolt", "ext");
  const varsCx = 348;

  const body = [
    `<text class="cap" x="${cx}" y="30" text-anchor="middle">MODULES INSIDE THE CONTEXT</text>`,
    feeders(cx, 40),
    `<g class="ico--ext">${icon("angle-down", cx, 78, 12)}</g>`,
    ctx.svg,
    connector(112 + ctx.w / 2 + 8, varsCx - 78, midY, "EMITS"),
    varBag(varsCx, rowTop - 2),
    connector(varsCx + 78, 566 - asm.w / 2 - 8, midY, "FILLS"),
    asm.svg,
    connector(566 + asm.w / 2 + 8, 772 - clip.w / 2 - 8, midY, "PROMPT"),
    clip.svg,
  ].join("\n  ");

  return shell(
    W,
    H,
    "Wildcard, Fixed Values, Combine, Derivation and Constraint modules resolve inside WP Context, which emits resolved dollar-variables that fill the WP Prompt Assembler template, which CLIP Encode turns into conditioning",
    body,
  );
}

/* ── figure 2 — looping a chain ────────────────────────────────────────────
 * The old figure ran the assembled prompt straight into KSampler. It does not
 * go there: text is encoded first and only conditioning reaches the sampler.
 * Seeds are the one thing that DOES arrive directly, so they get their own
 * lane BELOW the text path rather than cutting through it. */
function buildLoop() {
  const W = 880;
  const H = 286;
  const cx = W / 2;
  const r1 = 54;
  const r2 = 158;
  const mid1 = r1 + 33;
  const mid2 = r2 + 33;
  const laneY = 252;

  const loop = card(112, r1, "WP Context Loop", "N iterations", "refresh");
  const seeds = card(112, r2, "WP Seed List", "N seeds", "list");
  const ctx = card(340, r1, "WP Context", "module stack", "sitemap");
  const asm = card(566, r1, "Prompt Assembler", "N prompts", "align-left");
  const clip = card(566, r2, "CLIP Encode", "N conditionings", "bolt", "ext");
  const ks = card(772, r2, "KSampler", "N images", "image", "ext");

  const body = [
    `<text class="cap" x="${cx}" y="30" text-anchor="middle">BOTH LISTS FAN OUT IN LOCKSTEP — ITERATION N MEETS SEED N</text>`,
    loop.svg, seeds.svg, ctx.svg, asm.svg, clip.svg, ks.svg,
    connector(112 + loop.w / 2 + 8, 340 - ctx.w / 2 - 8, mid1, "CONTEXT"),
    connector(340 + ctx.w / 2 + 8, 566 - asm.w / 2 - 8, mid1, "$VARS"),
    // assembler drops straight down into the encoder
    `<text class="lbl" x="576" y="141">PROMPT</text>`,
    `<line class="ln" x1="566" y1="${r1 + 66}" x2="566" y2="${r2 - 6}"/>`,
    `<path class="head" d="M562 ${r2 - 6} L566 ${r2} L570 ${r2 - 6} Z"/>`,
    connector(566 + clip.w / 2 + 8, 772 - ks.w / 2 - 8, mid2, "COND"),
    // seeds take their own lane under the text path and rise into the sampler
    `<path class="ln" fill="none" d="M112 ${r2 + 66} V ${laneY} H 772 V ${r2 + 72}"/>`,
    `<path class="head" d="M768 ${r2 + 72} L772 ${r2 + 66} L776 ${r2 + 72} Z"/>`,
    `<text class="lbl" x="420" y="${laneY - 8}" text-anchor="middle">SEED[]</text>`,
  ].join("\n  ");

  return shell(
    W,
    H,
    "WP Context Loop drives WP Context and the Prompt Assembler to produce N prompts, CLIP Encode turns them into conditioning for KSampler, and WP Seed List supplies the matching seed for each iteration directly to KSampler",
    body,
  );
}

fs.writeFileSync(path.join(OUT_DIR, "flow-intro.svg"), buildIntro());
fs.writeFileSync(path.join(OUT_DIR, "flow-loop.svg"), buildLoop());
console.log("wrote flow-intro.svg + flow-loop.svg");
