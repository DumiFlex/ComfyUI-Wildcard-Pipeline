// Nodes 17: WP Var → Float in depth (the depth standard). The shared Var scene; Var → Float reads
// $cfg into a KSampler's cfg and a Preview as Text: context, var_name, index (past the last number →
// default), default, value (out), what counts as a number (integers, decimals, minus, 3.2e-4), how it
// works, recipes (CFG per model, denoise from a toggle, LoRA strength), gotchas.
import { tutorial } from "../tutorial.js";
import { buildVarScene, pickVar, readOf, runVar, setNumber, widget } from "../var-scene.js";

tutorial(
  "N17",
  {
    title: "WP Var → Float in depth",
    description: "Turn a $variable into a decimal for any node setting: CFG, denoise, a LoRA strength, with the index, default and what counts as a number.",
    learn: "context, var_name, index, default, value, and driving CFG or denoise from your rules.",
  },
  async (t) => {
    const n = await t.h.step("What it's for", async () => {
      const s = await buildVarScene(t);
      await t.say("Settings per model also sets a CFG for each model family: six for SDXL, one for Flux. A KSampler's cfg wants a decimal number, not a variable.");
      await t.waitVoice();
      await t.say("WP Var → Float takes a decimal out of a variable, for CFG, denoise, a LoRA strength, or any other decimal setting.", "WP Var to Float takes a decimal out of a variable, for CFG, denoise, a LoRA strength, or any other decimal setting.");
      await t.waitVoice();
      return s;
    });

    const v = await t.h.step("context and var_name", async () => {
      await t.say("Add it, wire the Context into context, and pick cfg from var_name's list.", "Add it, wire the Context into context, and pick cfg from var name's list.");
      const id = await t.addNode("WP Var → Float", { x: 900, y: 110 });
      await t.wire(n.ctx, "context", id, "context");
      await pickVar(t, id, "cfg");
      await t.waitVoice();
      return id;
    });

    await t.h.step("value (out)", async () => {
      await t.say("Wire value (out) into a KSampler's cfg, and into Preview as Text so it runs without a model. Run.", "Wire its value into a KSampler's cfg, and into Preview as Text so it runs without a model. Run.");
      const ks = await t.addNode("KSampler", { x: 1700, y: 110 });
      await t.wire(v, "value", ks, "cfg");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 110 });
      await t.wire(v, "value", p, "source");
      await runVar(t);
      await t.callout("read", readOf(t, v), "What it read", 5);
      await t.say("The node shows what it read: six point zero, from cfg. A whole number reads as a decimal too.");
      await t.waitVoice();
      await t.uncallout("read");
    });

    await t.h.step("index and default", async () => {
      await t.callout("idx", widget(t, v, "index"), "Which number", 4);
      await t.say("index picks a number when the text has several, zero first. Set it to one, past the only number cfg has, and run.", "Index picks a number when the text has several, zero first. Set it to one, past the only number cfg has, and run.");
      await setNumber(t, v, "index", "1");
      await runVar(t);
      await t.waitVoice();
      await t.uncallout("idx");
      await t.callout("def", widget(t, v, "default"), "Used instead", 4);
      await t.say("Nothing there, so it gives default. The same happens when the variable is missing or holds no number. It never stops a run.", "Nothing there, so it gives the default. The same happens when the variable is missing or holds no number. It never stops a run.");
      await t.waitVoice();
      await t.uncallout("def");
      await setNumber(t, v, "index", "0");
    });

    await t.h.step("What counts as a number", async () => {
      await t.say("It finds whole numbers too, so a variable holding 7 gives seven point zero. A minus sign and scientific notation like three point two e minus four work as well.");
      await t.waitVoice();
      await t.say("So a variable can hold words around its number, like strength 0.8, and the node still finds it.");
      await t.waitVoice();
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("At run time it reads the variable as text and takes the decimal at the index. In a Context Loop it runs per frame, so each frame can use its own value.");
      await t.waitVoice();
      await t.say("Recipes: CFG per model family, as here. Denoise for a refine pass from a Toggles switch with a Value of 0.4 or 0.7. A LoRA's strength from the same rule that picked the LoRA.");
      await t.waitVoice();
      await t.say("Gotchas: a decimal written with a comma, like 0,8, reads as two numbers, zero and eight. Hide the variable with its globe so the number doesn't print, and put the node after the Context that sets it.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for Var → Float whenever a rule should decide a decimal setting. The Var nodes page in the docs lists every field.", "Reach for Var to Float whenever a rule should decide a decimal setting. The Var nodes page in the docs lists every field.");
      await t.waitVoice();
    });
  },
);
