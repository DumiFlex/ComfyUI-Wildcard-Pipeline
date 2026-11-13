// Nodes 4: WP Context Injector in depth. Three outside values (a text, a second text, an Int) wired in
// become $cloak, $time and $steps; WP Debug shows each as plain text. A row's Edit window: its
// template (wearing $input_0, $$), its negative and the live preview. The globe hides $steps from the
// prompt. A template row reads the other rows by name. Before a Context, the Context's own items read
// the injected variables (Lighting from time follows $time). Negatives follow usage: the Assembler's
// negative has the cloak's only while its template prints $cloak. Last, the Assembler's preview
// before a run against the real prompt after one. Prompt-only: no model.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N04",
  {
    title: "WP Context Injector in depth",
    description: "What the Context Injector really does: how a wired value becomes a variable, each row's template, negative and globe, template rows, where it sits, and why the Assembler's preview differs from the run.",
    learn: "Wired values as text, row names, templates with $input_N and $$, row negatives, the globe, template rows, upstream vs downstream, negatives follow usage, preview vs run.",
  },
  async (t) => {
    const page = t.page;
    const binding = (inj: string, i: number) => t.node(inj).locator('[data-test="inj-row-binding"] input').nth(i);
    const rows = (inj: string) => t.node(inj).locator(".wp-inj-row");
    const editRow = async (inj: string, i: number) => {
      await t.click(rows(inj).nth(i).locator('[data-test="inj-row-slot"], [data-test="inj-row-general-tag"]').first(), { right: true });
      await t.beat(500);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(800);
    };
    const template = () => page.locator('[data-test="ibm-template"]').locator('[contenteditable="true"], textarea').first();

    const n = await t.h.step("A wired value becomes a variable", async () => {
      await t.go("/");
      await t.speedUp();
      const cloak = await t.addNode("Text (Multiline)", { x: 260, y: 190 });
      await t.click(t.node(cloak).locator("textarea").first());
      await t.type("hooded travelling cloak", { cps: 30 });
      const time = await t.addNode("Text (Multiline)", { x: 260, y: 470 });
      await t.click(t.node(time).locator("textarea").first());
      await t.type("at night", { cps: 30 });
      const steps = await t.addNode("Int", { x: 260, y: 760 });
      await page.evaluate((id) => {
        const node = window.app?.graph?.getNodeById(Number(id)) as { widgets?: { name: string; value: unknown }[] } | null | undefined;
        const w = node?.widgets?.find((x) => x.name === "value");
        if (w) w.value = 30;
        window.app?.canvas?.setDirty(true, true);
      }, steps);
      const inj = await t.addNode("WP Context Injector", { x: 860, y: 190 });
      await t.normalSpeed();
      await t.say("Two text boxes and an Int number, as stand-ins for anything another node gives you: a caption, a setting, a model name.");
      await t.waitVoice();
      await t.say("Wire each into the Injector. Every wire gets a row, and the row's name is the variable it writes.");
      const away = async () => {
        // Off the rows, so the globe's tooltip doesn't stay up beside them.
        await t.moveTo({ x: 560, y: 640 });
        await t.beat(300);
      };
      await t.wire(cloak, "STRING", inj, "input_0");
      await t.fill(binding(inj, 0), "cloak", { cps: 14 });
      await t.press("Tab");
      await away();
      await t.waitVoice();
      await t.say("The second text becomes time. A new free input appears as each one is wired, up to ten.");
      await t.wire(time, "STRING", inj, "input_1");
      await t.fill(binding(inj, 1), "time", { cps: 14 });
      await t.press("Tab");
      await away();
      await t.waitVoice();
      await t.say("And the Int becomes steps.");
      await t.wire(steps, "INT", inj, "input_2");
      await t.fill(binding(inj, 2), "steps", { cps: 14 });
      await t.press("Tab");
      await away();
      await t.waitVoice();
      await t.callout("names", t.node(inj).locator('[data-test="inj-row-binding"]').first(), "Letters, digits, underscores", 4);
      await t.say("A name starts with a letter, then letters, digits or underscores. The row also shows the socket and the type it was given.");
      await t.waitVoice();
      await t.uncallout("names");
      const dbg = await t.addNode("WP Debug", { x: 860, y: 720 });
      await t.say("Add WP Debug after it, and Run.");
      await page.evaluate((id) => {
        const node = window.app?.graph?.getNodeById(Number(id)) as { size: [number, number] } | null | undefined;
        if (node) node.size = [520, 300];
        window.app?.canvas?.setDirty(true, true);
      }, dbg);
      await t.wire(inj, "context", dbg, "context");
      await t.run();
      await t.beat(1000);
      await t.callout("vars", t.node(dbg).locator('[data-test="dbg-vars"]'), "Everything becomes text", 6);
      await t.say("Every value becomes plain text: the number thirty is the text 30, and a Boolean would be true or false. An image or a latent has no useful text, so wire text, numbers, switches and names.");
      await t.waitVoice();
      await t.uncallout("vars");
      return { cloak, time, steps, inj, dbg };
    });

    await t.h.step("A row's template and negative", async () => {
      await t.say("Right-click the cloak row and Edit it. Template wraps the value in your own words: input 0 is what came down the wire.");
      await editRow(n.inj, 0);
      await t.click(template());
      await t.type("wearing a $input_0", { cps: 16 });
      await t.beat(500);
      const typed = await page.locator('[data-test="ibm-template"]').innerText().catch(() => "");
      if (!/wearing/.test(typed)) throw new StepError("The cloak row's template didn't take the typing.");
      await t.callout("prev", page.locator('[data-test="ibm-preview"]'), "What $cloak will be", 6);
      await t.say("The preview shows the result. Leave the template empty to use the value as it is, and write two dollar signs for a dollar sign.");
      await t.waitVoice();
      await t.uncallout("prev");
      const neg = page.locator('[data-test="ibm-negative"]');
      await t.callout("neg", neg, "This variable's negative", 6);
      await t.say("Negative is this variable's own negative words. Type torn fabric.");
      await t.click(neg.locator('[contenteditable="true"], textarea').first());
      await t.type("torn fabric", { cps: 16 });
      await t.beat(400);
      await t.waitVoice();
      await t.uncallout("neg");
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
      await t.callout("badge", t.node(n.inj).locator('[data-test="inj-row-neg-badge"]').first(), "Has a negative", 4);
      await t.say("The row shows its template and a NEG badge.");
      await t.waitVoice();
      await t.uncallout("badge");
    });

    await t.h.step("The globe", async () => {
      const globe = rows(n.inj).nth(2).locator('[data-test="inj-row-internal"]');
      await t.callout("g", globe, "Hide from prompt", 4);
      await t.say("The globe hides a variable from the prompt. Steps is a setting, not words for the picture, so hide it. Rules and combines can still read it.");
      await t.click(globe);
      await t.beat(600);
      await t.waitVoice();
      await t.uncallout("g");
    });

    await t.h.step("A template row", async () => {
      await t.say("A template row has no wire. It joins the other rows by their names. Add one, name it outfit, and Edit it.");
      await t.click(t.node(n.inj).locator('[data-test="inj-add-general"]'));
      await t.beat(500);
      await t.fill(binding(n.inj, 3), "outfit", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await editRow(n.inj, 3);
      await t.click(template());
      await t.type("$cloak with a silver clasp", { cps: 16 });
      await t.beat(600);
      await t.callout("prev", page.locator('[data-test="ibm-preview"]'), "Reads $cloak by name", 6);
      await t.say("It reads cloak, template and all.");
      await t.waitVoice();
      await t.uncallout("prev");
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
    });

    const m = await t.h.step("Before a Context", async () => {
      // Zoom out a little and put the Injector at the left edge, so the Context, the Assembler and
      // both previews fit beside it, with the Injector whole (the last take cut it at the left).
      const view = await page.evaluate((id) => {
        const g = window.app?.graph;
        const node = (g?.getNodeById(id) ?? g?.getNodeById(Number(id))) as { pos: [number, number] } | null | undefined;
        const c = (window.app as unknown as { canvas: { ds: { scale: number; offset: [number, number] } } }).canvas;
        const scale = c.ds.scale * 0.82;
        const x = node?.pos[0] ?? 0;
        const y = node?.pos[1] ?? 0;
        // Screen x 120: clear of the sidebar (40 put the Injector's left edge under it).
        return { scale, offset: [120 / scale - x, 150 / scale - y] as [number, number] };
      }, n.inj);
      await t.setView(view);
      await t.beat(500);
      await t.say("Wire the Injector into a Context's upstream. The Context starts with every injected variable, so its own items can read them.");
      // A node is centred on its drop point: x 720 keeps the Context (about 445 px wide here) clear of
      // the Injector's context output.
      const ctx = await t.addNode("WP Context", { x: 720, y: 150 });
      await t.wire(n.inj, "context", ctx, "upstream");
      await t.waitVoice();
      await t.say("Pick Role, Setting and Lighting from time.");
      await t.fastForward(() => t.pickModules(ctx, ["Role", "Setting", "Lighting from time"]), 3);
      await t.waitVoice();
      await t.say("Then an Assembler. Its template prints the role, the outfit row, the setting, the time and the light.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 720, y: 600 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $outfit, $setting $time, $lighting", { cps: 16 });
      await t.beat(500);
      await t.waitVoice();
      await t.say("And two Preview as Text nodes: one for the prompt, one for the negative.");
      const out = await t.addNode("Preview as Text", { x: 1180, y: 150 });
      await t.wire(asm, "prompt", out, "source");
      const neg = await t.addNode("Preview as Text", { x: 1180, y: 560 });
      await t.wire(asm, "negative", neg, "source");
      await t.waitVoice();
      await t.say("Lighting from time follows the time variable. Here time comes from the text box, not from a wildcard. Run.");
      await t.run();
      await t.beat(900);
      await t.callout("p", t.node(out), "at night, so moonlight", 6);
      await t.waitVoice();
      await t.uncallout("p");
      await t.say("Order matters: only nodes after the Injector see its variables. An Injector after a Context adds to what that Context made, and the next Context sees both.");
      await t.waitVoice();
      return { ctx, asm, out, neg };
    });

    await t.h.step("Negatives follow usage", async () => {
      await t.callout("n", t.node(m.neg), "torn fabric, from $cloak", 6);
      await t.say("The negative output has torn fabric, because the template prints outfit, which reads cloak.");
      await t.waitVoice();
      await t.uncallout("n");
      await t.say("Take outfit out of the template, and Run again.");
      const box = t.node(m.asm).locator("textarea, [contenteditable='true']").first();
      await t.click(box);
      await page.keyboard.press("Control+A");
      await t.type("A painting of $role, $setting $time, $lighting", { cps: 18 });
      await t.run();
      await t.beat(900);
      await t.callout("n2", t.node(m.neg), "No cloak, no torn fabric", 6);
      await t.say("No cloak in the prompt, so no torn fabric in the negative. Negatives follow what the prompt uses.");
      await t.waitVoice();
      await t.uncallout("n2");
    });

    await t.h.step("Preview vs the run", async () => {
      await t.callout("pv", t.node(m.asm), "Before a run: placeholders", 4);
      await t.say("One last thing. The Assembler's preview can't know a wired value before a run, so it shows the Injector's variables as placeholders.");
      await t.waitVoice();
      await t.uncallout("pv");
      await t.callout("rv", t.node(m.out), "After a run: the real text", 4);
      await t.say("The real prompt is what the run gives. Read it in Preview as Text or WP Debug.");
      await t.waitVoice();
      await t.uncallout("rv");
    });

    await t.h.step("Recipes", async () => {
      await t.callout("txt", rows(n.inj).nth(0), "A LoRA name, a caption", 5);
      await t.say("Recipe one: in place of the cloak text, a LoRA loader's name, with a rule that adds its trigger words; the LoRA trigger words video builds it. Or a caption from an image-to-text node, so the prompt describes a picture you load.");
      await t.waitVoice();
      await t.uncallout("txt");
      await t.callout("num", rows(n.inj).nth(2), "A number for a sampler", 5);
      await t.say("Recipe two: a number like steps, hidden with the globe, then read back out by a Var to Int node for a sampler setting.");
      await t.waitVoice();
      await t.uncallout("num");
    });

    await t.h.step("Gotchas", async () => {
      await t.say("Gotcha one: a curly-brace pick in a row's template needs a seed, so it prints as written. Edit the outfit row and try one.");
      await editRow(n.inj, 3);
      await t.click(template());
      await t.press("ControlOrMeta+End");
      await t.type(" in {red|blue}", { cps: 16 });
      await t.beat(700);
      const warn = page.locator('[data-test="ibm-inline-picks"]');
      const shown = (await warn.isVisible().catch(() => false)) ? warn : page.locator('[data-test="ibm-preview"]');
      await t.callout("w", shown, "Printed as written", 5);
      await t.waitVoice();
      await t.say("The editor warns about it. Use a wildcard in a Context for a pick. Cancel.");
      await t.waitVoice();
      await t.uncallout("w");
      await t.click(page.locator('[data-test="ibm-cancel"]'));
      await t.beat(600);
      await t.say("Gotcha two: an Injector after a Loop gives every frame the same value; a per-frame value goes into the Loop's values input. And a name a Context also writes is replaced by whichever runs later.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for the Injector whenever a value comes from another node. Name it, wrap it, give it a negative, and put the Injector before what reads it. The Context Injector page in the docs has every field.");
    });
  },
);
