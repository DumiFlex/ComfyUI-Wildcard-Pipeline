// Advanced 4: reading a pick's parts. $gear.SHOES prints the tag a Travel gear pick rolled from
// its SHOES accepts group; $hair_color.0 / .1 read single picks of a two-pick Hair colors; $outfit.neg
// reads a variable's negative, placed first in the Assembler's negative box.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "A04",
  {
    title: "Reading a pick's parts",
    description: "Print the tag a pick rolled with $gear.SHOES, one of several picks with $hair_color.0, and a variable's negative with $outfit.neg.",
    learn: "The .GROUP, .0 / .1 and .neg readers, and where each one is useful.",
  },
  async (t) => {
    const page = t.page;
    const preview = (asm: string) => t.node(asm).locator('[data-test="asm-preview"]');

    await t.h.step("A tag that rolls", async () => {
      await t.go("/wp/wildcards/a1b2c3d4/edit");
      await t.say("Travel gear has two tag groups. Climate describes each option. Shoes is an accepts group: each option lists the shoes it goes with.");
      const groups = page.locator('[data-test="subcat-group"]').nth(1);
      await t.scrollTo(groups, { at: 0.35 });
      await t.callout("groups", groups, "SHOES: an accepts group", 6);
      await t.waitVoice();
      await t.uncallout("groups");
      await t.say("When the coat rolls, one of its shoes rolls with it. The variable keeps that shoe as a part you can read.");
      await t.waitVoice();
    });

    const nodes = await t.h.step("Print the tag", async () => {
      await t.go("/");
      await t.say("Pick Role, Travel gear and Hair colors, then the rule that fits the outfit to the role, and Outfit.");
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Role", "Travel gear", "Hair colors", "Outfit fits the role", "Outfit"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.waitVoice();
      await t.say("Dollar gear prints the gear. Dollar gear dot SHOES prints the shoe it rolled, in the group's name, in capitals.");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role in $gear and $gear.SHOES", { cps: 16 });
      await t.beat(800);
      await t.waitVoice();
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.callout("prev", preview(asm), "Coat and boots, robe and sandals", 6);
      await t.say("Roll a few seeds. The shoes always suit the gear: boots with a coat, sandals or slippers with a robe.");
      for (let i = 0; i < 4; i++) {
        await t.click(plus);
        await t.beat(1100);
      }
      await t.waitVoice();
      await t.uncallout("prev");
      return { ctx, asm, plus };
    });

    await t.h.step("One of several picks", async () => {
      await t.say("Now make Hair colors pick two for this node: right-click it, Edit, and set the pick to exactly two.");
      await t.click(t.moduleRow(nodes.ctx, "Hair colors").locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      const modal = page.getByRole("dialog").last();
      await t.fill(modal.locator('input[data-test="pool-pick-min"]'), "2");
      await t.press("Tab");
      await t.fill(modal.locator('input[data-test="pool-pick-max"]'), "2");
      await t.press("Tab");
      await t.beat(600);
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(900);
      await t.waitVoice();
      await t.say("Dollar hair color prints both. Dot zero is the first pick, dot one the second. Use one for the hair and one for its streaks.");
      await t.click(t.node(nodes.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("End");
      await t.type(", with $hair_color.0 hair and $hair_color.1 streaks", { cps: 16 });
      await t.beat(800);
      await t.waitVoice();
      await t.callout("prev", preview(nodes.asm), "Two colors, never the same", 6);
      for (let i = 0; i < 3; i++) {
        await t.click(nodes.plus);
        await t.beat(1100);
      }
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("A negative", async () => {
      await t.say("Last, a variable's negative. Add the outfit to the prompt.");
      await t.click(t.node(nodes.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("End");
      await t.type(", wearing $outfit", { cps: 16 });
      await t.beat(800);
      await t.waitVoice();
      const neg = t.node(nodes.asm).locator('[data-test="asm-neg-preview"]');
      // Roll until the plate armor (the outfit with a negative) comes up.
      for (let i = 0; i < 20; i++) {
        if ((await neg.count()) > 0 && /rust/i.test((await neg.textContent()) ?? "")) break;
        await t.click(nodes.plus);
        await t.beat(900);
      }
      await t.callout("neg", neg, "Plate armor's negative: rust, broken armor", 6);
      await t.say("Plate armor carries a negative, and it lands in the negative prompt by itself.");
      await t.waitVoice();
      await t.uncallout("neg");
      await t.say("Dot neg reads it on its own. Here it goes first in the negative box, before the rest.");
      // Open the negative box unless it already is (it starts open or folded depending on its text).
      const negToggle = t.node(nodes.asm).locator('[data-test="neg-template-toggle"]');
      // Click its "negative" label, at the left: the row's centre can sit under a ref's hover card.
      if ((await negToggle.getAttribute("aria-expanded")) !== "true") await t.click(negToggle.locator(".wp-negbox__label"));
      await t.beat(500);
      await t.click(t.node(nodes.asm).locator('[data-test="neg-template-box"] [contenteditable="true"], [data-test="neg-template-box"] textarea').first());
      await t.press("ControlOrMeta+a");
      await t.type("$outfit.neg, $negatives, lowres", { cps: 16 });
      await t.beat(1000);
      await t.callout("neg", neg, "Each word once", 6);
      await t.say("Each word still comes once. Dot neg works in combines and derivations too.");
      await t.waitVoice();
      await t.uncallout("neg");
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("Now the pictures, with WP Debug under the Context.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, between: () => t.click(nodes.plus) });
        await t.callout("parts", t.node(dbg), "Each pick, its tags and negatives");
        await t.say("Debug shows each pick with its tags, and its negative when it has one.");
        await t.waitVoice();
        await t.uncallout("parts");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Dot a group's name for a tag, dot a number for one pick, dot neg for the negative. Next: holding a value, and matching one.");
    });
  },
);
