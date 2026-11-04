// Advanced 12: the Context Injector. A Text (Multiline) node stands in for an outside value (typed
// text, or a caption from an LLM node); wired into the Injector it becomes $outfit. A template row
// composes $look from it. The Injector feeds a Context with Hero and Setting, and the Assembler prints
// all of it. Run, with Preview as Text.
import { tutorial } from "../tutorial.js";

tutorial(
  "A12",
  {
    title: "Context Injector",
    description: "Turn any value on the canvas into a $variable: text you type, a caption from another node, a LoRA name or a number.",
    learn: "Injector rows, naming a wired value, template rows, and feeding the result into a Context.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("Any value, as a variable", async () => {
      await t.go("/");
      await t.say("The Context Injector turns any value on the canvas into a variable. Here, a text box. It could as well be a caption from an LLM node, a LoRA name or a number.");
      const txt = await t.addNode("Text (Multiline)", { x: 270, y: 560 });
      await t.click(t.node(txt).locator("textarea").first());
      await t.type("a red hoodie and ripped jeans", { cps: 16 });
      await t.beat(500);
      const inj = await t.addNode("WP Context Injector", { x: 275, y: 200 });
      await t.waitVoice();
      await t.say("Wire it into the Injector. A row appears for it: name it outfit.");
      await t.wire(txt, "STRING", inj, "input_0");
      await t.beat(700);
      const bind = t.node(inj).locator('[data-test="inj-row-binding"] input').first();
      await t.fill(bind, "outfit", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      return { txt, inj };
    });

    await t.h.step("A template row", async () => {
      await t.say("A template row builds a variable from others. Add one, name it look, then right-click it, Edit, and write its template.");
      await t.click(t.node(nodes.inj).locator('[data-test="inj-add-general"]'));
      await t.beat(500);
      await t.fill(t.node(nodes.inj).locator('[data-test="inj-row-binding"] input').last(), "look", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(t.node(nodes.inj).locator('[data-test="inj-row-general-tag"]').last(), { right: true });
      await t.beat(500);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(800);
      await t.click(page.locator('[data-test="ibm-template"]').locator('[contenteditable="true"], textarea').first());
      await t.type("streetwear: $outfit, white sneakers", { cps: 14 });
      await t.beat(600);
      await t.callout("prev", page.locator('[data-test="ibm-preview"]'), "What $look will be", 6);
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("It also takes a negative, like any other source.");
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
      await t.waitVoice();
    });

    await t.h.step("Into a Context", async () => {
      await t.say("Wire the Injector into a Context's upstream, so its variables join the picks there.");
      const ctx = await t.addNode("WP Context", { x: 800, y: 200 });
      await t.wire(nodes.inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Hero", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1350, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero in $look, $setting", { cps: 16 });
      await t.beat(800);
      await t.callout("prev", t.node(asm).locator('[data-test="asm-preview"]'), "Your text, inside the rolled prompt", 6);
      await t.waitVoice();
      await t.say("The hero and the place still roll. The outfit is whatever the text box says, so change the text and the prompt follows.");
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Outro", async () => {
      await t.say("Anything you can wire, you can name and use in a template. For choices that should follow it, use Match variable from Hold and match. Next: LoRA trigger words.");
    });
  },
);
