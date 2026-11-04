// Advanced 14: Var nodes. An Injector stands in for WP Model Info and sets $model_family = sdxl; the
// Settings per model derivation turns that into $size, $sampler and $cfg. WP Var → Int reads the width
// out of $size into Empty Latent Image, and WP Var → Choice matches $sampler against KSampler (Select)'s
// list. Run with Preview as Text; each Var node shows what it read.
import { tutorial } from "../tutorial.js";

tutorial(
  "A14",
  {
    title: "Var nodes",
    description: "Send a $variable into a node's settings: a width from $size, a sampler from $sampler, a CFG or an on/off switch.",
    learn: "WP Var → Int, Float, Choice and Bool, and driving settings from your rules.",
  },
  async (t) => {
    const page = t.page;
    const pickVar = async (node: string, name: string) => {
      await t.click(t.node(node).locator('[data-test="var-picker-trigger"]').locator("input").first());
      await t.type(name, { cps: 14 });
      await t.beat(500);
      await t.click(page.getByRole("option", { name: new RegExp(`^\\$?${name}\\b`) }).first());
      await t.beat(500);
    };

    const nodes = await t.h.step("Settings from a rule", async () => {
      await t.go("/");
      await t.say("Rules can set more than words. Settings per model sets a size, a sampler and a CFG for each model family.");
      const inj = await t.addNode("WP Context Injector", { x: 275, y: 170 });
      await t.click(t.node(inj).locator('[data-test="inj-add-general"]'));
      await t.beat(500);
      await t.fill(t.node(inj).locator('[data-test="inj-row-binding"] input').last(), "model_family", { cps: 14 });
      await t.press("Tab");
      await t.beat(400);
      await t.click(t.node(inj).locator('[data-test="inj-row-general-tag"]').last(), { right: true });
      await t.beat(500);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(800);
      await t.click(page.locator('[data-test="ibm-template"]').locator('[contenteditable="true"], textarea').first());
      await t.type("sdxl", { cps: 12 });
      await t.click(page.locator('[data-test="ibm-save"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.say("Here an Injector says the model is sdxl. In a real workflow, WP Model Info reads it from your checkpoint: that's the next tutorial.");
      const ctx = await t.addNode("WP Context", { x: 800, y: 170 });
      await t.wire(inj, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Settings per model"]);
      await t.waitVoice();
      return { inj, ctx };
    });

    const vars = await t.h.step("Var → Int", async () => {
      await t.say("WP Var → Int takes a number out of a variable. Pick size: eight thirty two by twelve sixteen. Index zero is the first number, the width.");
      const vi = await t.addNode("WP Var → Int", { x: 1330, y: 140 });
      await t.wire(nodes.ctx, "context", vi, "context");
      await pickVar(vi, "size");
      const lat = await t.addNode("Empty Latent Image", { x: 1725, y: 140 });
      await t.wire(vi, "value", lat, "width");
      const p1 = await t.addNode("Preview as Text", { x: 1725, y: 400 });
      await t.wire(lat, "LATENT", p1, "source");
      await t.waitVoice();
      await t.say("A second one with index one would give the height.");
      await t.waitVoice();
      return { vi, lat };
    });

    const choice = await t.h.step("Var → Choice", async () => {
      await t.say("WP Var → Choice fills a drop-down. Pick sampler, and wire it into a sampler list. It matches loosely, so dpmpp 2m finds the right entry.");
      const vc = await t.addNode("WP Var → Choice", { x: 1330, y: 560 });
      await t.wire(nodes.ctx, "context", vc, "context");
      await pickVar(vc, "sampler");
      const ks = await t.addNode("KSamplerSelect", { x: 1725, y: 640 });
      await t.wire(vc, "choice", ks, "sampler_name");
      const p2 = await t.addNode("Preview as Text", { x: 1725, y: 820 });
      await t.wire(ks, "SAMPLER", p2, "source");
      await t.waitVoice();
      return { vc };
    });

    await t.h.step("Run", async () => {
      await t.say("Run, and each Var node shows what it read.");
      await t.run();
      await t.callout("int", t.node(vars.vi).locator('[data-test="var-picker-preview"]'), "832, from 832x1216", 6);
      await t.callout("ch", t.node(choice.vc).locator('[data-test="var-picker-preview"]'), "The matched sampler", 6);
      await t.waitVoice();
      await t.uncallout("int");
      await t.uncallout("ch");
      await t.say("Var → Float does the same for decimals, like a CFG, and Var → Bool for on and off switches. Hide the variables they read, so the numbers don't print in your prompt.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("With Var nodes, your rules can set sizes, samplers, CFG and switches, not just words. Next: prompts that follow the model.");
    });
  },
);
