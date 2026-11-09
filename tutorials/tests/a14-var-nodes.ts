// Advanced 14: Var nodes. WP Model Info, its family pinned to sdxl, sets $model_family; the
// Settings per model derivation turns that into $size, $sampler and $cfg. Two WP Var → Int read the
// width and the height out of $size into Empty Latent Image, each with a default, and WP Var → Choice
// matches $sampler against KSampler (Select)'s list with euler as its fallback. A run shows what each
// read; with the rule switched off, a second run shows the defaults and the fallback.
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
      await t.click(t.node(node).getByRole("combobox", { name: "Variable" }).first());
      await t.type(name, { cps: 14 });
      await t.beat(500);
      await t.click(page.getByRole("option", { name: new RegExp(`^\\$?${name}\\b`) }).first());
      await t.beat(500);
    };

    const nodes = await t.h.step("Settings from a rule", async () => {
      await t.go("/");
      await t.say("Rules can set more than words. Settings per model sets a size, a sampler and a CFG for each model family.");
      const mi = await t.addNode("WP Model Info", { x: 380, y: 200 });
      await t.waitVoice();
      await t.say("WP Model Info reads the model family from your checkpoint. With no model wired here, pin it instead: press the pin on model family and type sdxl.");
      await t.click(t.node(mi).locator('[data-test="mi-pin-family"]'));
      await t.beat(500);
      await t.fill(t.node(mi).locator('input[data-test="mi-pin-input-family"], [data-test="mi-pin-input-family"] input').first(), "sdxl", { cps: 12 });
      await t.press("Enter");
      await t.beat(700);
      await t.waitVoice();
      const ctx = await t.addNode("WP Context", { x: 860, y: 200 });
      await t.wire(mi, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Settings per model"]);
      await t.waitVoice();
      return { mi, ctx };
    });

    const num = (node: string, widget: string) => t.node(node).locator(`[data-widget-name="${widget}"]`);

    const vars = await t.h.step("Var → Int", async () => {
      await t.say("WP Var → Int takes a number out of a variable. Pick size: eight thirty two by twelve sixteen.");
      const vw = await t.addNode("WP Var → Int", { x: 1360, y: 150 });
      await t.wire(nodes.ctx, "context", vw, "context");
      await pickVar(vw, "size");
      await t.waitVoice();
      await t.callout("idx", num(vw, "index"), "Which number: 0 is the first", 4);
      await t.say("Index says which number. Zero is the first one, the width.");
      await t.waitVoice();
      await t.uncallout("idx");
      await t.callout("def", num(vw, "default"), "Used when there's no number", 4);
      await t.say("Default is used when the variable isn't set, or has no number at that index. Make it ten twenty four.");
      await t.fill(num(vw, "default").locator("input").first(), "1024", { cps: 10 });
      await t.press("Tab");
      await t.beat(400);
      await t.waitVoice();
      await t.uncallout("def");
      const lat = await t.addNode("Empty Latent Image", { x: 1765, y: 260 });
      await t.wire(vw, "value", lat, "width");
      await t.say("A second one, with index one, gives the height.");
      const vh = await t.addNode("WP Var → Int", { x: 1360, y: 420 });
      await t.wire(nodes.ctx, "context", vh, "context");
      await pickVar(vh, "size");
      await t.click(num(vh, "index").getByRole("button", { name: "Increment" }));
      await t.beat(300);
      await t.fill(num(vh, "default").locator("input").first(), "1024", { cps: 10 });
      await t.press("Tab");
      await t.wire(vh, "value", lat, "height");
      await t.beat(500);
      await t.waitVoice();
      return { vw, vh, lat };
    });

    const choice = await t.h.step("Var → Choice", async () => {
      await t.say("WP Var → Choice fills a drop-down. Pick sampler, and wire it into a sampler list. It matches loosely, so dpmpp 2m finds the right entry.");
      const vc = await t.addNode("WP Var → Choice", { x: 1360, y: 690 });
      await t.wire(nodes.ctx, "context", vc, "context");
      await pickVar(vc, "sampler");
      const ks = await t.addNode("KSamplerSelect", { x: 1765, y: 720 });
      await t.wire(vc, "choice", ks, "sampler_name");
      await t.beat(500);
      await t.waitVoice();
      const fb = t.node(vc).locator('[data-widget-name="fallback"]');
      await t.callout("fb", fb, "When nothing matches", 4);
      await t.say("Fallback is the entry it picks when the variable is missing or matches nothing. Choose euler.");
      await t.click(fb.getByRole("combobox").first());
      await t.beat(500);
      await t.click(page.getByRole("option", { name: /^euler$/ }).first());
      await t.beat(500);
      await t.waitVoice();
      await t.uncallout("fb");
      return { vc, ks };
    });

    await t.h.step("Run", async () => {
      await t.say("Run, and each Var node shows what it read.");
      await t.run();
      await t.callout("w", t.node(vars.vw).locator('[data-test="var-picker-preview"]'), "832", 6);
      await t.callout("h", t.node(vars.vh).locator('[data-test="var-picker-preview"]'), "1216", 6);
      await t.callout("ch", t.node(choice.vc).locator('[data-test="var-picker-preview"]'), "dpmpp 2m, matched", 6);
      await t.waitVoice();
      await t.uncallout("w");
      await t.uncallout("h");
      await t.uncallout("ch");
    });

    await t.h.step("When the variable is missing", async () => {
      await t.say("Now switch Settings per model off on the Context, so nothing sets them, and run again.");
      await t.click(t.moduleRow(nodes.ctx, "Settings per model").locator('[data-test="module-enabled"]'));
      await t.beat(500);
      await t.run();
      await t.callout("w", t.node(vars.vw).locator('[data-test="var-picker-preview"]'), "The default: 1024", 6);
      await t.callout("ch", t.node(choice.vc).locator('[data-test="var-picker-preview"]'), "The fallback: euler", 6);
      await t.say("The sizes fall back to ten twenty four, and the sampler to euler, so the workflow still runs.");
      await t.waitVoice();
      await t.uncallout("w");
      await t.uncallout("ch");
      await t.click(t.moduleRow(nodes.ctx, "Settings per model").locator('[data-test="module-enabled"]'));
      await t.beat(400);
      await t.say("Var → Float does the same for decimals, like a CFG, and Var → Bool for on and off switches. Hide the variables they read, so the numbers don't print in your prompt.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("With Var nodes, your rules can set sizes, samplers, CFG and switches, not just words. Next: prompts that follow the model.");
    });
  },
);
