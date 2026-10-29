// Kit guard: counts hand-rolled controls in .vue files, per rule and file.
//
// The component kit (`/kit`, src/manager/kit/registry.ts) has a shared
// control for each of these. Existing code is the baseline in
// `kit-guard-baseline.json`; `kit-guard.test.mjs` fails when a file gets MORE
// than its baseline (use the kit instead) and when it gets FEWER (the
// baseline only shrinks: run `pnpm kit:baseline` and commit it).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Under Vitest import.meta.url is a /@fs/ URL; resolve from the file path.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url).replace(/^\/@fs/, "")), "..");

/** Files that ARE the kit, or demo it, may use what they replace. */
const KIT_PAGE = ["src/manager/views/Kit.vue", "src/manager/kit/demos/"];

export const RULES = [
  {
    id: "native-select",
    pattern: /<select\b/g,
    allow: ["src/kit/WpSelect.vue"],
    fix: "Use Select (manager) or WpSelect (canvas).",
  },
  {
    id: "native-number",
    pattern: /type="number"/g,
    allow: ["src/kit/WpNumber.vue"],
    fix: "Use WpNumber: our arrows, keys and wheel, clamped.",
  },
  {
    id: "native-checkbox",
    pattern: /type="checkbox"/g,
    allow: ["src/manager/components/ui/Checkbox.vue", "src/manager/components/ui/Toggle.vue", "src/kit/WpCheck.vue"],
    fix: "Use Checkbox or Toggle (manager) or WpCheck (canvas).",
  },
  {
    id: "native-range",
    pattern: /type="range"/g,
    allow: [],
    fix: "Use Slider (or WpNumber for an exact number).",
  },
  {
    id: "inline-svg",
    pattern: /<svg\b/g,
    allow: ["src/kit/Logo.vue", "src/kit/LoadingMark.vue"],
    fix: "Use Icon. A drawing that is not an icon belongs in its own component.",
  },
  {
    id: "hand-dialog",
    pattern: /role="dialog"/g,
    allow: [
      "src/manager/components/ui/Modal.vue",
      "src/kit/ModalShell.vue",
      "src/components/shared/ConfirmDialog.vue",
      "src/manager/components/ui/Drawer.vue",
    ],
    fix: "Use Modal (manager), or ModalShell / ConfirmDialog (canvas).",
  },
  {
    id: "manager-raw-button",
    pattern: /<button\b/g,
    only: "src/manager/",
    // DataTable's sort control is the header text itself, not a Button;
    // ChoiceCards' cards are radios holding a picture, not Buttons.
    allow: ["src/manager/components/ui/DataTable.vue", "src/manager/components/ui/ChoiceCards.vue"],
    fix: "Use Button. A raw <button> needs a reason the kit can't cover.",
  },
  {
    id: "raw-hex",
    pattern: /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g,
    allow: [],
    fix: "Use a colour token (var(--wp-…)); see Tokens on the kit page.",
  },
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".vue")) out.push(p);
  }
  return out;
}

/** Strip HTML comments so a commented-out <select> doesn't count. */
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** `{ ruleId: { "src/x.vue": count } }`, only non-zero counts. */
export function countAll(root = ROOT) {
  const files = walk(join(root, "src"), []).map((f) => relative(root, f).split(sep).join("/")).sort();
  const out = {};
  for (const rule of RULES) out[rule.id] = {};
  for (const file of files) {
    if (KIT_PAGE.some((k) => file === k || (k.endsWith("/") && file.startsWith(k)))) continue;
    const text = stripComments(readFileSync(join(root, file), "utf8"));
    for (const rule of RULES) {
      if (rule.only && !file.startsWith(rule.only)) continue;
      if (rule.allow.includes(file)) continue;
      const n = (text.match(rule.pattern) || []).length;
      if (n > 0) out[rule.id][file] = n;
    }
  }
  return out;
}

/** Problems against a baseline: `{ over: [...], under: [...] }`. */
export function compare(counts, baseline) {
  const over = [];
  const under = [];
  for (const rule of RULES) {
    const now = counts[rule.id] || {};
    const base = baseline[rule.id] || {};
    for (const file of new Set([...Object.keys(now), ...Object.keys(base)])) {
      const n = now[file] || 0;
      const b = base[file] || 0;
      if (n > b) over.push({ rule: rule.id, file, count: n, baseline: b, fix: rule.fix });
      else if (n < b) under.push({ rule: rule.id, file, count: n, baseline: b });
    }
  }
  return { over, under };
}

export function totals(counts) {
  const out = {};
  for (const [rule, files] of Object.entries(counts)) {
    out[rule] = Object.values(files).reduce((a, b) => a + b, 0);
  }
  return out;
}
