// Advanced 5: hold and match. A Context Loop runs four frames; Hold across run keeps Role's pick on
// every frame while the rest re-roll. Then Match variable: a Text node wired into an Injector writes
// $wanted_time = "at night" and Time of day matches it, so the Lighting rule that reads $time follows.
import { tutorial } from "../tutorial.js";

tutorial(
  "A05",
  {
    title: "Hold and match",
    description: "Keep one pick the same on every frame of a loop with Hold across run, and make a pick follow a variable with Match variable.",
    learn: "Hold across run, Match variable, and how a matched pick drives the rules after it.",
  },
  async (t) => {
    const page = t.page;

    const editItem = async (ctx: string, name: string) => {
      await t.click(t.moduleRow(ctx, name).locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      return page.getByRole("dialog").last();
    };

    const nodes = await t.h.step("A loop", async () => {
      await t.go("/");
      await t.say("A Context Loop runs the workflow several times from one click. Each frame rolls its own picks.");
      // The setup earlier videos taught: sped up.
      await t.speedUp();
      const loop = await t.addNode("WP Context Loop", { x: 270, y: 170 });
      const ctx = await t.addNode("WP Context", { x: 790, y: 170 });
      await t.wire(loop, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Outfit fits the role", "Outfit", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role wearing $outfit, $setting", { cps: 16 });
      await t.beat(600);
      await t.normalSpeed();
      await t.say("To read the prompts, add Show Any from the Easy-Use pack: it lists every prompt the loop makes.");
      const text = await t.addNode("Show Any", { x: 1340, y: 620 });
      await t.wire(asm, "prompt", text, "anything");
      await t.waitVoice();
      await t.say("Set the count to four, and Run.");
      const more = t.node(loop).locator('[data-widget-name="count"] button').last();
      for (let i = 0; i < 3; i++) {
        await t.click(more);
        await t.beat(350);
      }
      await t.run();
      await t.callout("out", t.node(text), "Four frames, four characters", 6);
      await t.say("Four prompts, and a new role in each.");
      await t.waitVoice();
      await t.uncallout("out");
      return { loop, ctx, asm, text };
    });

    await t.h.step("Hold across run", async () => {
      await t.say("For a story, the character should stay the same. Right-click Role, Edit, and switch on Hold across run.");
      const modal = await editItem(nodes.ctx, "Role");
      const hold = modal.locator('[data-test="runtime-hold"]');
      await t.scrollTo(hold, { at: 0.6 });
      await t.callout("hold", hold, "One pick for the whole run", 6);
      await t.click(hold);
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("hold");
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(800);
      await t.say("Run again.");
      await t.run();
      await t.callout("out", t.node(nodes.text), "Same role, new outfit and place", 6);
      await t.say("The same role in every frame, while the outfit and the place still change. A new seed picks a new role for the next run.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Match a variable", async () => {
      await t.go("/");
      await t.say("Match goes the other way: a pick follows a variable that something else set. Here a text box says at night.");
      const txt = await t.addNode("Text (Multiline)", { x: 470, y: 600 });
      await t.click(t.node(txt).locator("textarea").first());
      await t.type("at night", { cps: 12 });
      await t.beat(500);
      const inj = await t.addNode("WP Context Injector", { x: 475, y: 200 });
      await t.say("Wire it into a Context Injector and name it wanted time.");
      await t.wire(txt, "STRING", inj, "input_0");
      await t.beat(600);
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').first(), "wanted_time", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      const ctx = await t.addNode("WP Context", { x: 1010, y: 200 });
      await t.wire(inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Time of day", "Lighting from time"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1560, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $time, $lighting", { cps: 16 });
      await t.beat(600);
      await t.say("Time of day still rolls: dawn, sunset or night. Edit it, and type wanted time into Match variable.");
      const modal = await editItem(ctx, "Time of day");
      const match = modal.locator('[data-test="runtime-match-input"] input, input[data-test="runtime-match-input"]').first();
      await t.scrollTo(match, { at: 0.6 });
      await t.fill(match, "wanted_time", { cps: 14 });
      await t.press("Tab");
      await t.beat(600);
      await t.callout("match", modal.locator('[data-test="runtime-match-hint"]'), "No match: the fallback, else a roll", 6);
      await t.waitVoice();
      await t.uncallout("match");
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(800);
      // The Assembler's preview only sees the Injector's placeholder before a run, so Match has
      // nothing to match there: run, and read the prompt in Preview as Text.
      await t.say("Add Preview as Text for the finished prompt, and run it on a few seeds.");
      const text = await t.addNode("Preview as Text", { x: 1560, y: 600 });
      await t.wire(asm, "prompt", text, "source");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.run();
      await t.beat(600);
      await t.callout("prev", t.node(text), "Always night, always moonlight", 6);
      await t.say("Now time is night on every seed. And Lighting, which reads time, gives moonlight every time: a matched pick drives the rules and constraints after it.");
      for (let i = 0; i < 2; i++) {
        await t.click(plus);
        await t.beat(400);
        await t.run();
        await t.beat(900);
      }
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Match takes the one option whose text equals the variable, so the text has to be written the same. To keep a group of options instead, tag them and filter the Pool by the variable.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Hold keeps a pick for a run. Match makes a pick follow a variable. Next: what happens when nothing fits.");
    });
  },
);
