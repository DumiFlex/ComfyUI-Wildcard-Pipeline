// Advanced 15: model-aware prompts. The showcase model's loader (Flux 3 Klein by default, or the
// `checkpoint` param) feeds WP Model Info, which writes $model_family, $model_variant and $model_name,
// all internal, so the Assembler never prints them. A variant rule of our own names Klein. A Context
// after it rolls Role, Setting and Quality per model, whose Pool is filtered by $model_variant, so only
// the loaded model's quality words roll. Run with Preview as Text. Needs the model files, so it only
// records where they exist.
import { modelFile, tutorial } from "../tutorial.js";

tutorial(
  "A15",
  {
    title: "Model-aware prompts",
    description: "Let WP Model Info read the loaded model, and make a list keep only the options for that model with a Pool filtered by $model_variant.",
    learn: "$model_family, $model_variant and $model_name, your own variant rules, and a Pool filtered by a variable.",
  },
  async (t) => {
    const page = t.page;

    const nodes = await t.h.step("Read the model", async () => {
      await t.go("/");
      await t.say("One pack rarely suits every model. Pony wants its score tags, Illustrious its own quality words, Flux plain sentences. WP Model Info tells the pipeline which model is loaded.");
      const unet = String(t.params.unet ?? "");
      const load = unet ? await t.addNode("Load Diffusion Model", { x: 200, y: 200 }) : await t.addNode("Load Checkpoint", { x: 200, y: 200 });
      const [widget, file] = unet
        ? ["unet_name", await modelFile(t, "UNETLoader", "unet_name", unet, "diffusion_models")]
        : ["ckpt_name", await modelFile(t, "CheckpointLoaderSimple", "ckpt_name", String(t.params.checkpoint ?? ""), "checkpoints")];
      await t.page.evaluate(
        ([id, w, n]) => {
          const node = window.app?.graph?.getNodeById(Number(id)) as { widgets?: { name: string; value: unknown }[] } | null | undefined;
          const x = node?.widgets?.find((v) => v.name === w);
          if (x) x.value = n;
          window.app?.canvas?.setDirty(true, true);
        },
        [load, widget, file] as const,
      );
      await t.beat(600);
      const mi = await t.addNode("WP Model Info", { x: 640, y: 200 });
      await t.wire(load, "MODEL", mi, "model");
      await t.beat(800);
      await t.waitVoice();
      await t.callout("mi", t.node(mi), "Family, variant and file name", 4);
      await t.say("Wire the model into it. It writes three variables: model family, from the model itself, model variant, from the file name, and model name.");
      await t.waitVoice();
      await t.uncallout("mi");
      const internal = await t.node(mi).locator('[data-test^="mi-internal-"]').all();
      await t.callout("int", internal, "Internal: rules read them, prompts don't", 4);
      await t.say("All three are internal: rules, constraints and pools read them, but the Assembler never prints them, so they stay out of your prompt.");
      await t.waitVoice();
      await t.uncallout("int");
      return { load, mi };
    });

    await t.h.step("Your own variant", async () => {
      await t.say("The variant comes from rules that look for words in the file name. Pony and Illustrious are built in. Add one for Klein: the variant klein, when the name says klein.");
      await t.click(t.node(nodes.mi).locator('[data-test="mi-add-rule"]'));
      await t.beat(500);
      const rule = t.node(nodes.mi).locator('[data-test^="mi-rule-"]').filter({ has: page.locator('input[aria-label="variant"]') }).last();
      await t.fill(rule.locator('input[aria-label="variant"]'), "klein", { cps: 12 });
      await t.press("Tab");
      await t.fill(rule.locator('input[aria-label="pattern"]'), "klein", { cps: 12 });
      await t.press("Tab");
      await t.beat(700);
      await t.callout("variant", t.node(nodes.mi).locator('[data-test="mi-value-variant"]'), "Read from the file name", 5);
      await t.waitVoice();
      await t.uncallout("variant");
    });

    const ctx = await t.h.step("A list that follows it", async () => {
      await t.say("Quality per model has one line of quality words for each model, tagged pony, illustrious or klein. Put it in a Context after Model Info, with Role and Setting.");
      const ctx = await t.addNode("WP Context", { x: 1330, y: 200 });
      await t.wire(nodes.mi, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Role", "Setting", "Quality per model"]);
      await t.waitVoice();
      await t.say("Right-click it, press Edit, and in its Pool, under By variable, pick model variant.");
      await t.click(t.moduleRow(ctx, "Quality per model").locator(".wp-module-name"), { right: true });
      await t.beat(600);
      await t.click(page.getByRole("menuitem", { name: "Edit" }));
      await t.beat(1000);
      const modal = page.getByRole("dialog").last();
      const collapse = modal.locator('[data-test="pool-collapse"]');
      if ((await collapse.getAttribute("aria-expanded")) !== "true") {
        await t.click(collapse);
        await t.beat(500);
      }
      const vars = modal.locator('[data-test="pool-vars"]');
      await t.scrollTo(vars, { at: 0.45 });
      await t.click(vars.getByRole("combobox").first());
      await t.beat(600);
      await t.click(page.getByRole("option", { name: /\$model_variant/ }).first());
      await t.beat(600);
      await t.press("Escape");
      await t.beat(400);
      await t.callout("hint", modal.locator('[data-test="pool-vars-hint"]'), "Decided when the prompt runs", 6);
      await t.waitVoice();
      await t.say("When the prompt runs, the Pool keeps the options tagged with the variant's value. Options with no model tag would stay for every model. If the variant is empty, or no option carries it, the filter steps aside and WP Debug says so.");
      await t.waitVoice();
      await t.uncallout("hint");
      await t.click(modal.locator('[data-test="wcm-save"]'));
      await t.beat(900);
      return ctx;
    });

    await t.h.step("Run it", async () => {
      await t.say("Write the template, and run it. The model loads, and the prompt gets Klein's words.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 1330, y: 700 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("A painting of $role $setting. $quality", { cps: 16 });
      await t.beat(600);
      const text = await t.addNode("Preview as Text", { x: 1740, y: 700 });
      await t.wire(asm, "prompt", text, "source");
      await t.run();
      await t.beat(600);
      // Both sit low on the screen, under the caption: bring them up to the middle.
      await t.zoomOn(asm);
      await t.callout("out", t.node(text), "Klein's quality words", 6);
      await t.waitVoice();
      await t.uncallout("out");
      await t.say("With a Pony checkpoint loaded instead, the same Context would roll score tags. A reference can filter the same way: at Quality per model, colon, dollar model variant.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("WP Model Info names the model, and a Pool filtered by its variant keeps the right words for it. Next: loops and seeds.");
    });
  },
);
