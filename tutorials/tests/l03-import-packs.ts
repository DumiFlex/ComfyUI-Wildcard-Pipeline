// Library 3: import a wildcard pack. Three A1111-style .txt files from tutorials/assets/pack (weather,
// creature, and scene, which reads __creature__ and __weather__) go through Wildcard packs: load,
// review the plan (roles, how each list carries over, settings), pick and import. Then scene is used
// on the canvas: its references roll creature and weather.
import path from "node:path";
import { tutorial } from "../tutorial.js";


tutorial(
  "L03",
  {
    title: "Import wildcard packs",
    description: "Bring wildcard files from A1111, Forge, Dynamic Prompts or Impact Pack into your library, with their references kept.",
    learn: "Load pack, review the plan, import settings, pick and import, and Undo.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Load a pack", async () => {
      await t.go("/wp/import-export");
      await t.say("Have wildcard text files from another tool? Open Import, Export, and the Wildcard packs tab.");
      await t.click(page.locator('[data-test="io-tab-packs"]'));
      await t.beat(800);
      await t.say("Drop a folder or a zip here, or choose files. These three are plain lists, one option per line. Scene reads the other two by name.");
      const chooser = page.waitForEvent("filechooser");
      await t.click(page.locator('[data-test="pack-pick-files"]'));
      await (await chooser).setFiles(["weather.txt", "creature.txt", "scene.txt"].map((f) => path.join(t.packDir, "assets", "pack", f)));
      await t.beat(1500);
      await t.waitVoice();
    });

    await t.h.step("Review the plan", async () => {
      await t.callout("plan", page.locator('[data-test="pack-plan"]'), "What each list becomes", 6);
      await t.say("The plan shows what each file becomes. Scene is an entry point, the one you'd put in a prompt. Creature and weather are vocabulary it draws from.");
      await t.waitVoice();
      await t.uncallout("plan");
      await t.callout("fid", page.locator('[data-test="pack-fidelity-exact"]'), "Carries over exactly", 4);
      await t.say("And how each one carries over: exact here. Syntax this pipeline reads differently is marked close or needs a look.");
      await t.waitVoice();
      await t.uncallout("fid");
      await t.say("Name the pack, and pick the tool the files were written for if Detect gets it wrong.");
      await t.fill(page.locator('[data-test="pack-name"]'), "Creatures", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.callout("set", page.locator('[data-test="pack-settings"]'), "Name, tag, category, dialect", 4);
      await t.waitVoice();
      await t.uncallout("set");
      await t.say("Apply the settings.");
      await t.click(page.locator('[data-test="pack-apply"]'));
      await t.beat(1200);
    });

    await t.h.step("Pick and import", async () => {
      await t.say("Continue, and tick what to import. All three are ticked.");
      await t.click(page.locator('[data-test="pack-continue"]'));
      await t.beat(1200);
      await t.callout("pick", page.locator('[data-test="import-picker-selected-count"]'), "3 of 3", 3);
      await t.waitVoice();
      await t.uncallout("pick");
      await t.click(page.locator('[data-test="import-picker-continue"]'));
      await t.beat(1500);
      await t.callout("toast", page.locator('[data-test="toast"]').last(), "Imported, with Undo", 4);
      await t.say("Imported. One Undo takes the whole pack back out.");
      await t.waitVoice();
      await t.uncallout("toast");
    });

    await t.h.step("Use it", async () => {
      await t.go("/");
      // The node goes in first, so the line plays over it and the picking.
      const ctx = await t.addNode("WP Context", { x: 400, y: 200 });
      await t.say("On the canvas, pick scene in a Context. Its references to creature and weather became wildcard references, so they roll too.");
      await t.pickModules(ctx, ["scene"]);
      await t.waitVoice();
      const asm = await t.addNode("WP Prompt Assembler", { x: 1000, y: 200 });
      await t.say("Then an Assembler that prints the scene, in oil paint.");
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$scene, oil painting", { cps: 16 });
      await t.beat(800);
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.waitVoice();
      await t.callout("prev", t.node(asm).locator('[data-test="asm-preview"]'), "A creature, in some weather", 6);
      await t.say("Change the seed: a creature, in some weather, every time.");
      for (let i = 0; i < 3; i++) {
        await t.click(plus);
        await t.beat(1000);
      }
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Outro", async () => {
      await t.say("Load a pack, check the plan, import, and its lists work like your own. Next: sharing and publishing.");
    });
  },
);
