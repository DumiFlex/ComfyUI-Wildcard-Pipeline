// Tutorial 7: Prompt Assembler templates. Write a template (and a negative) on an Assembler,
// save it to the library, load it into a second Assembler, then find it on the manager's
// Templates page, where it can be edited and reused.
import { tutorial } from "../tutorial.js";

tutorial(
  "T07",
  {
    title: "Templates: save a prompt and reuse it",
    description: "Save an Assembler's template and negative to the library, load it into another Assembler, and edit it in the manager.",
    learn: "Save, load and edit Prompt Assembler templates.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("Write a template", async () => {
      await t.go("/");
      await t.say("A template is the sentence the Assembler fills in. Once you like one, keep it in your library.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 400, y: 300 });
      await t.pickModules(ctx, ["Hero", "Outfit", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1050, y: 300 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero wearing $outfit, standing in $setting");
      await t.beat(800);
      await t.say("Open the negative box under it, too. A template keeps its negative with it.");
      await t.click(t.node(asm).locator('[data-test="neg-template-toggle"]'));
      await t.beat(500);
      await t.click(t.node(asm).locator('[data-test="neg-template-box"] [contenteditable="true"], [data-test="neg-template-box"] textarea').first());
      await t.say("It starts with dollar negatives, where the variables' negatives go. Keep it, and add your own words.");
      await t.press("ControlOrMeta+a");
      await t.type("blurry, extra fingers, $negatives");
      await t.press("Escape");
      await t.beat(1000);
      return { ctx, asm };
    });

    await t.h.step("Save it", async () => {
      const save = t.node(nodes.asm).locator('[data-test="asm-save-template"]');
      await t.callout("save", save, "Save template", 6);
      await t.say("The disk button saves both to the library.");
      await t.click(save);
      await t.uncallout("save");
      await t.beat(600);
      await t.fill(page.locator('[data-test="save-tpl-name"]').locator("input").or(page.locator('input[data-test="save-tpl-name"]')).first(), "Hero portrait");
      await t.callout("preview", page.locator('[data-test="save-tpl-preview"]'), "What gets saved", 6);
      await t.say("Give it a name. The preview shows what gets saved.");
      await t.waitVoice();
      await t.uncallout("preview");
      await t.click(page.locator('[data-test="save-tpl-submit"]'));
      await t.beat(1200);
    });

    await t.h.step("Load it somewhere else", async () => {
      await t.say("Now a second Assembler. Wire it to the same Context and open the folder button.");
      const asm2 = await t.addNode("WP Prompt Assembler", { x: 1600, y: 300 });
      await t.wire(nodes.ctx, "context", asm2, "context");
      await t.click(t.node(asm2).locator('[data-test="asm-load-template"]'));
      await t.beat(800);
      const row = page.locator('[data-test="load-tpl-row"]').filter({ hasText: "Hero portrait" }).first();
      await t.callout("row", row, "Your saved template", 6);
      await t.say("Your templates are listed here. Pick one.");
      await t.waitVoice();
      await t.uncallout("row");
      await t.click(row);
      await t.beat(1200);
      await t.callout("loaded", t.node(asm2), "Same template, same negative", 4);
      await t.say("It fills in the template and the negative. Edit it here freely: the saved copy doesn't change.");
      await t.waitVoice();
      await t.uncallout("loaded");
    });

    await t.h.step("Templates in the manager", async () => {
      await t.go("/wp/templates");
      await t.say("Every saved template lives on the Templates page of the manager.");
      await t.beat(800);
      const listed = page.getByText("Hero portrait", { exact: true }).first();
      await t.callout("listed", listed, "Hero portrait", 8);
      await t.waitVoice();
      await t.uncallout("listed");
      await t.say("Open it to rename it, edit the text, or give it a category, tags and a favourite star.");
      await t.click(listed);
      await t.beat(1200);
      const fields = [page.getByRole("textbox", { name: "Template" }).first(), page.locator('[data-test="tpl-negative"]').first()];
      await t.callout("fields", fields, "Template and negative", 8);
      await t.waitVoice();
      await t.uncallout("fields");
    });

    await t.h.step("Outro", async () => {
      await t.say("Write a prompt once, save it, and load it into any Assembler. Next: bundles.");
    });
  },
);
