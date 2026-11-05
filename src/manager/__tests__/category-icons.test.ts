// The AI's category icons (engine/ai/chat_manage.py CATEGORY_ICONS) are the
// ones the Categories page offers (the kit's icon catalog). The kit comes
// from npm, so the check lives here, where both are on disk.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allCuratedIcons } from "@/kit/icon-catalog";

describe("category icons", () => {
  it("match between the AI tools and the editor's icon catalog", () => {
    const py = readFileSync(resolve(__dirname, "../../../engine/ai/chat_manage.py"), "utf8");
    const tuple = /CATEGORY_ICONS\s*=\s*\(([\s\S]*?)\)/.exec(py)?.[1] ?? "";
    const icons = [...tuple.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(icons).toEqual(allCuratedIcons());
  });
});
