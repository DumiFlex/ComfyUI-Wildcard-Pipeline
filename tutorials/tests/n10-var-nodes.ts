// Nodes 10: the four Var nodes in depth (the depth standard). Toggles (a Hires switch) → WP Model Info
// (family pinned to sdxl) → a Context with Settings per model ($size, $sampler, $cfg). Then:
// Var → Int (index, default, the read shown on the node after a run), Var → Float ($cfg, and an index
// past the last number giving the default), Var → Choice (wired into a KSampler's sampler_name so its
// fallback list fills; match exact / loose / closest, if_no_match use fallback / stop the run),
// Var → Bool ($hires from the toggle, the yes/no words, index and default). Every Var node ends in a
// Preview as Text so it runs without a model. How they work, recipes, gotchas. Prompt-only.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "N10",
  {
    title: "Var nodes in depth",
    description: "Turn $variables into node settings: whole numbers, decimals, dropdown choices and on/off switches, with every field and what happens when a value is missing.",
    learn: "Var → Int, Float, Choice and Bool: var_name, index, default, match, fallback, if_no_match, and where they sit.",
  },
  async (t) => {
    const page = t.page;
    const widget = (node: string, name: string) => t.node(node).locator(`[data-widget-name="${name}"]`);
    const read = (node: string) => t.node(node).locator('[data-test="var-picker-preview"]');
    const pickVar = async (node: string, name: string) => {
      await t.click(t.node(node).getByRole("combobox", { name: "Variable" }).first());
      await t.type(name, { cps: 14, rest: false });
      await t.beat(500);
      await t.click(page.getByRole("option", { name: new RegExp(`^\\$?${name}\\b`) }).first());
      await t.beat(500);
    };
    const setNumber = async (node: string, name: string, value: string) => {
      await t.fill(widget(node, name).locator("input").first(), value, { cps: 10 });
      await t.press("Tab");
      await t.beat(400);
    };
    const chooseCombo = async (node: string, name: string, option: RegExp) => {
      await t.click(widget(node, name).getByRole("combobox").first());
      await t.beat(500);
      await t.click(page.getByRole("option", { name: option }).first());
      await t.beat(500);
    };
    const runIt = async () => {
      await t.run();
      await t.beat(1000);
      // A stopped run leaves ComfyUI's error dialog up.
      await t.press("Escape");
      await t.beat(300);
    };
    // Toggles edit view, as in N07.
    const win = () => page.getByRole("dialog").filter({ has: page.locator('[data-test="tg-window-done"]') }).last();
    const winField = (test: string) =>
      win().locator(`[data-test="${test}"] input, input[data-test="${test}"]`).first();

    const n = await t.h.step("What they're for", async () => {
      await t.go("/");
      await t.setView({ scale: 0.8, offset: [0, 0] });
      await t.speedUp();
      const tg = await t.addNode("WP Toggles", { x: 70, y: 130 });
      const tb = await t.node(tg).boundingBox();
      if (tb) await t.click({ x: tb.x + tb.width / 2, y: tb.y + 14 });
      await t.beat(400);
      await t.click(page.locator(".wp-tb-icon--edit").first().locator("xpath=ancestor::button[1]"));
      await t.beat(700);
      await t.click(t.node(tg).locator('[data-test="tg-add"]'));
      await t.beat(700);
      await t.fill(winField("tg-name"), "Hires", { cps: 30 });
      await t.press("Tab");
      await t.fill(winField("tg-var"), "hires", { cps: 30 });
      await t.press("Tab");
      await t.click(win().locator('[data-test="tg-window-done"]'));
      await t.beat(500);
      await t.click(t.node(tg).locator('[data-test="tg-edit-done"]'));
      await t.beat(500);
      await t.deselect();
      const mi = await t.addNode("WP Model Info", { x: 420, y: 130 });
      await t.wire(tg, "context", mi, "upstream");
      await t.click(t.node(mi).locator('[data-test="mi-pin-family"]'));
      await t.beat(400);
      await t.fill(t.node(mi).locator('input[data-test="mi-pin-input-family"], [data-test="mi-pin-input-family"] input').first(), "sdxl", { cps: 30 });
      await t.press("Enter");
      const ctx = await t.addNode("WP Context", { x: 420, y: 560 });
      await t.wire(mi, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Settings per model"]);
      await t.normalSpeed();
      await t.say("Your rules can pick more than words. Here, Settings per model sets a size, a sampler and a CFG for the model family, and a Toggles node has a Hires switch.");
      await t.waitVoice();
      await t.say("But a size is a variable, and an Empty Latent wants a number. The four Var nodes turn a variable into a node setting: a whole number, a decimal, a dropdown choice, or true and false.");
      await t.waitVoice();
      return { tg, mi, ctx };
    });

    const vi = await t.h.step("Var → Int", async () => {
      await t.say("WP Var → Int. Wire the Context into context, its only input.");
      const v = await t.addNode("WP Var → Int", { x: 900, y: 110 });
      await t.wire(n.ctx, "context", v, "context");
      await t.waitVoice();
      await t.say("var_name lists every variable the wired Context has. Pick size, which holds eight thirty two by twelve sixteen.", "Var name lists every variable the wired Context has. Pick size, which holds eight thirty two by twelve sixteen.");
      await pickVar(v, "size");
      await t.waitVoice();
      await t.callout("idx", widget(v, "index"), "Which number", 4);
      await t.say("index says which number to take. Zero is the first, the width; one would be the height.", "Index says which number to take. Zero is the first, the width; one would be the height.");
      await t.waitVoice();
      await t.uncallout("idx");
      await t.callout("def", widget(v, "default"), "When there's none", 4);
      await t.say("default is what it gives when the variable is missing, has no number, or has fewer than the index. Make it ten twenty four. It never stops a run.", "Default is what it gives when the variable is missing, has no number, or has fewer than the index. Make it ten twenty four. It never stops a run.");
      await setNumber(v, "default", "1024");
      await t.waitVoice();
      await t.uncallout("def");
      await t.say("value (out) goes into any whole-number input: a width, steps, a batch size. Here, Preview as Text, so you can see it.", "Value goes into any whole-number input: a width, steps, a batch size. Here, Preview as Text, so you can see it.");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 110 });
      await t.wire(v, "value", p, "source");
      await t.waitVoice();
      await t.say("Run.");
      await runIt();
      await t.callout("read", read(v), "What it read", 5);
      await t.say("After a run, the node shows what it read and from where: eight thirty two.");
      await t.waitVoice();
      await t.uncallout("read");
      return v;
    });

    const vf = await t.h.step("Var → Float", async () => {
      await t.say("WP Var → Float is the same for decimals: a CFG, a denoise, a LoRA strength. Pick cfg.");
      const v = await t.addNode("WP Var → Float", { x: 900, y: 360 });
      await t.wire(n.ctx, "context", v, "context");
      await pickVar(v, "cfg");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 360 });
      await t.wire(v, "value", p, "source");
      await t.waitVoice();
      await t.say("Set index to one. The CFG has only one number, so there's no second one to take.");
      await setNumber(v, "index", "1");
      await runIt();
      await t.callout("read", read(v), "The default", 5);
      await t.say("So it gives its default. Set index back to zero.");
      await t.waitVoice();
      await t.uncallout("read");
      await setNumber(v, "index", "0");
      return v;
    });

    const vc = await t.h.step("Var → Choice", async () => {
      await t.say("WP Var → Choice fills a dropdown: a sampler, a scheduler, a checkpoint, a LoRA. Pick sampler, and wire choice into a KSampler's sampler_name.", "WP Var to Choice fills a dropdown: a sampler, a scheduler, a checkpoint, a LoRA. Pick sampler, and wire choice into a KSampler's sampler name.");
      const v = await t.addNode("WP Var → Choice", { x: 900, y: 610 });
      await t.wire(n.ctx, "context", v, "context");
      await pickVar(v, "sampler");
      const ks = await t.addNode("KSampler", { x: 1700, y: 560 });
      await t.wire(v, "choice", ks, "sampler_name");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 610 });
      await t.wire(v, "choice", p, "source");
      await t.waitVoice();
      const wired = t.node(v).locator('[data-test="var-picker-wired"]');
      if (await wired.isVisible().catch(() => false)) {
        await t.callout("w", wired, "What it feeds", 4);
        await t.say("The line under the picker names what it feeds, and how many options that has.");
        await t.waitVoice();
        await t.uncallout("w");
      }
      await t.callout("fb", widget(v, "fallback"), "Filled from the KSampler", 4);
      await t.say("fallback is filled with the KSampler's own sampler list as you wire it. Choose euler.", "Fallback is filled with the KSampler's own sampler list as you wire it. Choose euler.");
      await chooseCombo(v, "fallback", /^euler$/);
      await t.waitVoice();
      await t.uncallout("fb");
      await t.callout("m", widget(v, "match"), "How close is close enough", 4);
      await t.say("match decides how close the text must be. The rule says dpmpp 2m with a space; the list says dpmpp underscore 2m.", "Match decides how close the text must be. The rule says dpmpp 2m with a space; the list says dpmpp underscore 2m.");
      await t.waitVoice();
      await t.uncallout("m");
      await t.say("Loose, the default, ignores capitals, spaces and underscores, so it finds it. Run.");
      await runIt();
      await t.callout("r", read(v), "Matched", 5);
      await t.say("Matched.");
      await t.waitVoice();
      await t.uncallout("r");
      await t.say("Exact wants the very same text. Switch to exact, and run.");
      await chooseCombo(v, "match", /^exact$/);
      await runIt();
      await t.callout("r", read(v), "The fallback", 5);
      await t.say("Nothing matches, so it uses euler, and says so.");
      await t.waitVoice();
      await t.uncallout("r");
      await t.say("Closest takes whichever option is nearest, even a loose guess. Good for a typo, risky for a model name.");
      await t.waitVoice();
      await t.callout("nm", widget(v, "if_no_match"), "Fallback, or stop", 4);
      await t.say("if_no_match: use fallback carries on and warns. stop the run stops here instead, and lists some of the options it had.", "If no match: use fallback carries on and warns. Stop the run stops here instead, and lists some of the options it had.");
      await chooseCombo(v, "if_no_match", /stop/);
      await runIt();
      await t.waitVoice();
      await t.uncallout("nm");
      await t.say("For a checkpoint, stopping beats quietly running the wrong model. Put match back to loose and if_no_match to use fallback.", "For a checkpoint, stopping beats quietly running the wrong model. Put match back to loose, and if no match to use fallback.");
      await chooseCombo(v, "match", /^loose$/);
      await chooseCombo(v, "if_no_match", /fallback/);
      await t.waitVoice();
      return v;
    });

    await t.h.step("Var → Bool", async () => {
      await t.say("WP Var → Bool gives true or false, for any switch input. Pick hires, the toggle's variable.");
      const v = await t.addNode("WP Var → Bool", { x: 900, y: 880 });
      await t.wire(n.ctx, "context", v, "context");
      await pickVar(v, "hires");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 880 });
      await t.wire(v, "value", p, "source");
      await t.waitVoice();
      await t.say("True, yes, on and one count as true; false, no, off and zero as false, in any capitals. Other words are skipped, and index counts only the yes and no words.");
      await t.waitVoice();
      await t.say("Switch Hires on, and run.");
      await t.click(t.node(n.tg).locator('[data-test^="tg-ctl-"]').first());
      await t.beat(400);
      await runIt();
      await t.callout("r", read(v), "true", 5);
      await t.say("True. Off would give false, and a missing variable its default.");
      await t.waitVoice();
      await t.uncallout("r");
      await t.say("Wire it into a Switch node to choose between two branches, like a hires pass or none.");
      await t.waitVoice();
    });

    await t.h.step("How they work", async () => {
      await t.say("Each Var node reads one variable from the Context at the point where it's wired, as text, and pulls out what its type needs. It runs with the rest of the run, so in a Context Loop every frame gets its own value.");
      await t.waitVoice();
      await t.say("Put them after the Context that sets the variable. A Var node before it sees nothing, and gives its default.");
      await t.waitVoice();
      if (!(await t.node(vi).isVisible().catch(() => false))) throw new StepError("Var → Int left the screen.");
    });

    await t.h.step("Recipes", async () => {
      await t.callout("all", [t.node(vi), t.node(vf), t.node(vc)], "One rule, every setting", 5);
      await t.say("Recipe one: settings per model. A rule on the model family sets the size, sampler and CFG, and Var nodes carry them into the latent and the sampler, so switching checkpoint switches everything.");
      await t.waitVoice();
      await t.uncallout("all");
      await t.say("Recipe two: Var → Choice on a LoRA loader's name, fed by the wildcard that picked the style, so the LoRA follows the pick. Recipe three: Var → Int on steps, with a Toggles switch for quick drafts.", "Recipe two: Var to Choice on a LoRA loader's name, fed by the wildcard that picked the style, so the LoRA follows the pick. Recipe three: Var to Int on steps, with a Toggles switch for quick drafts.");
      await t.waitVoice();
    });

    await t.h.step("Gotchas", async () => {
      await t.say("Hide the variables they read, with the globe, or the numbers print in your prompt. A size like eight thirty two by twelve sixteen is two numbers: one node per number, each with its index.");
      await t.waitVoice();
      await t.say("And Choice's fallback list only fills once choice is wired into a dropdown.", "And Choice's fallback list only fills once its output is wired into a dropdown.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for a Var node whenever a rule should decide a setting, not just a word. The Var nodes page in the docs lists every field.");
      await t.waitVoice();
    });
  },
);
