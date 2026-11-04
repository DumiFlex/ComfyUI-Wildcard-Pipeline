// Advanced 1: tag groups. Travel gear's tags sit in two groups: CLIMATE describes each option
// (cold / warm), SHOES is an accepts axis: one of the option's shoe tags is rolled per pick and
// read in a template as $gear.SHOES.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "A01",
  {
    title: "Tag groups: describe an option, or roll one of its tags",
    description: "Group a wildcard's tags. A descriptive group says what an option is; an accepts group rolls one of its tags, which a template reads as $var.GROUP.",
    learn: "Tag groups, the descriptive and accepts kinds, and reading an accepts group with $var.GROUP.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Tags in groups", async () => {
      await t.go("/wp/wildcards/a1b2c3d4/edit");
      await t.say("Tags are short words on an option. On their own they filter and steer picks. Put them in groups and they can do more.");
      await t.beat(800);
      // The panel opens on its own unless Settings say otherwise.
      if (await page.locator('[data-test="subcat-collapsed"]').isVisible()) {
        await t.click(page.locator('[data-test="subcat-collapse"]'));
        await t.beat(600);
      }
      const groups = page.locator('[data-test="subcat-group"]');
      await t.scrollTo(groups.first());
      const climate = groups.filter({ has: page.locator('[data-test="subcat-group-name-CLIMATE"]') }).first();
      await t.callout("climate", climate, "Descriptive: what the option is", 6);
      await t.say("Travel gear has two groups. CLIMATE is descriptive: a coat is cold weather gear, a robe is warm. All of an option's descriptive tags count at once.");
      await t.waitVoice();
      await t.uncallout("climate");
      const shoes = groups.filter({ has: page.locator('[data-test="subcat-group-name-SHOES"]') }).first();
      await t.callout("shoes", shoes, "Accepts: one of these is rolled", 6);
      await t.say("SHOES is an accepts group. Its tags are alternatives: a robe goes with sandals or slippers, and each pick rolls one of them.");
      await t.waitVoice();
      await t.uncallout("shoes");
      const kind = page.locator('[data-test="group-kind-SHOES"]');
      await t.callout("kind", kind, "Switch the kind here", 6);
      await t.say("The switch on the group's header sets its kind.");
      await t.waitVoice();
      await t.uncallout("kind");
      const tags = page.locator(".opt-tags");
      await t.scrollTo(tags.first());
      await t.callout("tags", [tags.first(), tags.nth(2)], "Each option's tags", 4);
      await t.say("Each option lists the shoes it goes with.");
      await t.waitVoice();
      await t.uncallout("tags");
    });

    const nodes = await t.h.step("Read the rolled tag", async () => {
      await t.go("/");
      await t.say("On the canvas, pick Hero and Travel gear.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Hero", "Travel gear"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.say("In the template, $gear.SHOES prints the shoe that was rolled with the gear.");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero in $gear, wearing $gear.SHOES");
      await t.beat(1000);
      await t.say("Roll a few seeds. The shoes always fit the gear: never sandals with a fur cloak.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 4; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      await t.say("The roll happens once per run, so $gear.SHOES reads the same everywhere you write it.");
      await t.waitVoice();
      return { ctx, asm, plus };
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
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
      await t.say("Accepts groups also let constraints match tag for tag, and tags filter references inside wildcards. Both come next.");
    });
  },
);
