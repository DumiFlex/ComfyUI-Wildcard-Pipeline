// Tutorial 5: derivations. The Lighting from time rule (IF night THEN moonlight and a negative,
// ELSE soft light), read in a scene line; new seeds until night rolls and the light follows.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T05",
  {
    title: "Derivations: rules that set a variable",
    description: "A derivation sets the lighting from the time of day, with a second action that adds a negative, and the scene follows as the seed changes.",
    learn: "Read a derivation's IF / ELSE branches and actions, and see a rule follow what another list rolled.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("A derivation", async () => {
      await t.say("A derivation sets a variable by a rule, instead of rolling it. Here is Lighting from time.");
      await t.go("/wp/derivations/5774d2a1/edit");
      await t.beat(600);
      await t.click(page.locator('[data-test="rule-0"]').getByText("Rule 1").first());
      await t.beat(800);
      await t.click(page.locator('[data-test="toggle-branch-0-0"]'));
      await t.beat(600);
      const branch = page.locator('[data-test="branch-0-0"]');
      await t.scrollTo(branch);
      await t.callout("if", page.locator('[data-test="cond-test-0-0"]'), "IF time is night", 6);
      await t.say("If the time rolled night,");
      await t.waitVoice();
      await t.uncallout("if");
      await t.callout("then", page.locator('[data-test="act-block-0-0"]'), "THEN lighting = moonlight", 6);
      await t.say("lighting becomes moonlight and a warm lantern glow.");
      await t.waitVoice();
      await t.uncallout("then");
      await t.callout("neg", page.locator('[data-test="act-block-0-0-1"]'), "…and add a negative", 6);
      await t.say("A second action adds a negative, so the night isn't overexposed.");
      await t.waitVoice();
      await t.uncallout("neg");
      await t.click(page.locator('[data-test="toggle-branch-else-0"]'));
      await t.beat(600);
      const other = page.locator('[data-test="branch-else-0"]');
      await t.scrollTo(other);
      await t.callout("else", other, "ELSE soft natural light", 6);
      await t.say("Any other time gets soft natural light.");
      await t.waitVoice();
      await t.uncallout("else");
    });

    const nodes = await t.h.step("On the canvas", async () => {
      await t.say("On the canvas, pick Time of day and Setting, the rule, and Scene line, a combine that reads all three.");
      await t.go("/");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 280 });
      await t.pickModules(ctx, ["Time of day", "Setting", "Lighting from time", "Scene line"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 260 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("a lone traveler $scene");
      await t.beat(1000);
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
        await t.say("Here are a few of those scenes, run through a model.");
        await t.say("First, add WP Debug under the Context, so every run shows what it rolled.");
        const dbg = await addDebugUnder(t, nodes.ctx);
        await showcase(t, { from: nodes.asm, preview: { x: 1560, y: 440, width: 340, height: 500 }, chain: { x: 1820, y: 960 }, between: () => t.click(plus) });
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
