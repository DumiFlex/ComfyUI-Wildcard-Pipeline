// Advanced 13: LoRA trigger words. A Text (Multiline) holds a character LoRA's trigger words; the
// Injector names them $lora_hero_words and a template row sets $lora_character = true. The Character
// LoRA derivation (from the LoRA swaps bundle) then replaces the rolled hero and clears hair and eyes.
// Unticking the switch row brings the rolled hero back.
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
      const txt = await t.addNode("Text (Multiline)", { x: 270, y: 560 });
      await t.click(t.node(txt).locator("textarea").first());
      await t.type("kara_v2, short white hair, red scarf", { cps: 16 });
      await t.beat(500);
      const inj = await t.addNode("WP Context Injector", { x: 275, y: 200 });
      await t.wire(txt, "STRING", inj, "input_0");
      await t.beat(600);
      await t.waitVoice();
      await t.say("Wire it into an Injector and name it lora hero words.");
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').first(), "lora_hero_words", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      await t.say("Then a switch: a template row named lora character, set to true. A WP Toggles switch can drive this too, as in Switches.");
      await t.click(t.node(inj).locator('[data-test="inj-add-general"]'));
      await t.beat(500);
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').last(), "lora_character", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(t.node(inj).locator('[data-test="inj-row-general-tag"]').last(), { right: true });
      await t.beat(500);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(800);
      await t.click(page.locator('[data-test="ibm-template"]').locator('[contenteditable="true"], textarea').first());
      await t.type("true", { cps: 12 });
      await t.beat(400);
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
      await t.waitVoice();
      return { txt, inj };
    });

    const prev = await t.h.step("The swap", async () => {
      await t.say("Now a Context with the hero, hair and eyes, and the Character LoRA rule from the LoRA swaps bundle.");
      const ctx = await t.addNode("WP Context", { x: 800, y: 200 });
      await t.wire(nodes.inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Hero", "Hair", "Eyes", "Character LoRA"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1350, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero, $hair, $eyes, in a quiet forest", { cps: 16 });
      await t.beat(800);
      await t.waitVoice();
      const prev = t.node(asm).locator('[data-test="asm-preview"]');
      await t.callout("prev", prev, "The LoRA's words, not a roll", 6);
      await t.say("While the switch is on, the rule puts the trigger words in place of the hero, and the rolled hair and eyes step aside, so they don't fight the LoRA.");
      await t.waitVoice();
      await t.uncallout("prev");
      return prev;
    });

    await t.h.step("Off again", async () => {
      await t.say("Untick the switch row, and the rolled hero, hair and eyes come back.");
      await t.click(t.node(nodes.inj).locator('[data-test="inj-row-enabled"]').last());
      await t.beat(900);
      await t.callout("prev", prev, "Rolled again", 6);
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("The LoRA swaps bundle has two more rules like it: the LoRA's own clothes in place of the outfit, and style words added after the style. The first example workflow wires all three to LoRA loaders and switches.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Trigger words become a variable, and a rule decides when they replace a roll. Next: the Var nodes, which turn variables into numbers and settings.");
    });
  },
);
