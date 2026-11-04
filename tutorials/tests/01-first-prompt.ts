// Tutorial 1: your first random prompt. Context node, three wildcards from the library, an
// Assembler template, a new seed, and WP Debug to see the picks after a run. No model needed.
import { tutorial } from "../tutorial.js";

tutorial(
  "T01",
  {
    title: "Your first random prompt",
    description: "A Context node with three wildcards, a Prompt Assembler template, a new seed, and WP Debug after a run.",
    learn: "Add a Context node, pick wildcards from the library, write a template with $variables and roll new prompts with the seed.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Intro", async () => {
      await t.say("Wildcard Pipeline builds random prompts from lists you keep in a library. Let's make a first one.");
      await t.beat(400);
    });

    const ctx = await t.h.step("Add a Context node", async () => {
      await t.say("Double-click the canvas and search for WP Context.");
      const id = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.say("A Context node holds the lists that roll. Add module picks them from your library.");
      await t.click(t.node(id).locator('[data-testid="open-picker"]'));
      return id;
    });

    await t.h.step("Pick three wildcards", async () => {
      await t.say("Tick Hero, Outfit and Setting, then add them.");
      for (const name of ["Hero", "Outfit", "Setting"]) {
        const row = page.locator('[data-test^="picker-row-"]').filter({ hasText: new RegExp(`^\\s*${name}\\b`) }).first();
        await t.click(row.locator('[data-test="picker-checkbox"]').first());
      }
      await t.beat(300);
      await t.click(page.locator('[data-test="picker-add-btn"]'));
      await t.beat(800);
      await t.callout("mods", t.node(ctx), "Each list rolls one option into a variable");
      await t.say("Each one rolls one option and keeps it in a variable: hero, outfit and setting.");
      await t.waitVoice();
      await t.uncallout("mods");
    });

    const asm = await t.h.step("Add a Prompt Assembler", async () => {
      await t.say("Next, a WP Prompt Assembler. It writes the prompt.");
      return t.addNode("WP Prompt Assembler", { x: 1340, y: 170 });
    });

    await t.h.step("Wire them", async () => {
      await t.say("Drag a wire from context to context.");
      await t.wire(ctx, "context", asm, "context");
    });

    await t.h.step("Write the template", async () => {
      await t.say("Type a template. Each dollar-sign name is replaced by what its list rolled.");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("photo of $hero wearing $outfit, $setting");
      await t.beat(1200);
      await t.callout("preview", t.node(asm), "A live preview of the prompt");
      await t.say("The Assembler shows the prompt it will write, before you run anything.");
      await t.waitVoice();
      await t.uncallout("preview");
    });

    await t.h.step("Roll again with the seed", async () => {
      await t.say("Change the seed, and every list rolls again.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(900);
      }
    });

    await t.h.step("See the picks with WP Debug", async () => {
      await t.say("Add WP Debug to see what each list picked when the workflow runs.");
      const dbg = await t.addNode("WP Debug", { x: 1340, y: 640 });
      await t.wire(ctx, "context", dbg, "context");
      await t.say("Press Run.");
      await t.run();
      await t.callout("debug", t.node(dbg), "What each list picked");
      await t.say("Debug lists every variable and the option it rolled.");
      await t.waitVoice();
      await t.uncallout("debug");
    });

    await t.h.step("Outro", async () => {
      await t.say("That's it: a new prompt for every seed. Next, we'll make a wildcard of our own.");
    });
  },
);
