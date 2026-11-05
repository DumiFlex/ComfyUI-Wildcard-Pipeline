// Tutorial 3: make your own wildcard. A Weather wildcard in the manager (name, variable, four
// options, a lower weight), then used on the canvas next to Hero.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T03",
  {
    title: "Make your own wildcard",
    description: "A new Weather wildcard in the manager, with four options and a lower weight on one, then rolled in a prompt on the canvas.",
    learn: "Make a wildcard, set option weights, save it and use its $variable in a template.",
  },
  async (t) => {
    const page = t.page;
    const row = (i: number) => page.locator(`[data-test="wc-opt-row-${i}"]`);
    const value = (i: number) => row(i).locator(".wp-rt__host").first();

    await t.h.step("A new wildcard", async () => {
      await t.go("/wp/wildcards");
      await t.say("Let's make a wildcard for the weather. In the manager, open Wildcards and press New Wildcard.");
      await t.beat(600);
      await t.click(page.getByRole("button", { name: /New Wildcard/ }).first());
      await t.beat(900);
      await t.say("Give it a name. The variable name follows on its own.");
      await t.fill(page.locator('[data-test="identity-name"]'), "Weather");
      await t.beat(400);
      await t.callout("var", page.locator('[data-test="identity-var-binding"]'), "Templates read it as $weather", 6);
      await t.waitVoice();
      await t.uncallout("var");
    });

    await t.h.step("Its options", async () => {
      await t.scrollTo(page.getByText(/^Options \(\d+\)$/).first());
      await t.say("Now the options: one per line. Each prompt rolls one of them.");
      const words = ["light rain", "thick fog", "clear skies", "falling snow"];
      for (let i = 0; i < words.length; i++) {
        if (i >= 2) {
          await t.click(page.locator('[data-test="wc-add-opt"]'));
          await t.beat(300);
        }
        await t.click(value(i));
        await t.type(words[i] as string, { cps: 18 });
      }
      await t.beat(500);
    });

    await t.h.step("Weights", async () => {
      await t.say("Snow should be rare, so give it a weight of a half. Its chance drops, and the others share the rest.");
      await t.fill(row(3).locator("input.wp-cnum__field"), "0.5");
      await t.press("Tab");
      await t.beat(600);
      await t.callout("odds", [row(0), row(3)], "Chances follow the weights", 4);
      await t.waitVoice();
      await t.uncallout("odds");
    });

    await t.h.step("Save", async () => {
      await t.say("Save it, and it's in your library.");
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1500);
    });

    const asm = await t.h.step("Use it in a prompt", async () => {
      await t.go("/");
      await t.say("Back on the canvas, add a Context node and pick Hero and Weather.");
      await t.beat(800);
      const ctx = await t.addNode("WP Context", { x: 520, y: 200 });
      await t.pickModules(ctx, ["Hero", "Weather"]);
      await t.say("Add a Prompt Assembler, wire it up, and write the template.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero walking through $weather");
      await t.beat(1000);
      await t.say("Change the seed, and the weather rolls with the hero.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 4; i++) {
        await t.click(plus);
        await t.beat(900);
      }
      return { ctx, asm };
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("Here's what those prompts make, run through a model.");
        const plus = t.node(asm.ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
        await t.say("First, add WP Debug under the Context, so every run shows what it rolled.");
        const dbg = await addDebugUnder(t, asm.ctx);
        await showcase(t, { from: asm.asm, preview: { x: 1340, y: 380, width: 420, height: 610 }, chain: { x: 1820, y: 900 }, between: () => t.click(plus) });
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.say("Debug shows the picks behind the last picture, so you can see the prompt change from run to run.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Your own lists work just like the ones you install. Next: fixed values and combines.");
    });
  },
);
