// Advanced 6: when nothing fits. Eyes' empty option ("sometimes none") and the node's Exclude null;
// the throne room set as Setting's fallback; then on the canvas a castle-only Setting and a
// thief-only Hero (both per-node option overrides) leave nothing live once the constraint is
// dragged up between Hero and Setting (it only reaches rows below it), and the fallback stands in.
import { tutorial } from "../tutorial.js";

tutorial(
  "A06",
  {
    title: "When nothing fits",
    description: "Let a wildcard sometimes write nothing, pick a fallback for when rules rule everything out, and narrow a wildcard's options for one node only.",
    learn: "Null options, Exclude null, fallback options, per-node option overrides, and dragging a row into place.",
  },
  async (t) => {
    const page = t.page;
    const row = (i: number) => page.locator(`[data-test="wc-opt-row-${i}"]`);

    const editItem = async (ctx: string, name: string) => {
      await t.click(t.moduleRow(ctx, name).locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      return page.getByRole("dialog").last();
    };

    await t.h.step("Sometimes none", async () => {
      await t.go("/wp/wildcards/38c1b584/edit");
      const nul = page.locator('[data-test="wc-opt-row-null"]').first();
      await t.scrollTo(nul, { at: 0.5 });
      await t.callout("null", nul, "An empty option: no eyes this time", 6);
      await t.say("Eyes has an empty option. It rolls like the others, and when it comes up, nothing is written: a quarter of the time, no eyes at all.");
      await t.waitVoice();
      await t.uncallout("null");
      const add = page.locator('[data-test="wc-add-null"]');
      await t.callout("add", add, "Add null", 4);
      await t.say("Add null puts one in. Its weight sets how often nothing comes up.");
      await t.waitVoice();
      await t.uncallout("add");
    });

    await t.h.step("A fallback", async () => {
      await t.go("/wp/wildcards/aa76ada8/edit");
      await t.say("Now Setting. A constraint can rule out every option, and then a wildcard has nothing to pick. A fallback is the stand in.");
      const throne = row(0);
      await t.scrollTo(throne, { at: 0.5 });
      await t.waitVoice();
      await t.say("Hover the throne room's chance and click set as fallback.");
      await t.hover(throne.locator(".opt-prob").first());
      await t.beat(500);
      await t.click(page.locator('[data-test="wc-opt-fallback-0"]'));
      await t.beat(700);
      await t.callout("fb", throne, "Rolls as usual, and stands in when nothing is left", 6);
      await t.waitVoice();
      await t.uncallout("fb");
      await t.say("Save it.");
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1500);
    });

    await t.h.step("For this node only", async () => {
      await t.go("/");
      await t.say("On the canvas, pick Hero, Setting and the Hero fits the place constraint.");
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Hero", "Setting", "Hero fits the place"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero in $setting", { cps: 16 });
      await t.beat(600);
      await t.waitVoice();
      await t.say("This scene needs a thief. Edit Hero on this node and untick everyone else. The library keeps all six.");
      let modal = await editItem(ctx, "Hero");
      for (const who of ["a knight", "a court mage", "a forest ranger", "a desert nomad", "an inventor"]) {
        await t.click(modal.getByLabel(`Use option ${who}`));
        await t.beat(250);
      }
      await t.waitVoice();
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(800);
      await t.say("And it happens in a castle: in Setting, keep only the two castle places.");
      modal = await editItem(ctx, "Setting");
      for (const where of ["an ancient pine forest", "a windswept canyon", "a crowded market street", "a rooftop garden above the city"]) {
        await t.click(modal.getByLabel(`Use option ${where}`));
        await t.beat(250);
      }
      await t.waitVoice();
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(900);
      // Land on a seed where the broken order shows (ramparts), so the fix has a before.
      const preview = t.node(asm).locator('[data-test="asm-preview"]');
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 16 && !/ramparts/i.test(await preview.innerText()); i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      if (!/ramparts/i.test(await preview.innerText())) throw new Error("No seed showed castle ramparts before the drag");
      const rule = t.moduleRow(ctx, "Hero fits the place");
      const badge = rule.getByText(/no tgt downstream/i).first();
      await t.callout("badge", badge, "Nothing below it to reach", 6);
      await t.say("A street thief on castle ramparts? The constraint should stop that, but its badge says it has no target downstream. A constraint only reaches modules below it, and this one sits under Setting.");
      await t.waitVoice();
      await t.uncallout("badge");
      await t.say("Drag it by its grip up between Hero and Setting.");
      const grip = await t.centre(rule.locator(".wp-drag-handle").first());
      const setBox = await t.moduleRow(ctx, "Setting").boundingBox();
      if (!setBox) throw new Error("Setting row not on screen");
      await t.drag(grip, { x: grip.x, y: setBox.y + 6 });
      await t.beat(1200);
      const order = await t.node(ctx).locator(".wp-module .wp-module-name").allInnerTexts();
      if (order.map((n) => n.trim()).join("|") !== "Hero|Hero fits the place|Setting") throw new Error(`Rows after the drag: ${order.join(", ")}`);
      await t.waitVoice();
      await t.callout("prev", t.node(asm).locator('[data-test="asm-preview"]'), "The fallback stands in", 6);
      await t.say("Now the badge is gone, and the constraint keeps city folk out of castles, so nothing is left to pick. The fallback steps in: the throne room, on every seed.");
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(1000);
        const text = (await preview.innerText()).trim();
        if (!/throne room/i.test(text)) throw new Error(`Preview without the fallback: ${text}`);
      }
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Without one, the setting would come out empty. WP Debug says fallback used when it kicks in, so you can spot rules that box a pick in.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("An empty option for sometimes none, a fallback for when nothing fits, and per node ticks for one scene. Next: derivations in depth.");
    });
  },
);
