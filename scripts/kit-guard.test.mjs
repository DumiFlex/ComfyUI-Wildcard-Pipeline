// Kit guard (see kit-guard.mjs). `pnpm kit:baseline` rewrites the baseline.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, RULES, compare, countAll, totals } from "./kit-guard.mjs";

const BASELINE = join(ROOT, "scripts", "kit-guard-baseline.json");

describe("kit guard", () => {
  const counts = countAll();

  if (process.env.WP_WRITE_KIT_BASELINE) {
    it("writes the baseline", () => {
      writeFileSync(BASELINE, JSON.stringify({ totals: totals(counts), ...counts }, null, 2) + "\n");
    });
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const { over, under } = compare(counts, baseline);

  it("adds no hand-rolled controls the kit already has", () => {
    const lines = over.map((o) => `${o.file}: ${o.count} × ${o.rule} (baseline ${o.baseline}). ${o.fix}`);
    expect(lines, `Use the component kit (Settings › Advanced › Component kit):\n${lines.join("\n")}`).toEqual([]);
  });

  it("keeps the baseline as low as the code", () => {
    const lines = under.map((u) => `${u.file}: ${u.rule} ${u.baseline} → ${u.count}`);
    expect(lines, `Fewer than the baseline. Run \`pnpm kit:baseline\` and commit it:\n${lines.join("\n")}`).toEqual([]);
  });

  it("has a rule entry for every rule in the baseline", () => {
    const ids = RULES.map((r) => r.id).sort();
    const inFile = Object.keys(baseline).filter((k) => k !== "totals").sort();
    expect(inFile).toEqual(ids);
  });
});

describe("kit guard compare", () => {
  it("flags a file over its baseline and one under it", () => {
    const r = compare(
      { "native-select": { "a.vue": 2 }, "raw-hex": { "b.vue": 1 } },
      { "native-select": { "a.vue": 1 }, "raw-hex": { "b.vue": 3 } },
    );
    expect(r.over.map((o) => o.file)).toEqual(["a.vue"]);
    expect(r.under.map((u) => u.file)).toEqual(["b.vue"]);
  });

  it("treats a file missing from the baseline as 0", () => {
    const r = compare({ "inline-svg": { "new.vue": 1 } }, {});
    expect(r.over).toHaveLength(1);
    expect(r.over[0].baseline).toBe(0);
  });
});
