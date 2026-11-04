// Advanced 5: hold and match. A Context Loop runs four frames; Hold across run keeps Hero's pick on
// every frame while the rest re-roll. Then Match variable: an Injector writes $wanted_time = night and
// Time of day matches it, so the Lighting derivation that reads $time follows.
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
      const loop = await t.addNode("WP Context Loop", { x: 90, y: 170 });
      const ctx = await t.addNode("WP Context", { x: 560, y: 170 });
      await t.wire(loop, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Hero", "Outfit", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1040, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero wearing $outfit, $setting", { cps: 16 });
      await t.beat(600);
      const text = await t.addNode("Preview as Text", { x: 1490, y: 170 });
      await t.wire(asm, "prompt", text, "source");
      await t.waitVoice();
      await t.say("Set the count to four, and Run.");
      const more = t.node(loop).locator('[data-widget-name="count"] button').last();
      for (let i = 0; i < 3; i++) {
        await t.click(more);
        await t.beat(350);
      }
      await t.run();
      await t.callout("out", t.node(text), "Four frames, four heroes", 6);
      await t.say("Four prompts, and a new hero in each.");
      await t.waitVoice();
      await t.uncallout("out");
      return { loop, ctx, asm, text };
    });

    await t.h.step("Hold across run", async () => {
      await t.say("For a story, the hero should stay the same. Right-click Hero, Edit, and switch on Hold across run.");
      const modal = await editItem(nodes.ctx, "Hero");
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
      await t.callout("out", t.node(nodes.text), "Same hero, new outfit and place", 6);
      await t.say("The same hero in every frame, while the outfit and the place still change. A new seed picks a new hero for the next run.");
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Match a variable", async () => {
      await t.go("/");
      await t.say("Match goes the other way: a pick follows a variable that something else set. Here a Context Injector sets wanted time to night.");
      const inj = await t.addNode("WP Context Injector", { x: 160, y: 170 });
      await t.click(t.node(inj).locator('[data-test="inj-add-general"]'));
      await t.beat(500);
      await t.type("wanted_time", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(t.node(inj).locator('[data-test="inj-row-summary"]').first(), { right: true });
      await t.beat(500);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(800);
      await t.click(page.locator('[data-test="ibm-template"]').locator('[contenteditable="true"], textarea').first());
      await t.type("night", { cps: 12 });
      await t.beat(500);
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
      await t.waitVoice();
      const ctx = await t.addNode("WP Context", { x: 640, y: 170 });
      await t.wire(inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Hero", "Time of day", "Lighting from time"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero at $time, $lighting", { cps: 16 });
      await t.beat(600);
      await t.say("Time of day still rolls: dawn, golden hour or night. Edit it, and type wanted time into Match variable.");
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
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.callout("prev", t.node(asm).locator('[data-test="asm-preview"]'), "Always night, always moonlight", 6);
      await t.say("Now time is night on every seed. And Lighting, which reads time, gives moonlight every time: a matched pick drives the rules and constraints after it.");
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Match is how a model, a LoRA or your own typed text can steer a pack. WP Model Info sets model variables for exactly this.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Hold keeps a pick for a run. Match makes a pick follow a variable. Next: what happens when nothing fits.");
    });
  },
);
