// Get started 2: your first random prompt. Context node, Role, Hair and Setting from the library,
// an Assembler template, Preview as Text for the finished prompt, WP Debug introduced, then three
// seeds run one after another. No model needed.
import { tutorial } from "../tutorial.js";

tutorial(
  "T02",
  {
    title: "Your first random prompt",
    description: "A Context node with three wildcards, a Prompt Assembler template, the finished prompt, WP Debug, and a few seeds.",
    learn: "Add a Context node, pick wildcards from the library, write a template with $variables and roll new prompts with the seed.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Intro", async () => {
      await t.say("Wildcard Pipeline builds random prompts from the lists in your library. With the tutorial library in, let's make a first one, see the prompt it writes, and roll a few more.");
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
      await t.say("Tick Role, Hair and Setting, then add them.");
      for (const name of ["Role", "Hair", "Setting"]) {
        const row = page.locator('[data-test^="picker-row-"]').filter({ hasText: new RegExp(`^\\s*${name}\\b`) }).first();
        await t.click(row.locator('[data-test="picker-checkbox"]').first());
      }
      await t.beat(300);
      await t.click(page.locator('[data-test="picker-add-btn"]'));
      await t.beat(800);
      await t.callout("mods", t.node(ctx), "Each list rolls one option into a variable");
      await t.say("Each one rolls one option and keeps it in a variable: role, hair and setting.");
      await t.waitVoice();
      await t.uncallout("mods");
      const seedButtons = t.node(ctx).getByRole("button", { name: /increment|decrement|increase|decrease/i });
      await t.callout("seed", [seedButtons.first(), seedButtons.last()], "The seed", 8);
      await t.say("The seed at the top decides what they roll. The same seed always gives the same picks.");
      await t.waitVoice();
      await t.uncallout("seed");
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
      await t.type("A painting of $role with $hair, $setting.");
      await t.beat(1200);
      await t.callout("preview", t.node(asm), "A live preview of the prompt");
      await t.say("The Assembler shows the prompt it will write, before you run anything.");
      await t.waitVoice();
      await t.uncallout("preview");
    });

    const dbg = await t.h.step("See the prompt and the picks", async () => {
      await t.say("To read the finished prompt after a run, add Preview as Text and wire the Assembler's prompt into it.");
      const text = await t.addNode("Preview as Text", { x: 1340, y: 640 });
      await t.wire(asm, "prompt", text, "source");
      await t.say("And add WP Debug. It shows everything the Context did when the workflow runs.");
      const dbg = await t.addNode("WP Debug", { x: 520, y: 640 });
      await t.page.evaluate((id) => {
        const n = window.app?.graph?.getNodeById(Number(id)) as { size: [number, number] } | null | undefined;
        if (n) n.size = [640, 520];
        window.app?.canvas?.setDirty(true, true);
      }, dbg);
      await t.wire(ctx, "context", dbg, "context");
      await t.say("Press Run.");
      await t.run();
      await t.beat(800);
      await t.callout("text", t.node(text), "The prompt this run wrote", 4);
      await t.say("Here is the prompt this run wrote.");
      await t.waitVoice();
      await t.uncallout("text");
      return dbg;
    });

    await t.h.step("WP Debug", async () => {
      const view = () => t.node(dbg);
      await t.callout("head", view().locator('[data-test="dbg-head"]'), "Status and seed", 4);
      await t.say("WP Debug starts with the run's status and the seed it used.");
      await t.waitVoice();
      await t.uncallout("head");
      await t.callout("vars", view().locator('[data-test="dbg-vars"]'), "Name, value, who set it", 4);
      await t.say("Variables lists each variable, the value it got, and the item that set it.");
      await t.waitVoice();
      await t.uncallout("vars");
      await t.say("Trace shows every step in order, and Warnings explains a result that looks wrong. A later video goes through them.");
      await t.click(view().locator('[data-test="dbg-tab-trace"]'));
      await t.beat(1500);
      await t.click(view().locator('[data-test="dbg-tab-vars"]'));
      await t.waitVoice();
    });

    await t.h.step("Roll again with the seed", async () => {
      await t.say("Now change the seed and run again. Every list rolls again, and the prompt changes with it.");
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(500);
        await t.run();
        await t.beat(1800);
      }
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("That's it: a new prompt for every seed. Next, we'll make a wildcard of our own.");
    });
  },
);
