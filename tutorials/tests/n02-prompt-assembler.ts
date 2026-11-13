// Nodes 2: WP Prompt Assembler in depth. A Context (Role, Hair, Setting) into an Assembler. Typing $
// opens the variable list; a name no node sets shows as unresolved and prints nothing; $$ prints a
// dollar sign. The coloured preview and the variable chips. Two Assemblers on one Context: a long
// and a short prompt from the same picks. The preview against the real prompt after a Run. A04
// already shows .0 / .GROUP / .neg and A10 the negative box. Prompt-only: no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N02",
  {
    title: "WP Prompt Assembler in depth",
    description: "Writing templates in the Assembler: the variable list, missing names, $$, the coloured preview, two prompts from one Context, and preview against run.",
    learn: "Autocomplete, unresolved variables, $$, the preview and chips, several Assemblers per Context, preview vs the run's prompt.",
  },
  async (t) => {
    const page = t.page;
    const box = (asm: string) => t.node(asm).locator("textarea, [contenteditable='true']").first();
    const preview = (asm: string) => t.node(asm).locator('[data-test="asm-preview"]');
    const previewText = (asm: string) => preview(asm).innerText().catch(() => "");
    const waitPreview = async (asm: string, re: RegExp, yes = true) => {
      for (let i = 0; i < 20; i++) {
        if (re.test(await previewText(asm)) === yes) return;
        await t.beat(300);
      }
      throw new StepError(`The Assembler preview ${yes ? "never showed" : "still shows"} ${re}.`);
    };

    const n = await t.h.step("The variable list", async () => {
      await t.go("/");
      await t.speedUp();
      const ctx = await t.addNode("WP Context", { x: 480, y: 170 });
      await t.pickModules(ctx, ["Role", "Hair", "Setting"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1150, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.normalSpeed();
      await t.say("The Assembler turns variables into a prompt. Click its template and type A painting of, then a dollar sign.");
      await t.click(box(asm));
      await t.type("A painting of $", { cps: 16 });
      await t.beat(700);
      await t.waitVoice();
      const list = page.getByRole("listbox").last();
      if (await list.isVisible().catch(() => false)) {
        await t.callout("list", list, "Every variable upstream", 6);
        await t.say("A dollar sign opens the list of every variable the nodes before it set. Keep typing to narrow it.");
        await t.waitVoice();
        await t.uncallout("list");
      }
      await t.type("role with $hair, $setting", { cps: 16 });
      await t.press("Escape");
      await waitPreview(asm, /^A painting of .+ with .+,/);
      return { ctx, asm };
    });

    await t.h.step("The preview and the chips", async () => {
      await t.callout("prev", preview(n.asm), "Each word in its variable's color", 6);
      await t.say("The preview shows what this seed prints, each part in its variable's color. It updates as you type and as the seed changes.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.say("Above it, a chip for each variable. Click a chip to put it in the template; right-click it for more.");
      await t.waitVoice();
    });

    await t.h.step("A name nothing sets", async () => {
      await t.say("Type a variable no node sets: dollar mood.");
      await t.click(box(n.asm));
      await t.press("ControlOrMeta+End");
      await t.type(", $mood", { cps: 16 });
      await t.press("Escape");
      await t.beat(800);
      await t.waitVoice();
      const status = t.node(n.asm).locator('[data-test="asm-preview-status"]');
      await t.callout("st", status, "1 unresolved", 5);
      await t.say("The Assembler says it's unresolved, and marks the name. Run anyway and it prints nothing there; the Prompt Cleaner tidies the comma it leaves.");
      await t.waitVoice();
      await t.uncallout("st");
      await t.click(box(n.asm));
      await t.press("ControlOrMeta+End");
      for (let i = 0; i < 7; i++) await t.press("Backspace");
      await t.press("Escape");
      await t.beat(500);
    });

    await t.h.step("A real dollar sign", async () => {
      await t.say("For a real dollar sign, write two. Type: on a 5 dollar coin, with two dollar signs.");
      await t.click(box(n.asm));
      await t.press("ControlOrMeta+End");
      await t.type(", on a $$5 coin", { cps: 16 });
      await t.press("Escape");
      await waitPreview(n.asm, /\$5 coin/);
      await t.callout("prev", preview(n.asm), "One dollar sign", 5);
      await t.waitVoice();
      await t.say("Two dollar signs print one, and the 5 is just text.");
      await t.waitVoice();
      await t.uncallout("prev");
    });

    await t.h.step("Parts of a pick", async () => {
      await t.say("A variable can also be read in parts. Dot zero is a list's first pick, dot one the second, a group's name in capitals prints the pick from that group, and dot neg prints the variable's negative words. The Pick parts video goes through each.", "A variable can also be read in parts. Dot zero is a list's first pick, dot one the second, a group's name in capitals prints the pick from that group, and dot neg prints the variable's negative words. The Pick parts video goes through each.");
      await t.waitVoice();
    });

    await t.h.step("The negative box", async () => {
      const toggle = t.node(n.asm).locator('[data-test="neg-template-toggle"]');
      if ((await toggle.getAttribute("aria-expanded").catch(() => "true")) !== "true") await t.click(toggle);
      await t.beat(500);
      const negBox = t.node(n.asm).locator('[data-test="neg-template-box"]');
      await t.callout("nb", negBox, "negative_template", 5);
      await t.say("Under the template, the negative box: negative_template. It starts with dollar negatives, where the negative words of every variable this template prints go.", "Under the template, the negative box: the negative template. It starts with dollar negatives, where the negative words of every variable this template prints go.");
      await t.waitVoice();
      await t.uncallout("nb");
      await t.say("Add your own standing words after it: blurry, lowres.");
      await t.click(negBox.locator("textarea, [contenteditable='true']").first());
      await t.press("ControlOrMeta+End");
      await t.type(", blurry, lowres", { cps: 16 });
      await t.press("Escape");
      await t.beat(700);
      await t.waitVoice();
      const negPrev = t.node(n.asm).locator('[data-test="asm-neg-preview"]');
      if (await negPrev.isVisible().catch(() => false)) {
        await t.callout("np", negPrev, "The negative, previewed", 5);
        await t.say("The negative preview shows the result, each word in its variable's colour. A variable this template doesn't print sends no negative words.");
        await t.waitVoice();
        await t.uncallout("np");
      }
      await t.say("Take dollar negatives out, and the negative is only what you write. Leave the box empty, and there's no negative at all.");
      await t.waitVoice();
    });

    await t.h.step("Inputs, outputs and the toolbar", async () => {
      await t.say("context (in) takes any WP node's context. prompt (out) goes to CLIP Text Encode or a Prompt Cleaner, negative (out) to your negative encoder. The template itself can also come from another node's text.", "The context input takes any WP node's context. The prompt output goes to CLIP Text Encode or a Prompt Cleaner, the negative output to your negative encoder. The template itself can also come from another node's text.");
      await t.waitVoice();
      const bar = t.node(n.asm);
      const load = bar.locator('[data-test="asm-load-template"]');
      if (await load.isVisible().catch(() => false)) {
        await t.callout("ls", [load, bar.locator('[data-test="asm-save-template"]')], "Templates in your library", 4);
        await t.say("Load fills both boxes from a template in your library; Save stores this one there, prompt and negative.");
        await t.waitVoice();
        await t.uncallout("ls");
        await t.callout("mu", bar.locator('[data-test="asm-mark-unused"]'), "Hide what isn't used", 4);
        await t.say("The eye marks every upstream variable neither box reads as internal, so the chips list only what matters. Rules still read them, and Undo puts it back.");
        await t.waitVoice();
        await t.uncallout("mu");
        await t.callout("cl", bar.locator('[data-test="asm-clear-template-icon"]'), "Empty both boxes", 4);
        await t.say("Clear empties both boxes, after asking.");
        await t.waitVoice();
        await t.uncallout("cl");
      }
    });

    const asm2 = await t.h.step("Two prompts from one Context", async () => {
      await t.say("One Context can feed several Assemblers. Add a second, for a short tag prompt.");
      const a2 = await t.addNode("WP Prompt Assembler", { x: 1150, y: 640 });
      await t.wire(n.ctx, "context", a2, "context");
      await t.click(box(a2));
      await t.type("$role, $setting", { cps: 16 });
      await t.press("Escape");
      await waitPreview(a2, /,/);
      await t.waitVoice();
      await t.callout("both", [preview(n.asm), preview(a2)], "Same picks, two prompts", 6);
      await t.say("Both read the same picks: a long prompt for one model or sampler, a short one for another, or a caption to save beside the image. Each sends only the negatives of what it prints.");
      await t.waitVoice();
      await t.uncallout("both");
      return a2;
    });

    await t.h.step("Preview and run", async () => {
      await t.say("Wire the first Assembler's prompt into Preview as Text, and run.");
      const text = await t.addNode("Preview as Text", { x: 1700, y: 170 });
      await t.wire(n.asm, "prompt", text, "source");
      await t.run();
      await t.beat(1200);
      await t.waitVoice();
      await t.callout("cmp", [preview(n.asm), t.node(text)], "Preview, and the real prompt", 6);
      await t.say("The run printed what the preview showed: it rolls with the Context's own seed. After the run, the seed moves on as its mode says, and the preview follows.");
      await t.waitVoice();
      await t.uncallout("cmp");
      await t.say("A value that only exists at run time, like a caption wired into an Injector, shows by its name in the preview and as text after the run.");
      await t.waitVoice();
      if (!(await t.node(asm2).isVisible())) throw new StepError("The second Assembler left the screen.");
    });

    await t.h.step("With a Context Loop", async () => {
      await t.say("With a Context Loop before the Context, the preview shows one frame at a time. Add one and wire it into the Context's upstream.");
      const loop = await t.addNode("WP Context Loop", { x: 60, y: 560 });
      await t.wire(loop, "context", n.ctx, "upstream");
      await t.beat(600);
      await t.waitVoice();
      await t.say("Set its count to four.");
      await t.fill(t.node(loop).locator('[data-widget-name="count"] input').first(), "4", { cps: 10 });
      await t.press("Tab");
      await t.beat(800);
      await t.click(t.node(n.asm).locator("textarea, [contenteditable='true']").first());
      await t.press("ControlOrMeta+End");
      await t.type(", frame $iteration", { cps: 16 });
      await t.press("Escape");
      await t.beat(800);
      await t.waitVoice();
      const step = t.node(n.asm).locator('[data-test="asm-frame-step"]');
      if (!(await step.isVisible().catch(() => false))) throw new StepError("The Assembler shows no frame arrows with a Loop upstream.");
      await t.callout("step", step, "Which frame the preview shows", 5);
      await t.say("Arrows above the preview step through the frames, and the preview shows each frame's own picks.");
      for (let i = 0; i < 2; i++) {
        await t.click(t.node(n.asm).locator('[data-test="asm-frame-next"]'));
        await t.beat(800);
      }
      await t.waitVoice();
      await t.uncallout("step");
      await t.say("When the loop switches a module on for some frames only, its variable gets a frame tag, like number four, instead of a missing mark, and the preview says when it's empty on the frame shown. The Context Loop video shows it.");
      await t.waitVoice();
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("At run time the Assembler swaps every variable for its value in the context it got, then collects the negatives of what it printed. It rolls nothing itself: change the picks on the Context, not here.");
      await t.waitVoice();
      await t.say("Recipes: a Prompt Cleaner after it, then the sampler. A second Assembler for a caption, wired into a Save Image's file name or a Label and Grid's labels.");
      await t.waitVoice();
      await t.say("Gotchas: a full stop right after a variable opens its parts list, so add a space or press Escape. And a value that only exists at run time shows by name in the preview until you run.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Type a dollar sign for the list, watch the preview, and use as many Assemblers as you need prompts. The Assembler page in the docs has the full template grammar.");
      await t.waitVoice();
    });
  },
);
