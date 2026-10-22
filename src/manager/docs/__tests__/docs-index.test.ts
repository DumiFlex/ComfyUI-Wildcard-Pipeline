/**
 * The AI chat answers questions from the built-in docs. Python can't render
 * the Vue pages, so this renders each one and keeps a plain-text copy in
 * `engine/ai/docs_index.json`, plus the Settings page's entries so it can
 * say where a setting lives. It fails when the copy is stale; regenerate it
 * with `pnpm docs:index`.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { DOC_PAGES } from "../registry";
import { SECTIONS, SETTING_ENTRIES } from "../../components/settings/settings-index";

const OUT = resolve(__dirname, "../../../../engine/ai/docs_index.json");
const BLOCK = new Set([
  "P", "LI", "H1", "H2", "H3", "H4", "TR", "DT", "DD", "PRE", "BLOCKQUOTE", "FIGCAPTION",
  "UL", "OL", "TABLE", "DL", "SECTION", "ARTICLE", "HEADER", "DETAILS", "SUMMARY",
]);
const SKIP = new Set(["SCRIPT", "STYLE", "SVG", "BUTTON", "IMG", "FIGURE"]);

interface DocSectionText { title: string; text: string }
interface DocPageText {
  id: string; title: string; group: string; blurb: string; keywords: string[];
  sections: DocSectionText[];
}

/** Text of a node with a line break between blocks, "- " on list items and
 *  " | " between table cells. Images and buttons are left out. */
export function plainText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || el.getAttribute("aria-hidden") === "true") return;
    const block = BLOCK.has(tag) || el.classList.contains("wp-doc-callout");
    if (block) out.push("\n");
    if (tag === "LI") out.push("- ");
    if (tag === "TD" || tag === "TH") out.push(" | ");
    for (const child of Array.from(el.childNodes)) walk(child);
    if (block) out.push("\n");
  };
  walk(root);
  return out.join("")
    .split("\n")
    .map((l) => l.replace(/^\s*\|\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function renderAll(): Promise<DocPageText[]> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/docs/:page?", name: "documentation-page", component: { template: "<div/>" } }],
  });
  await router.push("/docs");
  await router.isReady();
  const pages: DocPageText[] = [];
  for (const p of DOC_PAGES) {
    const mod = await p.loader();
    const w = mount(mod.default, { global: { plugins: [router, createPinia()] } });
    await flushPromises();
    const sections = w.findAll(".wp-doc-section").map((s) => ({
      title: s.find(".wp-doc-section__h2").text().trim(),
      text: plainText(s.find(".wp-doc-section__body").element),
    }));
    pages.push({
      id: p.id, title: p.title, group: p.group, blurb: p.blurb, keywords: p.keywords ?? [],
      sections: sections.filter((s) => s.text),
    });
    w.unmount();
  }
  pages.push({
    id: "settings", title: "Settings", group: "settings",
    blurb: "Every setting in the manager's Settings page, by section.", keywords: [],
    sections: SECTIONS.map((sec) => ({
      title: sec.label,
      text: [sec.blurb, ...SETTING_ENTRIES.filter((e) => e.section === sec.id)
        .map((e) => `- ${e.label}: ${e.hint}`)].join("\n"),
    })),
  });
  return pages;
}

describe("docs index for the AI chat", () => {
  it("engine/ai/docs_index.json matches the docs pages", async () => {
    const json = `${JSON.stringify({ pages: await renderAll() }, null, 1)}\n`;
    if (process.env.WP_WRITE_DOCS_INDEX) writeFileSync(OUT, json);
    let committed = "";
    try {
      committed = readFileSync(OUT, "utf8");
    } catch {
      committed = "";
    }
    expect(committed === json, "docs_index.json is stale: run `pnpm docs:index`").toBe(true);
  }, 60_000);

  it("keeps blocks, list items and table cells apart", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>One <b>two</b></p><ul><li>a</li><li>b</li></ul>"
      + "<table><tr><td>x</td><td>y</td></tr></table><figure><figcaption>pic</figcaption></figure>";
    expect(plainText(el)).toBe("One two\n- a\n- b\nx | y");
  });
});
