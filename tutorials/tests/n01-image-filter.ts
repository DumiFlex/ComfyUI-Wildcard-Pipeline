// Nodes 1: WP Image Filter, on the "Pick and refine" example: four looks of one person drafted, the run
// pauses at the filter, the picker (Grid, Detail with its Values and Prompt, Zoom), two picks kept, and
// only those are refined and laid out by Label & Grid. The run needs a model, so without showcase the
// video only walks the steps.
import { jumpTo, openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "N01",
  {
    title: "WP Image Filter",
    description: "Pause a run, pick the images worth keeping, and send only those on to the expensive second pass, each with its own prompt.",
    learn: "Where the filter goes, the picker's Grid, Detail and Zoom, Values and Prompt, Keep picked, its modes.",
  },
  async (t) => {
    const page = t.page;
    const picker = page.locator('[data-test="image-filter-picker"]');
    // Each step's jump zooms in to a readable size and boxes the step's note.
    const stop = async (row: number) => {
      await jumpTo(t, row);
    };
    const queueEmpty = async () => {
      const end = await t.h.waitUntil(
        async () => {
          const q = await t.h.api("/queue");
          const j = q.json as { queue_running?: unknown[]; queue_pending?: unknown[] } | undefined;
          return !!j && (j.queue_running?.length ?? 0) === 0 && (j.queue_pending?.length ?? 0) === 0;
        },
        { timeout: 10 * 60_000, interval: 500, what: "the run to finish" },
      );
      if (end !== "done") throw new Error("The run didn't finish.");
    };

    await t.h.step("Where it goes", async () => {
      await t.go("/");
      await t.say("Open the Pick and refine example from Templates. A loop drafts four looks of one person, fast.");
      await openExample(t, "3 - Pick and refine");
      await useCheckpoint(t);
      await t.waitVoice();
      await stop(3);
      await t.say("WP Image Filter sits between the drafts and the expensive refine pass. The run pauses there and you pick. Every input has a matching output, so each pick keeps its own latent, prompt and label.");
      await t.waitVoice();
    });

    if (!showcasing(t)) {
      await t.h.step("The picker", async () => {
        await t.say("When you run it, the picker opens over the canvas with every draft. Pick the keepers, and only those reach the refine pass.");
        await t.waitVoice();
      });
    } else {
      await t.h.step("Run, and it pauses", async () => {
        await t.say("Run.");
        await t.click(page.getByRole("button", { name: "Run", exact: true }).first());
        await t.fastForward(() => picker.waitFor({ state: "visible", timeout: 10 * 60_000 }), 8);
        await t.beat(1500);
        await t.say("The run waits here. Grid shows every draft, one frame per look. Click the ones you like.");
        await t.click(page.locator('[data-test="image-filter-tile-0-0"]'));
        await t.beat(500);
        await t.click(page.locator('[data-test="image-filter-tile-2-0"]'));
        await t.beat(800);
        await t.waitVoice();
      });

      await t.h.step("Look closer", async () => {
        await t.say("Detail shows one image with what made it: Values lists each variable, coloured the same as its words in the prompt.");
        await t.click(page.locator('[data-test="image-filter-mode-detail"]'));
        await t.beat(1200);
        await t.waitVoice();
        await t.say("Prompt shows the text, and you can fix it here before the refine pass. Mask paints an area to change.");
        await t.click(page.locator('[data-test="image-filter-tab-prompt"]'));
        await t.beat(1500);
        await t.waitVoice();
        await t.say("Zoom is only the picture, to check the hands and the face. The arrow keys step through the images.");
        await t.click(page.locator('[data-test="image-filter-mode-zoom"]'));
        await t.beat(1200);
        await t.press("ArrowRight");
        await t.beat(1200);
        await t.waitVoice();
        await t.click(page.locator('[data-test="image-filter-mode-grid"]'));
        await t.beat(800);
      });

      await t.h.step("Keep the picks", async () => {
        await t.callout("keep", [page.locator('[data-test="image-filter-stop"]'), page.locator('[data-test="image-filter-keep-picked"]')], "Three ways on", 4);
        await t.say("Keep picked sends only those on. Keep all sends everything, and Stop branch skips what's after the filter.");
        await t.waitVoice();
        await t.uncallout("keep");
        await t.click(page.locator('[data-test="image-filter-keep-picked"]'));
        await t.fastForward(queueEmpty, 8);
        await stop(5);
        await t.say("The refine pass only ran on the two picks, and Label and Grid names each look.");
        await t.waitVoice();
      });
    }

    await t.h.step("Its modes", async () => {
      await stop(4);
      const filter = await page.evaluate(() => String(((window.app?.graph?.nodes ?? []) as unknown as { type: string; id: number }[]).find((n) => n.type === "WP_ImageFilter")?.id ?? ""));
      // The example is laid out small: zoom in so the mode control can be read.
      const back = await t.zoomOn(filter, { scale: 1 });
      await t.callout("mode", t.node(filter).locator('[data-test="image-filter-widget"]'), "Pause, reuse, or pass all", 5);
      await t.say("On the node, Pause and pick is the default. Reuse last picks repeats your choice without asking, and Pass all lets everything through. A timeout keeps an unattended queue moving.");
      await t.waitVoice();
      await t.uncallout("mode");
      await t.setView(back);
    });

    await t.h.step("Outro", async () => {
      await t.say("Draft fast, pick by eye, and spend the time only on the keepers.");
    });
  },
);
