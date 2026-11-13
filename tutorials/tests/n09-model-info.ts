// Nodes 9: WP Model Info in depth (the depth standard). The showcase loader (Flux 3 Klein, or the
// `checkpoint` param) → WP Model Info → a Context with Settings per model → WP Debug. The job, the
// inputs (model, upstream) and the output, Detected (variant and name at once, family after a run),
// the globes, a pinned name that misses every rule (the novaCartoon case) and a rule added for it
// lighting up, rule order / capitals / "|" / a broken row / Reset, a pinned variant, wired
// family / variant / name inputs, how it follows the model wire, recipes and gotchas. The loader runs,
// so it needs the model files: it records where they exist.
import { StepError } from "watchwright";
import { addDebugUnder, modelFile, tutorial } from "../tutorial.js";

tutorial(
  "N09",
  {
    title: "WP Model Info in depth",
    description: "Make prompts follow the loaded model: what WP Model Info detects and how, pins, your own variant rules, wired values, and the rules, pools and Var nodes that read it.",
    learn: "model and upstream inputs, Detected, globes, pins, variant rules (order, |, Reset), family / variant / name inputs, and recipes with Settings per model and Quality per model.",
  },
  async (t) => {
    const page = t.page;
    const mi = (id: string) => t.node(id);
    const pin = async (id: string, key: "family" | "variant" | "name", value: string) => {
      await t.click(mi(id).locator(`[data-test="mi-pin-${key}"]`));
      await t.beat(400);
      await t.fill(mi(id).locator(`input[data-test="mi-pin-input-${key}"], [data-test="mi-pin-input-${key}"] input`).first(), value, { cps: 14 });
      await t.press("Enter");
      await t.beat(700);
    };
    const unpin = async (id: string, key: "family" | "variant" | "name") => {
      await t.click(mi(id).locator(`[data-test="mi-pin-${key}"]`));
      await t.beat(600);
    };

    const n = await t.h.step("What it's for", async () => {
      await t.go("/");
      await t.say("One pack rarely suits every model: Pony wants score tags, Illustrious its own quality words, Flux plain sentences. WP Model Info tells every rule which model is loaded.");
      const unet = String(t.params.unet ?? "");
      const load = unet ? await t.addNode("Load Diffusion Model", { x: 160, y: 200 }) : await t.addNode("Load Checkpoint", { x: 160, y: 200 });
      const [widget, file] = unet
        ? ["unet_name", await modelFile(t, "UNETLoader", "unet_name", unet, "diffusion_models")]
        : ["ckpt_name", await modelFile(t, "CheckpointLoaderSimple", "ckpt_name", String(t.params.checkpoint ?? ""), "checkpoints")];
      await page.evaluate(
        ([id, w, f]) => {
          const g = window.app?.graph;
          const node = (g?.getNodeById(id) ?? g?.getNodeById(Number(id))) as { widgets?: { name: string; value: unknown }[] } | null | undefined;
          const x = node?.widgets?.find((v) => v.name === w);
          if (x) x.value = f;
          window.app?.canvas?.setDirty(true, true);
        },
        [load, widget, file] as const,
      );
      await t.waitVoice();
      return { load };
    });

    const id = await t.h.step("Inputs and output", async () => {
      await t.say("Add it, and wire the loader's MODEL into model.");
      const m = await t.addNode("WP Model Info", { x: 620, y: 170 });
      await t.wire(n.load, "MODEL", m, "model");
      await t.beat(800);
      await t.waitVoice();
      await t.say("It reads the family from the model itself, and follows the wire back to the loader for the file name, stepping over LoRA loaders on the way.");
      await t.waitVoice();
      await t.say("upstream takes a Context to extend, but Model Info usually goes first, because only the nodes after it see its variables. context (out) goes on to your Contexts.", "Upstream takes a Context to extend, but Model Info usually goes first, because only the nodes after it see its variables. The context output goes on to your Contexts.");
      await t.waitVoice();
      return m;
    });

    const ctx = await t.h.step("Detected", async () => {
      await t.callout("vals", [mi(id).locator('[data-test="mi-value-variant"]'), mi(id).locator('[data-test="mi-value-name"]')], "From the file name", 5);
      await t.say("Detected shows the three values and where each comes from. Variant and name appear as soon as the loader has a file.");
      await t.waitVoice();
      await t.uncallout("vals");
      await t.say("The family needs the model loaded, so it shows after the first run. Add a Context and a Debug after it, and run.");
      const c = await t.addNode("WP Context", { x: 1180, y: 170 });
      await t.wire(id, "context", c, "upstream");
      await addDebugUnder(t, c);
      await t.fastForward(() => t.run(), 10);
      await t.beat(800);
      await t.callout("fam", mi(id).locator('[data-test="mi-value-family"]'), "From the model's class", 5);
      await t.say("Now the family is there too, read from the model's own class.");
      await t.waitVoice();
      await t.uncallout("fam");
      return c;
    });

    await t.h.step("The globes", async () => {
      const globes = await mi(id).locator('[data-test^="mi-internal-"]').all();
      await t.callout("g", globes, "Hidden from prompts", 5);
      await t.say("All three start hidden. Rules, constraints and pools read them; the Assembler leaves them out of your prompt.");
      await t.waitVoice();
      await t.uncallout("g");
      await t.say("Click a globe to let one print, for a caption that names the model. Click again to hide it.");
      await t.click(mi(id).locator('[data-test="mi-internal-name"]'));
      await t.beat(600);
      await t.click(mi(id).locator('[data-test="mi-internal-name"]'));
      await t.waitVoice();
    });

    await t.h.step("Pins and variant rules", async () => {
      await t.say("A pin uses your own value instead of the detected one. Pin the name to novaCartoonXL v60, an Illustrious checkpoint.", "A pin uses your own value instead of the detected one. Pin the name to nova cartoon XL v 60, an Illustrious checkpoint.");
      await pin(id, "name", "novaCartoonXL_v60");
      await t.waitVoice();
      await t.callout("miss", mi(id).locator('[data-test="mi-value-variant"]'), "No rule matched", 5);
      await t.say("Its variant is empty: no rule found a word it knows in that name.");
      await t.waitVoice();
      await t.uncallout("miss");
      const rules = mi(id).locator('[data-test^="mi-rule-"]').filter({ has: page.locator('input[aria-label="pattern"]') });
      await t.callout("rules", rules.first().locator(".."), "Variant and pattern", 5);
      await t.say("Variant rules are rows of a variant and a pattern. The first pattern found in the file name wins, capitals don't matter, and a bar separates alternatives, like pony bar pdxl.");
      await t.waitVoice();
      await t.uncallout("rules");
      await t.say("Add a row: variant illustrious, pattern nova bar noob.");
      await t.click(mi(id).locator('[data-test="mi-add-rule"]'));
      await t.beat(500);
      const row = rules.last();
      await t.fill(row.locator('input[aria-label="variant"]'), "illustrious", { cps: 14 });
      await t.press("Tab");
      await t.fill(row.locator('input[aria-label="pattern"]'), "nova|noob", { cps: 14 });
      await t.press("Tab");
      await t.beat(700);
      await t.callout("hit", row, "This row matched", 5);
      await t.say("The row lights up, and the variant reads illustrious.");
      await t.waitVoice();
      await t.uncallout("hit");
      await t.say("A broken row is outlined in red and skipped, and Reset brings back the built-in rules.");
      await t.callout("reset", mi(id).locator('[data-test="mi-reset-rules"]'), "Built-in rules back", 4);
      await t.waitVoice();
      await t.uncallout("reset");
      await unpin(id, "name");
      await t.say("Pin a variant to try your Pony rules without loading a Pony model. Pin variant to pony.");
      await pin(id, "variant", "pony");
      await t.waitVoice();
      await t.say("Every rule now sees pony, until you click the pin again.");
      await unpin(id, "variant");
      await t.waitVoice();
    });

    await t.h.step("Wired family, variant and name", async () => {
      await t.say("family, variant and name can also come from another node, like a switch that names the model you're testing. Wire a text box into variant.", "Family, variant and name can also come from another node, like a switch that names the model you're testing. Wire a text box into variant.");
      await t.speedUp();
      const s = await t.addNode("Text (Multiline)", { x: 160, y: 640 });
      await t.click(t.node(s).locator("input, textarea").first());
      await t.type("sdxl", { cps: 30 });
      await t.press("Escape");
      await t.normalSpeed();
      try {
        await t.wire(s, "STRING", id, "variant");
      } catch {
        throw new StepError("The text box didn't wire into Model Info's variant.");
      }
      await t.beat(600);
      await t.waitVoice();
      await t.say("A wired value beats the pin and the detection; an empty one is ignored. The row says wired, and shows the value after a run. A wired name still goes through your rules.");
      await t.waitVoice();
    });

    await t.h.step("Recipes", async () => {
      await t.say("Recipe one: a rule on model family, like Settings per model, sets a size, a sampler and a CFG per family, and Var nodes carry them into the latent and sampler.");
      await t.speedUp();
      await t.pickModules(ctx, ["Settings per model"]);
      await t.normalSpeed();
      await t.waitVoice();
      await t.say("Recipe two: Quality per model has quality words tagged per variant. A Pool filtered by model variant keeps only the loaded model's words. A reference can do the same: at Quality per model, colon, dollar model variant.");
      await t.waitVoice();
      await t.say("Recipe three: model variant as a constraint's source, or a wildcard's match variable, so a pick follows the model.");
      await t.waitVoice();
    });

    await t.h.step("Gotchas", async () => {
      await t.say("A few things to know. A Context before Model Info doesn't see its variables. The family stays empty until the first run. And a file name no rule knows leaves the variant empty: add a rule, or pin it.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Put Model Info first in any workflow you share, and let rules pick the right words for whichever model is loaded. The Model Info page in the docs lists the built-in rules.");
      await t.waitVoice();
    });
  },
);
