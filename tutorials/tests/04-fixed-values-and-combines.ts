// Tutorial 4: fixed values and combines. The Style fixed value (always the same text, with its
// own negative), a new Hero line combine that joins two variables, and both in a template.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T04",
  {
    title: "Fixed values and combines",
    description: "A fixed value that always writes the same style, a combine that joins $hero and $outfit into one line, and both in a template.",
    learn: "Use fixed values for text that never changes, and combines to join variables into a reusable line.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("A fixed value", async () => {
      await t.say("Not everything should roll. A fixed value always writes the same text.");
      await t.go("/wp/fixed-values/c32f16d6/edit");
      await t.beat(600);
      const row = page.locator('[data-test="fv-row-0"]');
      await t.scrollTo(row);
      await t.callout("fv", row, "$style, always the same", 6);
      await t.say("This one sets style to a painting look, and it carries a negative too.");
      await t.waitVoice();
      await t.uncallout("fv");
    });

    await t.h.step("A combine", async () => {
      await t.say("A combine joins variables into one line you can reuse. Let's make one.");
      await t.go("/wp/combines/new");
      await t.beat(600);
      await t.fill(page.locator('[data-test="identity-name"]'), "Hero line");
      await t.say("It writes a new variable, hero line, from a small template of its own.");
      await t.fill(page.locator('[data-test="cb-output-var"]'), "hero_line");
      const tpl = page.locator('[data-test="cb-template"] .wp-rt__host').first();
      await t.click(tpl);
      await t.type("$hero wearing $outfit ");
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
      await t.say("On the canvas, a Context node picks Hero and Outfit first, then Style and the new Hero line.");
      await t.go("/");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 260 });
      await t.pickModules(ctx, ["Hero", "Outfit", "Style", "Hero line"]);
      await t.say("A combine reads what was rolled above it, so the order matters.");
      await t.callout("order", t.node(ctx), "Top to bottom", 4);
      await t.waitVoice();
      await t.uncallout("order");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 260 });
      await t.wire(ctx, "context", asm, "context");
      await t.say("Now the template only needs two names.");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$style, $hero_line");
      await t.beat(1200);
      await t.callout("out", t.node(asm), "Style and the hero line, filled in", 4);
      await t.say("The style stays put while the hero line rolls with every seed.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      await t.uncallout("out");

      await t.say("Hero and Outfit only feed the hero line now. Click the globe on their rows to hide them from the prompt.");
      await t.hide(ctx, ["Hero", "Outfit"]);
      const hidden = ["Hero", "Outfit"].map((name) => t.moduleRow(ctx, name));
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
        await showcase(t, { from: nodes.asm, preview: { x: 1560, y: 420, width: 340, height: 500 }, chain: { x: 1820, y: 960 }, between: () => t.click(nodes.plus) });
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
