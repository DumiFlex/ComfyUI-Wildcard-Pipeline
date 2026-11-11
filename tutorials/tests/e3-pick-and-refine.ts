// Example 3: a tour of the "Pick and refine" example: four looks of one held person drafted fast, the
// run pauses at the Image Filter (Keep all here; N12 shows picking), the picks refined at 1.5×.
import { jumpTo, openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "E3",
  {
    title: "Example: Pick and refine",
    description: "A tour of the Pick and refine example: quick drafts of one person in four looks, a pause to pick the keepers, and a refine pass on only those.",
    learn: "Hold across run, quick drafts, the Image Filter pause, a second pass on the picks.",
  },
  async (t) => {
    const page = t.page;
    // Each step's jump zooms in to a readable size and boxes the step's note.
    const stop = async (row: number) => {
      await jumpTo(t, row);
    };

    await t.h.step("Open it", async () => {
      await t.go("/");
      await t.say("Open Templates, ComfyUI Wildcard Pipeline, and Pick and refine.");
      await openExample(t, "3 - Pick and refine");
      await useCheckpoint(t);
      await t.waitVoice();
      await stop(0);
      await t.say("A fashion shoot: one person in four looks. The run pauses so you pick the keepers, then refines only those.");
      await t.waitVoice();
    });

    await t.h.step("The steps", async () => {
      await stop(1);
      await t.say("The Context Loop runs four times. The person's rows are held across the run, so all four frames show the same person, while the outfit, place and light roll.");
      await t.waitVoice();
      await stop(2);
      await t.say("The drafts come out fast, each frame with its own seed from the Seed List.");
      await t.waitVoice();
      await stop(3);
      await t.say("The run pauses at the Image Filter. Each pick keeps its own latent, prompt and label.");
      await t.waitVoice();
      await stop(4);
      await t.say("Only the picks go on: upscaled by one and a half and sampled again at half denoise.");
      await t.waitVoice();
    });

    if (showcasing(t)) {
      await t.h.step("Run it", async () => {
        const picker = page.locator('[data-test="image-filter-picker"]');
        await t.say("Run. When the picker opens, keep them all this time.");
        await t.click(page.getByRole("button", { name: "Run", exact: true }).first());
        await t.fastForward(() => picker.waitFor({ state: "visible", timeout: 10 * 60_000 }), 8);
        await t.callout("picker", picker, "The picker", 6);
        await t.beat(2000);
        await t.uncallout("picker");
        await t.click(page.locator('[data-test="image-filter-keep-all"]'));
        await t.fastForward(async () => {
          await t.h.waitUntil(
            async () => {
              const q = await t.h.api("/queue");
              const j = q.json as { queue_running?: unknown[]; queue_pending?: unknown[] } | undefined;
              return !!j && (j.queue_running?.length ?? 0) === 0 && (j.queue_pending?.length ?? 0) === 0;
            },
            { timeout: 10 * 60_000, interval: 500, what: "the run to finish" },
          );
        }, 8);
        await stop(5);
        await t.say("The refined picks, each under its look.");
        await t.waitVoice();
      });
    } else {
      await t.h.step("The picks", async () => {
        await stop(5);
        await t.say("And the refined picks land here, each under its look.");
        await t.waitVoice();
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Draft many, keep few, refine those. The Image Filter video shows the picker in full.");
    });
  },
);
