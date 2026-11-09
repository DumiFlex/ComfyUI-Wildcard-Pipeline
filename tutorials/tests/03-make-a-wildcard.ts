// Tutorial 3: make your own wildcard. A Weather wildcard in the manager: name and variable, two
// options by hand, three more with Bulk add, a lower weight on two of them with Bulk edit, then
// used on the canvas next to Role.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T03",
  {
    title: "Make your own wildcard",
    description: "A new Weather wildcard in the manager: options by hand and with Bulk add, weights with Bulk edit, then rolled in a prompt on the canvas.",
    learn: "Make a wildcard, add options by hand and in bulk, change several rows at once, save it and use its $variable in a template.",
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
      await t.say("Now the options. Each prompt rolls one of them. Type the first two by hand.");
      const words = ["light rain", "thick fog"];
      for (let i = 0; i < words.length; i++) {
        await t.click(value(i));
        await t.type(words[i] as string, { cps: 18 });
      }
      await t.beat(500);
      await t.waitVoice();
    });

    await t.h.step("Bulk add", async () => {
      await t.say("For a longer list, Bulk add is faster. Press Bulk edit, then Bulk add.");
      await t.click(page.locator('[data-test="wc-bulk-toggle"]'));
      await t.beat(500);
      await t.click(page.locator('[data-test="wc-bulk-add"]'));
      await t.beat(800);
      const panel = page.locator(".wpc-bulk-panel").first();
      await t.callout("panel", panel, "One option per line", 6);
      await t.say("Paste or type one option per line. A line can also carry tags, a weight and negative words; the hint above shows how.");
      await t.click(panel.getByLabel("Bulk paste"));
      await t.type("bright sunshine\nfalling snow\na howling thunderstorm", { cps: 18 });
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("panel");
      await t.say("It counts what it will add. Add them.");
      await t.click(panel.getByRole("button", { name: /^Add \d+ option/ }));
      await t.beat(900);
      await t.waitVoice();
    });

    await t.h.step("Bulk edit", async () => {
      await t.say("Snow and the thunderstorm should be rare. Tick both rows.");
      await t.click(page.locator('[data-test="wc-opt-check-3"]'));
      await t.click(page.locator('[data-test="wc-opt-check-4"]'));
      await t.beat(500);
      const bar = page.locator(".wpc-seltoolbar").first();
      await t.callout("bar", bar, "Change every ticked row at once", 4);
      await t.say("This bar changes every ticked row at once: tags, weight, negatives, order, or delete.");
      await t.waitVoice();
      await t.uncallout("bar");
      await t.say("Set their weight to a half. Their chance drops, and the others share the rest.");
      await t.click(bar.getByRole("button", { name: /Set weight/ }));
      await t.beat(400);
      await t.fill(page.locator('[data-test="sel-weight-menu"] input').first(), "0.5");
      await t.click(page.locator('[data-test="sel-weight-menu"]').getByRole("button", { name: "Apply" }));
      await t.beat(700);
      await t.click(page.locator('[data-test="wc-bulk-toggle"]'));
      await t.beat(500);
      await t.callout("odds", [row(0), row(4)], "Chances follow the weights", 4);
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
      await t.say("Back on the canvas, add a Context node and pick Role and Weather.");
      await t.beat(800);
      const ctx = await t.addNode("WP Context", { x: 520, y: 200 });
      await t.pickModules(ctx, ["Role", "Weather"]);
      await t.say("Add a Prompt Assembler, wire it up, and write the template.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role standing in $weather.");
      await t.beat(1000);
      await t.say("Change the seed, and the weather rolls with the role.");
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
