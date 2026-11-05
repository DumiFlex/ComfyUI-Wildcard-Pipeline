// Example 2: a tour of the "Batches and grids" example workflow: a Context Loop sweeping Shot × Light
// into nine frames, a label per frame, Quick / Full toggles, and Label & Grid's XY sheet. Run when the
// pack makes real images (showcase).
import { openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "E2",
  {
    title: "Example: Batches and grids",
    description: "A tour of the Batches and grids example: one run makes nine images of the same person, three shots against three lights, as a labelled grid.",
    learn: "Sweep combinations, holding picks, labels, Quick and Full, Label & Grid, Seed List.",
  },
  async (t) => {
    const page = t.page;
    const stop = async (row: number) => {
      await t.click(page.locator(`[data-test="bm-dock-row-${row}"]`));
      await t.beat(1200);
    };

    await t.h.step("Open it", async () => {
      await t.go("/");
      await t.say("Open Templates, ComfyUI Wildcard Pipeline, and Batches and grids.");
      await openExample(t, "2 - Batches and grids");
      await useCheckpoint(t);
      await t.waitVoice();
      await stop(0);
      await t.say("One run makes nine images of the same person in the same place: three shots against three kinds of light, as a labelled grid.");
      await t.waitVoice();
    });

    await t.h.step("The steps", async () => {
      await stop(1);
      await t.say("The Context Loop runs everything after it once per frame. Sweep combinations walks Shot against Light: nine frames. Hold other picks keeps the person, outfit and place the same, so only the swept lists change.");
      await t.waitVoice();
      await stop(2);
      await t.say("The Assembler writes each frame's prompt. A second one writes its label, shot and light, which become the grid's rows and columns.");
      await t.waitVoice();
      await stop(3);
      await t.say("WP Toggles in Pick one mode: Quick for a fast, rough grid, Full for the real thing. Its value sets the steps, and a switch picks a smaller latent for Quick.");
      await t.waitVoice();
      await stop(4);
      await t.say("Pick your model and press Run once. The sampler seed is fixed, so only the prompt changes between cells.");
      await t.waitVoice();
    });

    if (showcasing(t)) {
      await t.h.step("Run it", async () => {
        await t.fastForward(() => t.run(), 8);
        await stop(5);
        await t.say("Label and Grid lays the nine out: shots down, lights across.");
        await t.waitVoice();
        await t.beat(1500);
      });
    } else {
      await t.h.step("The grid", async () => {
        await stop(5);
        await t.say("Label and Grid lays the nine out: shots down, lights across.");
        await t.waitVoice();
      });
    }

    await t.h.step("A seed per frame", async () => {
      await stop(6);
      await t.say("Optional: un-bypass the Seed List to give every frame its own sampler seed.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Swap the swept lists for any two you like, and the grid compares them.");
    });
  },
);
