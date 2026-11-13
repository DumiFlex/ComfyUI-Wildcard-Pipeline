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

    await t.h.step("Outro", async () => {
      await t.say("Type a dollar sign for the list, watch the preview, and use as many Assemblers as you need prompts. The Assembler page in the docs has the full template grammar.");
      await t.waitVoice();
    });
  },
);
