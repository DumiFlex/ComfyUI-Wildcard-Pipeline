// Nodes 18: WP Var → Choice in depth (the depth standard). The shared Var scene; Var → Choice reads
// $sampler ("dpmpp 2m") into a KSampler's sampler_name (so its fallback list fills, and the line under
// the picker names what it feeds) and a Preview as Text: context, var_name, match (loose finds
// dpmpp_2m, exact misses → fallback, closest), fallback, if_no_match (use fallback / stop the run),
// choice (out), a missing variable, how it works, recipes (checkpoint, LoRA, scheduler), gotchas.
import { tutorial } from "../tutorial.js";
import { buildVarScene, chooseCombo, pickVar, readOf, runVar, widget } from "../var-scene.js";

tutorial(
  "N18",
  {
    title: "WP Var → Choice in depth",
    description: "Fill any dropdown from a $variable: a sampler, scheduler, checkpoint or LoRA, with exact, loose or closest matching, a fallback, and stopping on no match.",
    learn: "context, var_name, match, fallback, if_no_match, choice, and driving dropdowns from your rules.",
  },
  async (t) => {
    const n = await t.h.step("What it's for", async () => {
      const s = await buildVarScene(t, () => t.say("WP Var to Choice feeds a variable into any dropdown. First, the small workflow every Var video shares."));
      await t.say("Settings per model also picks a sampler for each family: dpmpp 2m for SDXL. A KSampler's sampler name is a dropdown, and a dropdown only takes one of its own entries.");
      await t.waitVoice();
      await t.say("WP Var → Choice turns a variable into one of a dropdown's entries: a sampler, a scheduler, a checkpoint, a VAE, a LoRA.", "WP Var to Choice turns a variable into one of a dropdown's entries: a sampler, a scheduler, a checkpoint, a VAE, a LoRA.");
      await t.waitVoice();
      return s;
    });

    const v = await t.h.step("context, var_name and choice", async () => {
      await t.say("Add it, wire the Context into context, and pick sampler.");
      const id = await t.addNode("WP Var → Choice", { x: 900, y: 300 });
      await t.wire(n.ctx, "context", id, "context");
      await pickVar(t, id, "sampler");
      await t.waitVoice();
      await t.say("Wire choice (out) into a KSampler's sampler_name, and into Preview as Text so it runs without a model.", "Wire its choice output into a KSampler's sampler name, and into Preview as Text so it runs without a model.");
      const ks = await t.addNode("KSampler", { x: 1700, y: 250 });
      await t.wire(id, "choice", ks, "sampler_name");
      await t.say("The KSampler gets the entry itself. The preview shows the text, so you can read what was picked.");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 300 });
      await t.wire(id, "choice", p, "source");
      await t.waitVoice();
      const wired = t.node(id).locator('[data-test="var-picker-wired"]');
      if (await wired.isVisible().catch(() => false)) {
        await t.callout("w", wired, "What it feeds", 4);
        await t.say("The line under the picker names what it feeds, and how many entries that dropdown has.");
        await t.waitVoice();
        await t.uncallout("w");
      }
      return id;
    });

    await t.h.step("fallback", async () => {
      await t.callout("fb", widget(t, v, "fallback"), "Filled from the KSampler", 4);
      await t.say("fallback filled itself with the KSampler's own sampler list when you wired it. It's used when nothing matches or the variable is empty. Choose euler.", "Fallback filled itself with the KSampler's own sampler list when you wired it. It's used when nothing matches or the variable is empty. Choose euler.");
      await chooseCombo(t, v, "fallback", /^euler$/);
      await t.waitVoice();
      await t.uncallout("fb");
    });

    await t.h.step("match", async () => {
      await t.callout("m", widget(t, v, "match"), "How close is close enough", 4);
      await t.say("match decides how close the text must be. The rule says dpmpp 2m with a space; the list says dpmpp underscore 2m.", "Match decides how close the text must be. The rule says dpmpp 2m with a space; the list says dpmpp underscore 2m.");
      await t.waitVoice();
      await t.uncallout("m");
      await t.say("Loose, the default, ignores capitals, folders, the file ending, and spaces, underscores, dashes and dots. Then it also takes an entry that starts with, or contains, the text. Run.");
      await runVar(t);
      await t.callout("r", readOf(t, v), "Matched", 5);
      await t.say("It found dpmpp underscore 2m.");
      await t.waitVoice();
      await t.uncallout("r");
      await t.say("Exact wants the very same text. Switch to exact, and run.");
      await chooseCombo(t, v, "match", /^exact$/);
      await runVar(t);
      await t.callout("r", readOf(t, v), "The fallback", 5);
      await t.say("No entry is exactly dpmpp space 2m, so it uses euler, and warns you.");
      await t.waitVoice();
      await t.uncallout("r");
      await t.say("Closest takes whichever entry is nearest, even a rough guess. Good for a typo, risky for a model name. Back to loose.");
      await chooseCombo(t, v, "match", /^loose$/);
      await t.waitVoice();
    });

    await t.h.step("if_no_match", async () => {
      await t.callout("nm", widget(t, v, "if_no_match"), "Fallback, or stop", 4);
      await t.say("if_no_match says what happens when nothing matches. use fallback carries on and warns. stop the run stops here, and lists some of the entries it had.", "If no match says what happens when nothing matches. Use fallback carries on and warns. Stop the run stops here, and lists some of the entries it had.");
      await t.waitVoice();
      await t.uncallout("nm");
      await t.say("Set it to stop the run, switch Settings per model off so sampler is empty, and run.");
      await chooseCombo(t, v, "if_no_match", /stop/);
      await t.click(t.moduleRow(n.ctx, "Settings per model").locator('[data-test="module-enabled"]'));
      await t.beat(400);
      await t.run();
      await t.beat(1200);
      await t.say("The run stops at the Var node and says why. For a checkpoint that beats quietly running the wrong model. Close it, and put things back.");
      await t.waitVoice();
      await t.press("Escape");
      await t.beat(400);
      await chooseCombo(t, v, "if_no_match", /fallback/);
      await t.click(t.moduleRow(n.ctx, "Settings per model").locator('[data-test="module-enabled"]'));
      await t.beat(400);
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("At run time it reads the variable, compares it with the entries of the dropdown its output feeds, and sends the one that matches. In a Context Loop each frame can choose its own.");
      await t.waitVoice();
      await t.say("Recipes: a checkpoint per style, with stop the run. A LoRA loader's name from the wildcard that picked the style, so the LoRA follows the pick. A scheduler per model family.");
      await t.waitVoice();
      await t.say("Gotchas: the fallback list only fills once choice is wired into a dropdown, and rewiring it to another dropdown refills it. A checkpoint name in a subfolder matches loosely without the folder.", "Gotchas: the fallback list only fills once the output is wired into a dropdown, and rewiring it to another dropdown refills it. A checkpoint name in a subfolder matches loosely without the folder.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for Var → Choice whenever a rule should pick a dropdown entry. The Var nodes page in the docs explains each match mode.", "Reach for Var to Choice whenever a rule should pick a dropdown entry. The Var nodes page in the docs explains each match mode.");
      await t.waitVoice();
    });
  },
);
