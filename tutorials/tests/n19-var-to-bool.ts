// Nodes 19: WP Var → Bool in depth (the depth standard). The shared Var scene; Var → Bool reads
// $hires, the toggle's variable, into ComfyUI's If/Else Switch and a Preview as Text: context, var_name,
// the yes/no words, index (only yes/no words count), default, value (out), $name.bool for a toggle
// with a Value, how it works, recipes (a hires branch, a LoRA on/off, a Switch between two latents),
// gotchas.
import { tutorial } from "../tutorial.js";
import { buildVarScene, pickVar, readOf, runVar, setNumber, widget } from "../var-scene.js";

tutorial(
  "N19",
  {
    title: "WP Var → Bool in depth",
    description: "Turn a $variable into true or false for any switch: the words that count, which one to read, the default, and Toggles values.",
    learn: "context, var_name, the yes/no words, index, default, value, $name.bool, and switching branches from your rules.",
  },
  async (t) => {
    const n = await t.h.step("What it's for", async () => {
      const s = await buildVarScene(t);
      await t.say("A Toggles node here has a Hires switch, and rules can write yes or no words too. A switch node in ComfyUI wants true or false.");
      await t.waitVoice();
      await t.say("WP Var → Bool turns a variable into true or false, for any switch: a hires pass on or off, one latent or another.", "WP Var to Bool turns a variable into true or false, for any switch: a hires pass on or off, one latent or another.");
      await t.waitVoice();
      return s;
    });

    const v = await t.h.step("context, var_name and value", async () => {
      await t.say("Add it, wire the Context into context, and pick hires, the toggle's variable.");
      const id = await t.addNode("WP Var → Bool", { x: 900, y: 300 });
      await t.wire(n.ctx, "context", id, "context");
      await pickVar(t, id, "hires");
      await t.waitVoice();
      await t.say("Wire value (out) into Preview as Text, and run.", "Wire its value into Preview as Text, and run.");
      const p = await t.addNode("Preview as Text", { x: 1330, y: 300 });
      await t.wire(id, "value", p, "source");
      await runVar(t);
      await t.callout("r", readOf(t, id), "false", 5);
      await t.say("The toggle is off, so false.");
      await t.waitVoice();
      await t.uncallout("r");
      await t.say("Switch Hires on, and run again.");
      await t.click(t.node(n.tg).locator('[data-test^="tg-ctl-"]').first());
      await t.beat(400);
      await runVar(t);
      await t.callout("r", readOf(t, id), "true", 5);
      await t.say("True.");
      await t.waitVoice();
      await t.uncallout("r");
      return id;
    });

    await t.h.step("The words that count", async () => {
      await t.say("True, yes, on and one count as true. False, no, off and zero count as false, in any capitals. Any other word is skipped.");
      await t.waitVoice();
      await t.callout("idx", widget(t, v, "index"), "Which yes or no word", 4);
      await t.say("index says which yes or no word to use when the text has several, zero first. Skipped words don't count, so in hires: yes, upscale: no, index one is the no.", "Index says which yes or no word to use when the text has several, zero first. Skipped words don't count, so in hires yes, upscale no, index one is the no.");
      await t.waitVoice();
      await t.uncallout("idx");
      await t.callout("def", widget(t, v, "default"), "When there's none", 4);
      await t.say("default is used when the variable is missing or has no yes or no word. Set index to five, past the end, and run.", "Default is used when the variable is missing or has no yes or no word. Set index to five, past the end, and run.");
      await setNumber(t, v, "index", "5");
      await runVar(t);
      await t.waitVoice();
      await t.uncallout("def");
      await t.say("It gives the default, false, and the run goes on. Index back to zero.");
      await setNumber(t, v, "index", "0");
      await t.waitVoice();
    });

    await t.h.step("Toggles with a Value", async () => {
      await t.say("A toggle with a Value writes its words, like holding a lantern, instead of true. Read dollar name dot bool instead: it is always the switch, true or false.");
      await t.waitVoice();
    });

    await t.h.step("Into a switch", async () => {
      await t.say("value (out) goes into any BOOLEAN input. Add ComfyUI's If/Else Switch and wire it into switch: it passes on one input or the other.", "Its value goes into any BOOLEAN input. Add ComfyUI's If Else Switch and wire it into switch: it passes on one input or the other.");
      // "Switch" alone finds another node first; ComfyUI's own is "If/Else Switch" (ComfySwitchNode).
      const sw = await t.addNode("If/Else Switch", { x: 1330, y: 640 });
      await t.wire(v, "value", sw, "switch");
      await t.waitVoice();
      await t.say("Wire a quick latent into one side and a full-size one into the other, and the toggle picks between them, as the Batches and grids example does.");
      await t.waitVoice();
    });

    await t.h.step("How it works, recipes and gotchas", async () => {
      await t.say("At run time it reads the variable as text, splits it on spaces, commas and slashes, and keeps only the yes and no words. In a Context Loop each frame gets its own answer.");
      await t.waitVoice();
      await t.say("Recipes: a hires branch that only runs when a rule says so, a LoRA switched on for one style, a quick-preview switch for every sampler.");
      await t.waitVoice();
      await t.say("Gotchas: enabled or disabled aren't yes or no words, so they give the default. And put the node after the Context that sets the variable.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Reach for Var → Bool whenever a rule or a toggle should flip a switch. The Var nodes page in the docs lists every field.", "Reach for Var to Bool whenever a rule or a toggle should flip a switch. The Var nodes page in the docs lists every field.");
      await t.waitVoice();
    });
  },
);
