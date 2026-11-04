// Advanced 15: model-aware prompts. A checkpoint loader feeds WP Model Info, which writes
// $model_family (from the model), $model_variant (file-name rules) and $model_name. A Context after it
// runs Settings per model, and the Assembler prints what was read. Run with Preview as Text.
// Needs the showcase checkpoint (param `checkpoint`), so it only records where that model exists.
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";

tutorial(
  "A15",
  {
    title: "Model-aware prompts",
    description: "Let WP Model Info read the loaded checkpoint, and make rules, LoRAs and quality words follow the model family and variant.",
    learn: "$model_family, $model_variant and $model_name, variant rules, and rules per model.",
  },
  async (t) => {
    const nodes = await t.h.step("Read the model", async () => {
      await t.go("/");
      await t.say("One pack rarely suits every model. Pony wants its score tags, Illustrious other LoRAs, Flux plain sentences. WP Model Info tells the pipeline which model is loaded.");
      const ckpt = String(t.params.checkpoint ?? "");
      const info = await t.h.api("/object_info/CheckpointLoaderSimple");
      const known = ((info.json as Record<string, { input?: { required?: { ckpt_name?: [string[]] } } }> | undefined)?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? []) as string[];
      const name = known.find((k) => k.replace(/\.(safetensors|ckpt)$/i, "") === ckpt.replace(/\.(safetensors|ckpt)$/i, ""));
      if (!name) throw new StepError(`The checkpoint "${ckpt}" isn't in ComfyUI's models/checkpoints.`);
      const load = await t.addNode("Load Checkpoint", { x: 60, y: 170 });
      await t.page.evaluate(
        ([id, n]) => {
          const node = window.app?.graph?.getNodeById(Number(id)) as { widgets?: { name: string; value: unknown }[] } | null | undefined;
          const w = node?.widgets?.find((x) => x.name === "ckpt_name");
          if (w) w.value = n;
        },
        [load, name] as const,
      );
      await t.beat(600);
      const mi = await t.addNode("WP Model Info", { x: 500, y: 170 });
      await t.wire(load, "MODEL", mi, "model");
      await t.beat(800);
      await t.waitVoice();
      await t.callout("mi", t.node(mi), "Family, variant and file name", 4);
      await t.say("Wire the checkpoint's model into it. It writes three variables: model family, from the model itself, model variant, from the file name, and model name.");
      await t.waitVoice();
      await t.uncallout("mi");
      await t.say("Pony and Illustrious are both SDXL inside, so the family can't tell them apart. The variant rules read the file name for that, and you can add your own.");
      await t.callout("rules", t.node(mi).locator('[data-test="mi-add-rule"]'), "Your own variant rules", 4);
      await t.waitVoice();
      await t.uncallout("rules");
      return { load, mi };
    });

    await t.h.step("Rules that follow it", async () => {
      await t.say("Put it first, so every Context after it can read the model. This one runs Settings per model, which sets a size, sampler and CFG per family.");
      const ctx = await t.addNode("WP Context", { x: 960, y: 170 });
      await t.wire(nodes.mi, "context", ctx, "upstream");
      await t.pickModules(ctx, ["Hero", "Settings per model"]);
      const asm = await t.addNode("WP Prompt Assembler", { x: 1420, y: 170 });
      await t.wire(ctx, "context", asm, "context");
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      await t.type("$hero, $model_family, $model_variant, $size", { cps: 16 });
      await t.beat(600);
      const text = await t.addNode("Preview as Text", { x: 1420, y: 640 });
      await t.wire(asm, "prompt", text, "source");
      await t.waitVoice();
      await t.say("Run it. The model loads, and the prompt shows what was read.");
      await t.run();
      await t.callout("out", t.node(text), "sdxl, illustrious, and the sdxl size", 6);
      await t.waitVoice();
      await t.uncallout("out");
    });

    await t.h.step("Per family", async () => {
      await t.say("Any rule can branch on these: quality words per family, Pony's score tags only for Pony. A derivation's LoRA by model button builds one rule per model for you. A wildcard with Match variable can follow the variant too.");
      await t.waitVoice();
      await t.say("Change the checkpoint, and the same pack writes the right words for it.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("WP Model Info names the model, and your rules follow it. Next: loops and seeds.");
    });
  },
);
