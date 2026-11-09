// Advanced 10: negatives. An option's negative (plate armor's "rust, broken armor"), a new one on the
// chainmail shirt, the derivation actions that add or replace negatives, the Assembler's negative preview
// coloured by the variable each word came from, and a WP Prompt Cleaner that tidies both outputs.
import { tutorial } from "../tutorial.js";

tutorial(
  "A10",
  {
    title: "Negatives",
    description: "Send words to the negative prompt from the pick that needs them, see where each word came from, and tidy both prompts with the Prompt Cleaner.",
    learn: "Option negatives, Add to / Replace negative, the negative preview, and WP Prompt Cleaner.",
  },
  async (t) => {
    const page = t.page;
    const T = (id: string) => page.locator(`[data-test="${id}"]`).first();

    await t.h.step("A negative on an option", async () => {
      await t.go("/wp/wildcards/195238e2/edit");
      await t.say("A negative belongs to the pick that needs it. In Outfit, the plate armor sends rust and broken armor to the negative prompt, only when the plate armor is picked.");
      await t.scrollTo(T("wc-opt-row-0"), { at: 0.4 });
      await t.callout("neg", T("wc-opt-neg-0"), "Only with plate armor", 6);
      await t.waitVoice();
      await t.uncallout("neg");
      await t.say("Give the chainmail shirt one too: rust and broken rings.");
      await t.click(T("wc-opt-neg-1-add"));
      await t.beat(500);
      await t.click(T("wc-opt-neg-1").getByLabel("Negative for this option"));
      await t.type("rust, broken rings", { cps: 16 });
      await t.beat(600);
      await t.waitVoice();
      await t.say("Save it.");
      await t.click(T("save-btn"));
      await t.beat(1500);
      await t.say("Fixed values and combines take a negative the same way. A derivation has two actions for them: Add to negative, and Replace negative.");
      await t.waitVoice();
    });

    const nodes = await t.h.step("Where each word came from", async () => {
      await t.go("/");
      await t.say("On the canvas, pick Role, the rule that fits the outfit to the role, Outfit, Time of day and Lighting from time.");
      const ctx = await t.addNode("WP Context", { x: 340, y: 170 });
      await t.pickModules(ctx, ["Role", "Outfit fits the role", "Outfit", "Time of day", "Lighting from time"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 890, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role wearing $outfit $time, $lighting, masterpiece, best quality, masterpiece", { cps: 18 });
      await t.beat(600);
      await t.waitVoice();
      const neg = t.node(asm).locator('[data-test="asm-neg-preview"]');
      const plus = t.node(ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
      await t.say("Roll until a knight's armor turns up at night.");
      for (let i = 0; i < 30; i++) {
        const text = (await neg.count()) > 0 ? ((await neg.textContent()) ?? "") : "";
        if (/rust/.test(text) && /overexposed/.test(text)) break;
        await t.click(plus);
        await t.beat(800);
      }
      await t.callout("neg", neg, "Each word in its variable's color", 6);
      await t.say("The negative preview colors each word like the variable it came from: the armor's words, and the night lighting's. Hover a word to see its variable.");
      await t.waitVoice();
      await t.uncallout("neg");
      await t.say("Only variables the prompt prints send their negatives. Hide a variable, and its words stay out.");
      await t.waitVoice();
      // Open the negative box unless it already is (it starts open or folded depending on its text).
      const negToggle = t.node(asm).locator('[data-test="neg-template-toggle"]');
      if ((await negToggle.getAttribute("aria-expanded")) !== "true") await t.click(negToggle);
      await t.beat(500);
      await t.callout("slot", t.node(asm).locator('[data-test="neg-template-box"]'), "Where they go", 6);
      await t.say("They land where the negative box says dollar negatives. A new Assembler starts with it. Take it out, and the negative is only what you write there.");
      await t.waitVoice();
      await t.uncallout("slot");
      return { ctx, asm };
    });

    await t.h.step("Prompt Cleaner", async () => {
      await t.say("Last, the WP Prompt Cleaner. It tidies a prompt before the sampler. Wire both Assembler outputs into it.");
      const cl = await t.addNode("WP Prompt Cleaner", { x: 1410, y: 170 });
      await t.wire(nodes.asm, "prompt", cl, "prompt");
      await t.wire(nodes.asm, "negative", cl, "negative");
      const text = await t.addNode("Preview as Text", { x: 1410, y: 880 });
      await t.wire(cl, "prompt", text, "source");
      await t.waitVoice();
      await t.callout("mode", t.node(cl), "Gentle, Balanced or Aggressive", 4);
      await t.say("Balanced is a safe default: it removes empty brackets, stray commas and repeated tags.");
      await t.waitVoice();
      await t.uncallout("mode");
      await t.say("Run it.");
      await t.run();
      const report = t.node(cl).locator('[data-test="cleaner-last-run"]');
      await t.callout("rep", report, "What it changed", 6);
      await t.say("The repeated masterpiece is gone, and the report says what changed. The blocklist button takes words you never want in a prompt.");
      await t.waitVoice();
      await t.uncallout("rep");
    });

    await t.h.step("Outro", async () => {
      await t.say("Negatives ride with the picks that need them, only reach an Assembler that prints them, and the Cleaner tidies what's left. Next: chaining Contexts.");
    });
  },
);
