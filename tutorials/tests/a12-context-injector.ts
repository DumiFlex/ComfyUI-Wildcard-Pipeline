// Advanced 12: the Context Injector. Two Text (Multiline) nodes stand in for outside values (typed
// text, or a caption from an LLM node); wired into the Injector they become $cloak and $color. A
// template row joins them into $look, the Injector's built-in combine. The Injector feeds a Context
// with Role and Setting, and the Assembler prints all of it.
import { StepError } from "watchwright";
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
      const txt = await t.addNode("Text (Multiline)", { x: 470, y: 560 });
      await t.click(t.node(txt).locator("textarea").first());
      await t.type("hooded travelling cloak", { cps: 16 });
      await t.beat(500);
      const inj = await t.addNode("WP Context Injector", { x: 475, y: 200 });
      await t.waitVoice();
      await t.say("Wire it into the Injector. A row appears for it: name it cloak.");
      await t.wire(txt, "STRING", inj, "input_0");
      await t.beat(700);
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').first(), "cloak", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      await t.say("A second text box with a colour, wired in below it, becomes color. Each wired value gets its own row and its own variable.");
      const txt2 = await t.addNode("Text (Multiline)", { x: 470, y: 860 });
      await t.click(t.node(txt2).locator("textarea").first());
      await t.type("deep red", { cps: 16 });
      await t.beat(400);
      await t.wire(txt2, "STRING", inj, "input_1");
      await t.beat(700);
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').nth(1), "color", { cps: 14 });
      await t.press("Tab");
      await t.beat(500);
      await t.waitVoice();
      return { txt, inj };
    });

    await t.h.step("A template row", async () => {
      await t.say("A template row is the Injector's own combine: it joins the other rows into one variable. Add one, name it look, then right-click it, Edit, and write its template.");
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
      await t.type("a $color $cloak with a silver clasp", { cps: 14 });
      await t.beat(600);
      const typed = await page.locator('[data-test="ibm-template"]').innerText().catch(() => "");
      if (!/silver clasp/.test(typed)) throw new StepError("The look row's template didn't take the typing.");
      await t.callout("prev", page.locator('[data-test="ibm-preview"]'), "What $look will be", 6);
      await t.waitVoice();
      await t.uncallout("prev");
      const negField = page.locator('[data-test="ibm-negative"]');
      if (await negField.isVisible().catch(() => false)) await t.callout("negf", negField, "Its own negative", 6);
      await t.say("It also takes a negative, like any other source.");
      await t.waitVoice();
      await t.uncallout("negf");
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
    });

    await t.h.step("Into a Context", async () => {
      await t.say("Wire the Injector into a Context's upstream, so its variables join the picks there.");
      const ctx = await t.addNode("WP Context", { x: 1010, y: 200 });
      await t.wire(nodes.inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Setting"]);
      await t.waitVoice();
      await t.say("Pick Role and Setting, then an Assembler that prints the role, the look and the place.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1560, y: 200 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role in $look, $setting", { cps: 16 });
      await t.beat(800);
      // Before a run the Assembler's preview shows $look as a placeholder: run, and read the prompt.
      await t.say("Add Preview as Text for the finished prompt, and Run.");
      const text = await t.addNode("Preview as Text", { x: 1560, y: 600 });
      await t.wire(asm, "prompt", text, "source");
      await t.run();
      await t.beat(800);
      // The Assembler's own preview shows only the Injector's placeholders: keep it out of the frame.
      await t.zoomOn(text, { top: 110 });
      await t.callout("prev", t.node(text), "Your text, inside the rolled prompt", 6);
      await t.waitVoice();
      await t.say("The role and the place still roll. The cloak is whatever the text boxes say, so change a text and the prompt follows.");
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Outro", async () => {
      await t.say("Anything you can wire, you can name, and a template row joins them. A list can follow one too, with Match variable or a Pool filtered by it. Next: LoRA trigger words.");
    });
  },
);
