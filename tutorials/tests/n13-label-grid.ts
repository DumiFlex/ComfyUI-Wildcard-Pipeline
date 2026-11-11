// Nodes 13: WP Label & Grid, on the "Batches and grids" example: its XY plot (rows from label part 1,
// columns from part 2, a title), then run (showcase) for the nine-image sheet, and the presets.
// Without showcase the panel is shown without a run.
import { openExample, showcasing, tutorial, useCheckpoint } from "../tutorial.js";

tutorial(
  "N13",
  {
    title: "WP Label & Grid",
    description: "Label images and lay them out as one grid, from a contact sheet to an XY plot with row and column headers.",
    learn: "Labels, label parts, rows and columns from them, titles, the grid presets, the two outputs.",
  },
  async (t) => {
    const page = t.page;
    const stop = async (row: number) => {
      await t.click(page.locator(`[data-test="bm-dock-row-${row}"]`));
      await t.beat(1200);
    };
    const lg = async () => page.evaluate(() => String(((window.app?.graph?.nodes ?? []) as unknown as { type: string; id: number }[]).find((n) => n.type === "WP_LabelGrid")?.id ?? ""));

    await t.h.step("An XY plot", async () => {
      await t.go("/");
      await t.say("The Batches and grids example makes nine images: three shots against three lights. Each comes with a label, shot and light.");
      await openExample(t, "2 - Batches and grids");
      await useCheckpoint(t);
      await t.waitVoice();
      await stop(5);
      const lgId = await lg();
      const node = t.node(lgId);
      await t.say("WP Label and Grid takes the images and their labels. A label can have parts, split by a dot.");
      // The example is laid out small: zoom in so its fields can be read, and back out for the run.
      const back = await t.zoomOn(lgId, { scale: 1 });
      await t.waitVoice();
      await t.callout("rc", [node.locator('[data-test="lg-rows-from"]'), node.locator('[data-test="lg-columns-from"]')], "Rows: part 1. Columns: part 2.", 6);
      await t.say("Rows come from part one, the shot, and columns from part two, the light. That's an XY plot, with each value as a header.");
      await t.waitVoice();
      await t.uncallout("rc");
      await t.callout("title", node.locator('[data-test="lg-title"]'), "A title on top", 4);
      await t.say("A title goes over the whole sheet.");
      await t.waitVoice();
      await t.uncallout("title");
      await t.setView(back);
    });

    if (showcasing(t)) {
      await t.h.step("Run it", async () => {
        await t.say("Run.");
        // Nine images take a while: 20x keeps the wait to a few seconds (8x left 20 s of still screen).
        await t.fastForward(() => t.run(), 20);
        await stop(5);
        await t.beat(1500);
        await t.say("Nine images, shots down and lights across, each cell headed. Grid saves the sheet; images gives each one with its label.");
        await t.waitVoice();
      });
    }

    await t.h.step("Presets", async () => {
      const lgId = await lg();
      const node = t.node(lgId);
      const back = await t.zoomOn(lgId, { scale: 1 });
      await t.callout("arr", node.locator('[data-test="lg-arrange"]'), "How the grid is laid out", 5);
      await t.say("Arrange picks the layout: fit the run, a sheet, side by side, a row per frame, an XY plot, or labels only. After a run the panel suggests the one that fits.");
      await t.waitVoice();
      await t.uncallout("arr");
      await t.setView(back);
    });

    await t.h.step("Outro", async () => {
      await t.say("Label what each image is, and let the grid line them up.");
    });
  },
);
