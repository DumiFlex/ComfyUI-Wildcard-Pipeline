// Example 1: a tour of the "One image" example workflow. Opened from ComfyUI's Templates, walked
// through with its own Bookmarks dock (each step note is a bookmark), then run when the pack makes real
// images (showcase).
import { jumpTo, openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "E1",
  {
    title: "Example: One image",
    description: "A tour of the One image example: a person, outfit, place, light and camera rolled from lists that come with the workflow.",
    learn: "Opening an example, following its steps with the Bookmarks dock, and what each part does.",
  },
  async (t) => {
    const page = t.page;
    // Each step's jump zooms in to a readable size and boxes the step's note.
    const stop = async (row: number) => {
      await jumpTo(t, row);
    };

    await t.h.step("Open it", async () => {
      await t.go("/");
      await t.say("The extension ships example workflows. Open Templates, then ComfyUI Wildcard Pipeline under Extensions, and pick One image.");
      await openExample(t, "1 - One image");
      await t.waitVoice();
      await t.callout("dock", page.locator('[data-test="bm-dock"]'), "Its steps, in order", 5);
      await t.say("Its notes are bookmarks, so the Bookmarks dock lists the steps. Click one, or press its number.");
      await t.waitVoice();
      await t.uncallout("dock");
    });

    await t.h.step("Start here", async () => {
      await stop(0);
      await t.say("Start here says what it makes: every run rolls a person, what they wear, where they are, the light and the camera. The lists come with the workflow, so nothing has to be in your library.");
      await t.waitVoice();
    });

    await t.h.step("The steps", async () => {
      await stop(1);
      await t.say("Step one: pick your model in Load Checkpoint. The two LoRA loaders under it stay bypassed until you switch them on.");
      await t.waitVoice();
      await useCheckpoint(t);
      await stop(2);
      await t.say("Step two: who is in the picture. Each Context holds bundles, packs of lists that work together. Click a header to open one. Constraints keep the outfit right for the place, and a derivation hides details a close-up can't show.");
      await t.waitVoice();
      await stop(3);
      await t.say("Step three, optional: WP Toggles is the switchboard. Turn a LoRA on and it un-bypasses its loader and puts its trigger words in the prompt.");
      await t.waitVoice();
      await stop(4);
      await t.say("Step four: the Assembler writes the prompt, the negatives ride along, and the Cleaner tidies the commas.");
      await t.waitVoice();
      await stop(5);
      await t.say("Step five: Run. Every run rolls new picks; fix a Context's seed to repeat one.");
      await t.waitVoice();
      await stop(6);
      await t.say("Step six, optional: Model Info reads the loaded model, so the size, sampler and quality words follow it.");
      await t.waitVoice();
    });

    if (showcasing(t)) {
      await t.h.step("Run it", async () => {
        await t.say("Run, and see what it rolls.");
        await t.fastForward(() => t.run(), 8);
        await stop(7);
        await t.say("The image. Run again for someone new.");
        await t.waitVoice();
        await t.fastForward(() => t.run(), 8);
        await t.beat(1500);
      });
    } else {
      await t.h.step("The image", async () => {
        await stop(7);
        await t.say("And the image lands here.");
        await t.waitVoice();
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Add this workflow's lists to your library with the button on Start here, and make them yours.");
    });
  },
);
