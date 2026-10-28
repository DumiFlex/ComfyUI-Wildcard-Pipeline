// Guards for the theme audit (audit.mjs) that run in plain vitest:
//   - its look / palette lists match the ones the manager offers,
//   - no manager-rendered stylesheet hard-codes a corner the looks can't
//     square (write min(Npx, var(--wp-radius-cap, 999px)), or a token).
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { LOOK_OPTIONS, PALETTE_OPTIONS } from "../../src/manager/stores/tweaksStore";
import { LOOKS, PALETTES } from "./audit.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

describe("theme audit", () => {
  it("walks every look and palette the manager offers", () => {
    expect([...LOOKS].sort()).toEqual(LOOK_OPTIONS.map((o) => o.id).sort());
    expect([...PALETTES].sort()).toEqual(PALETTE_OPTIONS.map((o) => o.id).sort());
  });

  it("leaves no raw corner radius the looks can't reach", () => {
    // Files whose corners are not the manager look's on purpose: the look
    // sheet itself, the look/palette previews, and the canvas colour sheet.
    const EXEMPT = new Set([
      "src/manager/styles/looks.css",
      "src/manager/components/settings/ThemeChoices.vue",
      "src/components/shared/theme.css",
    ]);
    const files = [
      ...globSync("src/**/*.vue", { cwd: ROOT }),
      ...globSync("src/manager/**/*.css", { cwd: ROOT }),
      ...globSync("src/components/shared/**/*.css", { cwd: ROOT }),
    ].filter((f) => !EXEMPT.has(f.split("\\").join("/")));
    const RAW = /border-(?:(?:top|bottom)-(?:left|right)-|(?:start|end)-(?:start|end)-)?radius\s*:\s*([^;{}\n]+)/g;
    const bad = [];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      const css = f.endsWith(".vue") ? (text.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join("\n") : text;
      for (const m of css.matchAll(RAW)) {
        const v = m[1].replace(/!important/, "").trim();
        if (/var\(|calc\(|min\(|%|^(0|inherit|initial|unset)$/.test(v)) continue;
        if (v.split(/\s+/).every((t) => t === "0" || t === "0px")) continue;
        bad.push(`${relative(ROOT, join(ROOT, f))}: border-radius: ${v}`);
      }
    }
    expect(bad, "Write min(Npx, var(--wp-radius-cap, 999px)) or a --wp-radius-* token so the square looks square it").toEqual([]);
  });
});
