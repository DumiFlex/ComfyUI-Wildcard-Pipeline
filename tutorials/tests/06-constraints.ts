// Tutorial 6: constraints. Role fits the place: a matrix of Role's tags against Setting's tags
// that boosts, lowers or excludes settings, so a clockwork inventor never stands in the forest.
import { addDebugUnder, showcase, showcasing, tutorial } from "../tutorial.js";

tutorial(
  "T06",
  {
    title: "Constraints: keep clashing picks apart",
    description: "A constraint re-weights the Setting by the Role's tags: knights lean to castles, inventors never get a forest.",
    learn: "Read a constraint's matrix of boost, reduce and exclude, and see it change what rolls together.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("A constraint", async () => {
      await t.go("/wp/constraints/7ff544c2/edit");
      await t.say("Random picks can clash: a clockwork inventor in a misty pine forest. A constraint changes the odds by what was already rolled.");
      await t.beat(600);
      const pickers = [page.locator('[data-test="source-wildcard-select"]'), page.locator('[data-test="target-wildcard-select"]')];
      await t.scrollTo(pickers[0]);
      await t.callout("pair", pickers, "Role decides, Setting follows", 6);
      await t.say("This one reads the Role and re-weights the Setting.");
      await t.waitVoice();
      await t.uncallout("pair");
      const grid = page.locator('[data-test="matrix-grid"]');
      await t.scrollTo(grid);
      await t.callout("grid", grid, "Role's tags × Setting's tags", 6);
      await t.say("Rows are the role's tags, columns the setting's tags.");
      await t.waitVoice();
      await t.uncallout("grid");
      await t.callout("boost", page.locator('[data-test="cell-knight-castle"]'), "Boost × 4", 6);
      await t.say("A knight makes a castle four times as likely,");
      await t.waitVoice();
      await t.uncallout("boost");
      await t.callout("excl", page.locator('[data-test="cell-inventor-forest"]'), "Exclude", 6);
      await t.say("and an inventor never gets a forest at all.");
      await t.waitVoice();
      await t.uncallout("excl");
    });

    const nodes = await t.h.step("On the canvas", async () => {
      await t.go("/");
      await t.say("On the canvas, the constraint goes between the two lists: Role, the constraint, then Setting.");
      await t.beat(600);
      const ctx = await t.addNode("WP Context", { x: 520, y: 260 });
      await t.pickModules(ctx, ["Role", "Role fits the place", "Setting"]);
      await t.say("Order matters here too. Rows run top to bottom: the constraint reads a Role that has already rolled, and only changes Settings that roll after it. Put it above the Role, or below the Setting, and it does nothing.");
      await t.waitVoice();
      const asm = await t.addNode("WP Prompt Assembler", { x: 1340, y: 260 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $setting");
      await t.beat(1000);
      return { ctx, asm };
    });

    const plus = t.node(nodes.ctx).getByRole("button", { name: /increment|increase|\+/i }).first();
    await t.h.step("Roll", async () => {
      await t.say("Roll a few seeds. Knights land in castles more often, rangers in the forest, and the inventor stays out of it.");
      for (let i = 0; i < 5; i++) {
        await t.click(plus);
        await t.beat(900);
      }
    });

    if (showcasing(t)) {
      await t.h.step("The pictures", async () => {
        await t.say("And here they are as pictures. The odds lean, so most land where they belong, and now and then one doesn't.");
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
      await t.say("Constraints never block a run. They only change the odds, so your prompts make sense more often.");
    });
  },
);
