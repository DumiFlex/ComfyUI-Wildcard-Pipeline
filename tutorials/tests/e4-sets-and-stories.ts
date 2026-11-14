// Example 4: a tour of the "Sets and stories" example: three ways to run one loop (every frame
// different, a photo shoot, a storyboard), chosen with WP Toggles in Pick one mode; the photo shoot is
// run (showcase) and kept whole at its Image Filter.
import { jumpTo, openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "E4",
  {
    title: "Example: Sets and stories",
    description: "A tour of the Sets and stories example: one loop, three ways to run it: every frame different, a photo shoot, or a storyboard.",
    learn: "Pick one toggles muting groups, held rows, per-frame picks, a story written by a derivation.",
  },
  async (t) => {
    const page = t.page;
    // Each step's jump zooms in to a readable size and boxes the step's note.
    const stop = async (row: number) => {
      await jumpTo(t, row);
    };

    await t.h.step("Open it", async () => {
      await t.go("/");
      await t.say("Open Templates, ComfyUI Wildcard Pipeline, and Sets and stories.");
      await openExample(t, "4 - Sets and stories");
      await useCheckpoint(t);
      await t.waitVoice();
      await stop(0);
      await t.say("One run makes a set of images from one loop. There are three ways to run it, one row each.");
      await t.waitVoice();
    });

    await t.h.step("Three ways", async () => {
      await stop(1);
      await t.say("Every frame different: nothing is held, so each frame rolls a new person, outfit, place and light.");
      await t.waitVoice();
      await stop(2);
      await t.say("Photo shoot: the person, outfit, place and light are held for the whole set. The shot has a pick per frame, from wide to close-up, and the pose still rolls.");
      await t.waitVoice();
      await stop(3);
      await t.say("Storyboard: a held story picks one of four scripts, and a derivation writes each frame's beat: what happens, where, the light and the shot.");
      await t.waitVoice();
    });

    await t.h.step("Pick a mode", async () => {
      await stop(4);
      await t.say("WP Toggles in Pick one mode chooses the row. Switching one on switches the others off, and mutes their groups. Pick Photo shoot.");
      await t.click(page.locator('[data-test="tg-ctl-a1f0c002"]').first());
      await t.beat(1000);
      await t.waitVoice();
    });

    if (showcasing(t)) {
      await t.h.step("Run it", async () => {
        const picker = page.locator('[data-test="image-filter-picker"]');
        await t.say("Run. The set pauses at its Image Filter; keep them all.");
        await t.click(page.getByRole("button", { name: "Run", exact: true }).first());
        await t.fastForward(() => picker.waitFor({ state: "visible", timeout: 15 * 60_000 }), 10);
        await t.beat(2000);
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
        await stop(6);
        await t.beat(1500);
        await t.say("The shoot, one sheet: the same person, shot after shot.");
        await t.waitVoice();
      });
    }

    await t.h.step("Outro", async () => {
      await t.say("Hold what should stay, roll what should change, and a loop becomes a set or a story.");
    });
  },
);
