// Advanced 13: LoRA trigger words. A Text (Multiline) holds a character LoRA's trigger words; the
// Injector names them $lora_character_words, and ComfyUI's Boolean node wired into it sets
// $lora_character. The Character LoRA derivation (from the LoRA swaps bundle) then replaces the
// rolled $subject. Switching the Boolean off brings the rolled subject back.
import { tutorial } from "../tutorial.js";

tutorial(
  "A13",
  {
    title: "LoRA trigger words",
    description: "Bring a LoRA's trigger words into the prompt as a variable, and let a rule swap a rolled character for the LoRA's while a switch is on.",
    learn: "Trigger words through the Injector, the LoRA swaps rules, and switching a swap on and off.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("The trigger words", async () => {
      await t.go("/");
      await t.say("A character LoRA comes with trigger words. Put them in a text box, next to your LoRA loader.");
      const txt = await t.addNode("Text (Multiline)", { x: 470, y: 560 });
      await t.click(t.node(txt).locator("textarea").first());
      await t.type("kara_v2, a young woman with short white hair and a red scarf", { cps: 16 });
      await t.beat(500);
      const inj = await t.addNode("WP Context Injector", { x: 475, y: 200 });
      await t.wire(txt, "STRING", inj, "input_0");
      await t.beat(600);
      await t.waitVoice();
      await t.say("Wire it into an Injector and name it lora character words. Each wired value gets its own variable.");
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').first(), "lora_character_words", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      await t.say("Then the switch: ComfyUI's own Boolean node, wired into the Injector as lora character. It writes true or false.");
      const bool = await t.addNode("Boolean", { x: 470, y: 860 });
      await t.wire(bool, "BOOLEAN", inj, "input_1");
      await t.beat(600);
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').nth(1), "lora_character", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.waitVoice();
      const toggle = t.node(bool).getByRole("switch").first();
      await t.say("Switch it on.");
      await t.click(toggle);
      await t.beat(500);
      await t.waitVoice();
      return { txt, inj, bool, toggle };
    });

    const { prev, textId } = await t.h.step("The swap", async () => {
      // Build first, then name what's on screen.
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 1010, y: 200 });
      await t.wire(nodes.inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Hair", "Eyes", "Subject", "Character LoRA"]);
      await t.normalSpeed();
      await t.say("Now a Context with the role, hair and eyes, the Subject combine, and the Character LoRA rule from the LoRA swaps bundle, after the combine it replaces.");
      await t.waitVoice();
      const asm = await t.addNode("WP Prompt Assembler", { x: 1560, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $subject in a quiet forest", { cps: 16 });
      await t.beat(800);
      await t.waitVoice();
      // The Assembler's own preview only sees the Injector's placeholders before a run: run it and
      // read the prompt in Preview as Text.
      await t.say("Add Preview as Text for the finished prompt, and Run.");
      const text = await t.addNode("Preview as Text", { x: 1560, y: 600 });
      await t.wire(asm, "prompt", text, "source");
      await t.run();
      await t.beat(800);
      // The Assembler's own preview shows only the Injector's placeholders: keep it out of the frame.
      await t.zoomOn(text, { top: 110 });
      const prev = t.node(text);
      await t.callout("prev", prev, "The LoRA's words, not a roll", 6);
      await t.say("While the Boolean is on, the rule puts the trigger words in place of the whole subject, so the rolled role, hair and eyes don't fight the LoRA.");
      await t.waitVoice();
      await t.uncallout("prev");
      return { prev, textId: text };
    });

    await t.h.step("Off again", async () => {
      // Back to the Boolean (the last view left it above the frame), switch it off, then say so.
      await t.zoomOn(nodes.bool);
      await t.click(nodes.toggle);
      await t.beat(600);
      if ((await nodes.toggle.getAttribute("aria-checked").catch(() => null)) === "true") {
        await nodes.toggle.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
        await t.beat(400);
      }
      await t.say("Switch the Boolean off and run again: the rolled subject comes back.");
      await t.run();
      await t.beat(800);
      await t.zoomOn(textId, { top: 110 });
      await t.callout("prev", prev, "Rolled again", 6);
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("The LoRA swaps bundle has two more rules like it: the LoRA's own clothes in place of the outfit, and style words added after the style. The first example workflow wires all three to LoRA loaders and WP Toggles, which can also bypass the loader when its switch is off.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Trigger words become a variable, and a rule decides when they replace a roll. Next: the Var nodes, which turn variables into numbers and settings.");
    });
  },
);
