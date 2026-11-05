// Advanced 3: wildcards inside wildcards. Hair's options read the Colors list through @ chips; a new
// Cloak list reads Colors and, through a tag filter, only the cold Travel gear. A referenced list
// doesn't need to be on the node. Ends with the ref recursion limit in Settings › Canvas.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "A03",
  {
    title: "Wildcards inside wildcards",
    description: "Put one list inside another's options with @, filter it by tags, and use it on the canvas without adding the inner list.",
    learn: "@ references, tag-filtered references, and how deep references can go.",
  },
  async (t) => {
    const page = t.page;
    const value = (i: number) => page.locator(`[data-test="wc-opt-row-${i}"] .wp-rt__host`).first();

    await t.h.step("A list inside a list", async () => {
      await t.go("/wp/wildcards/4facf8ce/edit");
      await t.say("An option can hold another wildcard. Hair's options read the Colors list: each purple chip rolls a color.");
      await t.scrollTo(page.getByText(/^Options \(\d+\)$/).first());
      await t.callout("chips", [value(0), value(1)], "@color: a roll of Colors", 6);
      await t.waitVoice();
      await t.uncallout("chips");
      await t.say("So short hair can be short silver hair, or short copper hair, without writing every pair.");
      await t.waitVoice();
    });

    await t.h.step("Make one", async () => {
      await t.go("/wp/wildcards/new");
      await t.say("Let's make a Cloak list that does the same.");
      await t.fill(page.locator('[data-test="identity-name"]'), "Cloak");
      await t.scrollTo(page.getByText(/^Options \(\d+\)$/).first());
      await t.waitVoice();
      await t.say("Type an at sign and the start of a variable, and pick it with Enter. Colors has no tags, so it goes straight in.");
      await t.click(value(0));
      await t.type("a @colo", { cps: 12 });
      await t.beat(700);
      await t.press("Enter");
      await t.beat(900);
      await t.type(" wool cloak", { cps: 16 });
      await t.waitVoice();
      await t.say("The second option takes from Travel gear. Travel gear has tags, so Enter offers a filter: pick cold, then Apply.");
      await t.click(value(1));
      await t.type("@gea", { cps: 12 });
      await t.beat(700);
      await t.press("Enter");
      await t.beat(900);
      const picker = page.locator('[data-test="subcat-picker"]').last();
      await t.callout("filter", picker, "Only the tags you want", 6);
      await t.click(picker.getByRole("button", { name: "cold", exact: true }));
      await t.beat(600);
      await t.uncallout("filter");
      await t.click(picker.getByRole("button", { name: "Apply" }));
      await t.beat(800);
      await t.callout("cold", value(1), "Only Travel gear tagged cold", 6);
      await t.waitVoice();
      await t.uncallout("cold");
      await t.say("Save it.");
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1500);
    });

    const nodes = await t.h.step("On the canvas", async () => {
      await t.go("/");
      await t.say("On the canvas, pick Hero and Cloak. Colors and Travel gear don't need to be on the node: a reference finds them in the library.");
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Hero", "Cloak"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero in $cloak");
      await t.waitVoice();
      await t.say("Roll a few seeds: a wool cloak in a new color, or a cold weather coat, never a summer robe.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 5; i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      await t.waitVoice();
      return { ctx, asm, plus };
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("Now the pictures, with WP Debug under the Context.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, between: () => t.click(nodes.plus) });
        await t.callout("picks", t.node(dbg), "Each reference's roll");
        await t.say("Debug shows what each reference rolled.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("How deep", async () => {
      await t.go("/wp/settings/canvas");
      const limit = page.getByLabel("Wildcard ref recursion limit");
      await t.scrollTo(limit, { at: 0.4 });
      await t.callout("limit", limit, "How deep references may go", 6);
      await t.say("Lists can nest inside lists inside lists. Settings, Canvas, sets how deep, so a list that reads itself can't loop forever.");
      await t.waitVoice();
      await t.uncallout("limit");
    });

    await t.h.step("Outro", async () => {
      await t.say("Write a list once, and let other lists read it, all of it, or only the tags you want. Next: reading a pick's parts.");
    });
  },
);
