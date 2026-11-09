// Tutorial 4: fixed values and combines. The Style fixed value (always the same text, with its own
// negative), opened from the sidebar; then a new Outfit line combine that joins $outfit and $held,
// and both in a template with $role.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T04",
  {
    title: "Fixed values and combines",
    description: "A fixed value that always writes the same style, a combine that joins $outfit and $held into one line, and both in a template.",
    learn: "Use fixed values for text that never changes, and combines to join variables into a reusable line.",
  },
  async (t) => {
    const page = t.page;
    const nav = (route: string) => page.locator(`a.wp-nav[href="/wp/${route}"]`).first();

    await t.h.step("A fixed value", async () => {
      await t.go("/wp/");
      await t.say("Wildcards roll, but not everything should. Open Fixed values in the sidebar.");
      await t.click(nav("fixed-values"));
      await t.beat(900);
      await t.waitVoice();
      await t.say("A fixed value always writes the same text. Open Style.");
      await t.click(page.locator("table").getByText("Style", { exact: true }).first());
      await t.beat(1200);
      await t.waitVoice();
      const row = page.locator('[data-test="fv-row-0"]');
      await t.scrollTo(row);
      await t.callout("fv", row, "$style, always the same", 6);
      await t.say("It sets style to the painted look every picture shares. It carries negative words too, which go to the negative prompt.");
      await t.waitVoice();
      await t.uncallout("fv");
    });

    await t.h.step("A combine", async () => {
      await t.say("Fixed text is one half. The other is joining rolled variables into a line you can reuse, and that's a combine. Open Combines.");
      await t.click(nav("combines"));
      await t.beat(900);
      await t.waitVoice();
      await t.say("Subject and Scene are combines from the tutorial library. Let's make a new one.");
      await t.click(page.getByRole("button", { name: /New Combine/ }).first());
      await t.beat(900);
      await t.waitVoice();
      await t.say("Name it Outfit line. The variable it writes, outfit line, follows the name.");
      await t.fill(page.locator('[data-test="identity-name"]'), "Outfit line");
      await t.beat(400);
      await t.callout("var", page.locator('[data-test="cb-output-var"]'), "Templates read it as $outfit_line", 6);
      await t.waitVoice();
      await t.uncallout("var");
      await t.say("Its template joins the outfit and the held item.");
      const tpl = page.locator('[data-test="cb-template"] .wp-rt__host').first();
      await t.click(tpl);
      await t.type("wearing $outfit and holding $held ");
      await t.press("Escape");
      await t.beat(800);
      const preview = page.locator('[data-test="cb-preview"]');
      await t.scrollTo(preview);
      await t.callout("prev", preview, "What it reads and writes", 6);
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Save it.");
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1500);
    });

    const nodes = await t.h.step("Use them", async () => {
      await t.go("/");
      await t.say("On the canvas, a Context node picks Role, the two rules that keep the outfit and the item fitting the role, Outfit, Held item, Style, and the new Outfit line. The rules get their own video later.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Role", "Outfit fits the role", "Item fits the role", "Outfit", "Held item", "Style", "Outfit line"]);
      await t.waitVoice();
      await t.say("A combine reads what was rolled above it in the node, or upstream in an earlier Context, so the order matters.");
      await t.callout("order", t.node(ctx), "Top to bottom", 4);
      await t.waitVoice();
      await t.uncallout("order");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.say("Now the template only needs three names.");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $outfit_line. $style");
      await t.beat(1200);
      await t.callout("out", t.node(asm), "The outfit line and the style, filled in", 4);
      await t.say("The style stays put while the outfit line rolls with every seed.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      await t.uncallout("out");

      await t.say("Outfit and Held item only feed the outfit line now. Click the globe on their rows to hide them from the prompt.");
      await t.hide(ctx, ["Outfit", "Held item"]);
      const hidden = ["Outfit", "Held item"].map((name) => t.moduleRow(ctx, name));
      await t.callout("hidden", hidden, "Hidden from the prompt", 4);
      await t.say("The combine still reads them, so the prompt stays the same. On their own, they no longer print anywhere.");
      await t.waitVoice();
      await t.uncallout("hidden");
      return { ctx, asm, plus };
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("Run through a model, every picture keeps the painted style.");
        await t.say("First, add WP Debug under the Context, so every run shows what it rolled.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, between: () => t.click(nodes.plus) });
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.say("Debug shows the picks behind the last picture, so you can see the prompt change from run to run.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Fixed values hold what never changes, combines build lines you reuse. Next: derivations.");
    });
  },
);
