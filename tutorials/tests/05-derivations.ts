// Tutorial 5: derivations. The Lighting from time rule (IF at night THEN moonlight and add to
// negative, ELSE IF at sunset rim light, ELSE soft light), what each action mode does, then the
// rule read in the Scene combine; new seeds until night rolls and the light follows.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T05",
  {
    title: "Derivations: rules that set a variable",
    description: "A derivation sets the lighting from the time of day, the ways an action can write a variable or its negatives, and the scene following as the seed changes.",
    learn: "Read a derivation's IF / ELSE IF / ELSE branches, what Replace, Append, Prepend, Add to negative and Replace negative do, and see a rule follow what another list rolled.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("A derivation", async () => {
      await t.go("/wp/derivations/5774d2a1/edit");
      await t.say("A derivation sets a variable by a rule, instead of rolling it. It can make a new variable, change one that's already there, or replace it. Here is Lighting from time.");
      await t.beat(600);
      await t.click(page.locator('[data-test="rule-0"]').getByText("Rule 1").first());
      await t.beat(800);
      await t.waitVoice();
      await t.click(page.locator('[data-test="toggle-branch-0-0"]'));
      await t.beat(600);
      const branch = page.locator('[data-test="branch-0-0"]');
      await t.scrollTo(branch, { at: 0.15, force: true });
      await t.callout("if", page.locator('[data-test="cond-test-0-0"]'), "IF time is at night", 6);
      await t.say("If the time rolled at night,");
      await t.waitVoice();
      await t.uncallout("if");
      await t.callout("then", page.locator('[data-test="act-block-0-0"]'), "THEN lighting = moonlight", 6);
      await t.say("lighting becomes pale moonlight and a warm lantern glow.");
      await t.waitVoice();
      await t.uncallout("then");
    });

    await t.h.step("What an action can do", async () => {
      const mode = page.locator('[data-test="act-mode-0-0"]');
      await t.callout("mode", mode, "How it writes", 6);
      await t.say("The mode says how the action writes. Replace sets the variable, or overwrites one that already has a value. Append and prepend add text to the end or the start of what's there.");
      await t.click(mode);
      await t.beat(900);
      await t.waitVoice();
      await t.say("And two modes work on negatives only. Add to negative puts words beside the negatives the variable already has. Replace negative swaps them all for new words.");
      await t.waitVoice();
      await t.press("Escape");
      await t.uncallout("mode");
      await t.beat(400);
      const neg = page.locator('[data-test="act-block-0-0-1"]');
      await t.scrollTo(neg, { at: 0.3 });
      await t.callout("neg", neg, "…and add to its negatives", 6);
      await t.say("This branch has a second action, Add to negative, so a night scene keeps away from harsh sunlight.");
      await t.waitVoice();
      await t.uncallout("neg");
    });

    await t.h.step("More branches", async () => {
      await t.click(page.locator('[data-test="toggle-branch-0-1"]'));
      await t.beat(600);
      const sunset = page.locator('[data-test="branch-0-1"]');
      await t.scrollTo(sunset, { at: 0.15, force: true });
      await t.callout("sunset", sunset, "ELSE IF at sunset", 6);
      await t.say("A second branch is checked only when the first doesn't match: at sunset, warm orange rim light.");
      await t.waitVoice();
      await t.uncallout("sunset");
      await t.click(page.locator('[data-test="toggle-branch-else-0"]'));
      await t.beat(600);
      const other = page.locator('[data-test="branch-else-0"]');
      await t.scrollTo(other, { at: 0.15, force: true });
      await t.callout("else", other, "ELSE soft morning light", 6);
      await t.say("Any other time, which is dawn here, gets soft morning light.");
      await t.waitVoice();
      await t.uncallout("else");
    });

    const nodes = await t.h.step("On the canvas", async () => {
      await t.go("/");
      await t.say("On the canvas, pick Time of day and Setting, the rule, and Scene, a combine that reads all three.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 170 });
      await t.pickModules(ctx, ["Time of day", "Setting", "Lighting from time", "Scene"]);
      await t.callout("order", ["Time of day", "Setting", "Lighting from time", "Scene"].map((n) => t.moduleRow(ctx, n)), "Top to bottom", 4);
      await t.say("Order matters: rows run top to bottom, so the rule goes after Time of day, which it reads, and the combine goes last, after everything it uses. A rule placed above what it reads sees nothing yet.");
      await t.waitVoice();
      await t.uncallout("order");
      await t.waitVoice();
      const asm = await t.addNode("WP Prompt Assembler", { x: 1180, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of a lone traveler $scene");
      await t.beat(1000);
      await t.say("Only the scene reaches the template, so hide the other three with their globe buttons. The combine still reads them.");
      await t.hide(ctx, ["Time of day", "Setting", "Lighting from time"]);
      await t.waitVoice();
      return { ctx, asm };
    });

    const plus = t.node(nodes.ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
    await t.h.step("Night falls", async () => {
      await t.say("Change the seed until the time rolls night, and watch the lighting follow.");
      const text = () => t.node(nodes.asm).innerText();
      for (let i = 0; i < 12; i++) {
        await t.click(plus);
        await t.beat(700);
        if (/moonlight/.test(await text())) break;
      }
      await t.callout("night", t.node(nodes.asm), "Night: moonlight, and a negative", 4);
      await t.say("Night brings the moonlight, and the negative output gets the rule's negative.");
      await t.waitVoice();
      await t.uncallout("night");
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("First, add WP Debug under the Context, so every run shows what it rolled.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1440, y: 150, width: 450, height: 780 }, chain: { x: 1820, y: 960 }, between: () => t.click(plus) });
        // Said once the pictures are on screen, not before them.
        await t.say("Here are a few of those scenes, run through a model.");
        await t.waitVoice();
        await t.callout("picks", t.node(dbg), "What this picture rolled");
        await t.say("Debug shows the picks behind the last picture, so you can see the prompt change from run to run.");
        await t.waitVoice();
        await t.uncallout("picks");
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Rules keep your picks making sense together. Next: constraints, which change the odds instead.");
    });
  },
);
