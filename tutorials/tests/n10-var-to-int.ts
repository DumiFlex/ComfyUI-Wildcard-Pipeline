// Nodes 10: WP Var → Int in depth (the depth standard). The shared Var scene (Toggles → Model Info
// pinned to sdxl → a Context with Settings per model). Var → Int reads $size: context, var_name,
// index (0 = width, 1 = height), default, value (out) into an Empty Latent Image's width and a
// Preview as Text so it runs without a model, the read on the node after a run, a second one for the
// height, the default on a missing variable, how it works, recipes and gotchas.
import { tutorial } from "../tutorial.js";
import { buildVarScene, pickVar, readOf, runVar, setNumber, widget } from "../var-scene.js";

tutorial(
  "N10",
  {
    title: "WP Var → Int in depth",
    description: "Turn a $variable into a whole number for any node setting: which variable, which number, the default, and where to wire it.",
    learn: "context, var_name, index, default, value, and driving a width, steps or batch size from your rules.",
  },
  async (t) => {
    const n = await t.h.step("What it's for", async () => {
      const s = await buildVarScene(t, "WP Var to Int turns a variable into a whole number. First, the small workflow every Var video shares.");
      await t.say("Rules can pick more than words. Settings per model sets a size for the model family: here, eight thirty two by twelve sixteen.");
      await t.waitVoice();
      await t.say("But an Empty Latent wants a number for its width, not a variable. WP Var → Int takes a whole number out of a variable, for any setting that wants one.", "But an Empty Latent wants a number for its width, not a variable. WP Var to Int takes a whole number out of a variable, for any setting that wants one.");
      await t.waitVoice();
      return s;
    });

    const v = await t.h.step("context and var_name", async () => {
      await t.say("Add it, and wire the Context into context, its only input. It reads the variables at that point.", "Add it, and wire the Context into context, its only input. It reads the variables at that point.");
      const id = await t.addNode("WP Var → Int", { x: 900, y: 110 });
      await t.wire(n.ctx, "context", id, "context");
      await t.waitVoice();
      await t.say("var_name lists every variable the wired Context has. Type to narrow it, and pick size.", "Var name lists every variable the wired Context has. Type to narrow it, and pick size.");
      await pickVar(t, id, "size");
      await t.waitVoice();
      return id;
    });

    await t.h.step("index and default", async () => {
      await t.callout("idx", widget(t, v, "index"), "Which number", 4);
      await t.say("index says which number in the text to take. Zero is the first, the width. It finds every whole number, so eight thirty two x twelve sixteen has two.", "Index says which number in the text to take. Zero is the first, the width. It finds every whole number, so eight thirty two by twelve sixteen has two.");
      await t.waitVoice();
      await t.uncallout("idx");
      await t.callout("def", widget(t, v, "default"), "When there's none", 4);
      await t.say("default is used when the variable is missing, has no number, or fewer numbers than the index. Make it ten twenty four. The node never stops a run.", "Default is used when the variable is missing, has no number, or fewer numbers than the index. Make it ten twenty four. The node never stops a run.");
      await setNumber(t, v, "default", "1024");
      await t.waitVoice();
      await t.uncallout("def");
    });

    const out = await t.h.step("value (out)", async () => {
      await t.say("value (out) goes into any whole-number input. Wire it into an Empty Latent Image's width.", "Its value output goes into any whole-number input. Wire it into an Empty Latent Image's width.");
      const lat = await t.addNode("Empty Latent Image", { x: 1330, y: 110 });
      await t.wire(v, "value", lat, "width");
      await t.waitVoice();
      await t.say("And into Preview as Text, so we can watch it run without a model. Run.");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 520 });
      await t.wire(v, "value", p, "source");
      await runVar(t);
      await t.callout("read", readOf(t, v), "What it read", 5);
      await t.say("After a run, the node shows what it read and from where: eight thirty two, from size.");
      await t.waitVoice();
      await t.uncallout("read");
      return { lat, p };
    });

    await t.h.step("A second one for the height", async () => {
      await t.say("One node gives one number. For the height, add a second, pick size, and set index to one.");
      await t.speedUp(3);
      const h = await t.addNode("WP Var → Int", { x: 900, y: 420 });
      await t.wire(n.ctx, "context", h, "context");
      await pickVar(t, h, "size");
      await setNumber(t, h, "index", "1");
      await setNumber(t, h, "default", "1024");
      await t.wire(h, "value", out.lat, "height");
      await t.normalSpeed();
      await t.waitVoice();
      await t.say("Width and height now follow the rule, so a different model family gets its own size.");
      await t.waitVoice();
    });

    await t.h.step("When the variable is missing", async () => {
      await t.say("Switch Settings per model off on the Context, so nothing sets size, and run.");
      await t.click(t.moduleRow(n.ctx, "Settings per model").locator('[data-test="module-enabled"]'));
      await t.beat(400);
      await runVar(t);
      await t.callout("read", readOf(t, v), "The default", 5);
      await t.say("It gives its default, ten twenty four, and the run goes on.");
      await t.waitVoice();
      await t.uncallout("read");
      await t.click(t.moduleRow(n.ctx, "Settings per model").locator('[data-test="module-enabled"]'));
      await t.beat(400);
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("At run time it reads the variable as text, finds the whole numbers in it, a minus sign included, and takes the one at the index. In a Context Loop it runs once per frame, so every frame can get its own number.");
      await t.waitVoice();
      await t.say("Recipes: steps from a Toggles switch for quick drafts, a batch size from a rule, or a width and height per model family, as here.");
      await t.waitVoice();
      await t.say("Gotchas: put it after the Context that sets the variable, hide that variable with its globe so the numbers don't print in your prompt, and use Var → Float for decimals: Int would read seven point five as two numbers, seven and five.", "Gotchas: put it after the Context that sets the variable, hide that variable with its globe so the numbers don't print in your prompt, and use Var to Float for decimals: Int would read seven point five as two numbers, seven and five.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for Var → Int whenever a rule should decide a whole number. The Var nodes page in the docs lists every field.", "Reach for Var to Int whenever a rule should decide a whole number. The Var nodes page in the docs lists every field.");
      await t.waitVoice();
    });
  },
);
